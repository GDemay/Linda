import { describe, expect, it } from 'vitest';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';
import {
  addMemory,
  editMemory,
  removeMemory,
  listWorkspaceMemories,
  editTaskDeliverable,
} from '../src/lib/memories/service.ts';
import { listMemories, updateMemory } from '../src/lib/repos/memories.ts';
import { runTask } from '../src/lib/tasks/engine.ts';
import { runNow } from '../src/lib/workflows/runner.ts';
import { listWorkflows, listActivity, findRunById } from '../src/lib/repos/workflows.ts';
import { AppError } from '../src/lib/repos/types.ts';

/**
 * LIN-53: persistent, editable agent memory. A workspace teaches an agent a
 * fact; the fact survives across runs, is cited in outputs, can be edited or
 * deleted from the surface, and every change lands in the activity log.
 */

async function ready(agents = ['assistant', 'phone', 'marketing'], connect = ['calendar']) {
  const d = db();
  const { user, workspace } = await newAccount(d);
  await onboard(d, workspace.id, { agents, connect, now: fixedClock() });
  return { d, userId: user.id, workspaceId: workspace.id };
}

describe('memory CRUD', () => {
  it('creates, lists pinned-first, edits and deletes', async () => {
    const { d, userId, workspaceId } = await ready();

    const a = addMemory(d, workspaceId, userId, { agent: 'phone', content: 'Always reply in French.' });
    const b = addMemory(d, workspaceId, userId, { agent: 'phone', content: 'Never promise a discount.', pinned: true });
    expect(a.source).toBe('manual');
    expect(b.pinned).toBe(true);

    const listed = listWorkspaceMemories(d, workspaceId, 'phone');
    expect(listed.map((m) => m.id)).toEqual([b.id, a.id]);

    const edited = editMemory(d, workspaceId, a.id, userId, { content: 'Always reply in formal French.' });
    expect(edited.content).toBe('Always reply in formal French.');
    expect(edited.updatedAt >= edited.createdAt).toBe(true);

    removeMemory(d, workspaceId, b.id, userId);
    expect(listWorkspaceMemories(d, workspaceId, 'phone').map((m) => m.id)).toEqual([a.id]);
  });

  it('keeps append/edit history in the activity log', async () => {
    const { d, userId, workspaceId } = await ready();
    const memory = addMemory(d, workspaceId, userId, { agent: 'marketing', content: 'Brand voice: plain and warm.' });

    editMemory(d, workspaceId, memory.id, userId, { content: 'Brand voice: plain, warm, no emoji.' });
    removeMemory(d, workspaceId, memory.id, userId);

    const kinds = listActivity(d, workspaceId).map((e) => e.kind);
    expect(kinds).toContain('memory.created');
    expect(kinds).toContain('memory.updated');
    expect(kinds).toContain('memory.deleted');

    const updated = listActivity(d, workspaceId).find((e) => e.kind === 'memory.updated');
    // The edit event carries the before/after so history is reconstructable.
    const data = updated?.data as { before: { content: string; pinned: boolean }; after: { content: string } };
    expect(data.before).toEqual({ content: 'Brand voice: plain and warm.', pinned: false });
    expect(data.after.content).toBe('Brand voice: plain, warm, no emoji.');
  });

  it('never sees or touches another workspace memory', async () => {
    const a = await ready();
    const b = await ready();
    const memory = addMemory(a.d, a.workspaceId, a.userId, { agent: 'phone', content: 'Invoice as Acme SAS.' });

    expect(listMemories(b.d, b.workspaceId, 'phone')).toEqual([]);
    expect(() => updateMemory(b.d, b.workspaceId, memory.id, { content: 'hijack' })).toThrowError(AppError);
    expect(() => removeMemory(b.d, b.workspaceId, memory.id, b.userId)).toThrowError(AppError);
    // The original is untouched.
    expect(listWorkspaceMemories(a.d, a.workspaceId, 'phone')[0].content).toBe('Invoice as Acme SAS.');
  });

  it('rejects unknown agents and empty content', async () => {
    const { d, userId, workspaceId } = await ready();
    expect(() => addMemory(d, workspaceId, userId, { agent: 'intern', content: 'hi' })).toThrowError(AppError);
    expect(() => addMemory(d, workspaceId, userId, { agent: 'phone', content: '   ' })).toThrowError(AppError);
  });
});

describe('task engine injection', () => {
  it('applies and cites memories, and they persist across runs', async () => {
    const { d, userId, workspaceId } = await ready();
    addMemory(d, workspaceId, userId, { agent: 'phone', content: 'The office manager prefers email over phone.' });

    const first = runTask(d, {
      workspaceId,
      agent: 'phone',
      template: 'inbound_reply',
      input: 'Do you integrate with Google Calendar?',
    });
    expect(first.output).toContain('Applied memory:');
    expect(first.output).toContain('[M1] The office manager prefers email over phone.');

    // A later run — the fact survived the first session ending.
    const second = runTask(d, {
      workspaceId,
      agent: 'phone',
      input: 'Can someone call me back tomorrow?',
    });
    expect(second.output).toContain('The office manager prefers email over phone.');

    // Cited in the activity feed too, for traceability.
    const completed = listActivity(d, workspaceId)
      .filter((e) => e.kind === 'task.completed')
      .find((e) => e.data.taskId === second.id);
    expect((completed?.data.appliedMemoryIds as string[]).length).toBe(1);
  });

  it('pins are cited first and stay invisible when there is nothing to apply', async () => {
    const { d, userId, workspaceId } = await ready();

    const untouched = runTask(d, { workspaceId, agent: 'marketing', input: 'Post about our launch.' });
    expect(untouched.output).not.toContain('Applied memory:');

    addMemory(d, workspaceId, userId, { agent: 'marketing', content: 'Never use hashtags.' });
    addMemory(d, workspaceId, userId, { agent: 'marketing', content: 'Always mention the city: Lyon.', pinned: true });

    const cited = runTask(d, { workspaceId, agent: 'marketing', input: 'Post about our launch again.' });
    const pinLine = cited.output!.indexOf('[M1] 📌 Always mention the city: Lyon.');
    const otherLine = cited.output!.indexOf('[M2] Never use hashtags.');
    expect(pinLine).toBeGreaterThan(-1);
    expect(otherLine).toBeGreaterThan(pinLine);
  });

  it('stops applying a memory once the user deletes it', async () => {
    const { d, userId, workspaceId } = await ready();
    const memory = addMemory(d, workspaceId, userId, { agent: 'phone', content: 'Always reply in French.' });

    runTask(d, { workspaceId, agent: 'phone', input: 'Question about pricing.' });
    removeMemory(d, workspaceId, memory.id, userId);

    const after = runTask(d, { workspaceId, agent: 'phone', input: 'Another question about pricing.' });
    expect(after.output).not.toContain('Always reply in French.');
  });
});

describe('workflow runner injection', () => {
  it('carries memories on run steps and cites them in the run output', async () => {
    const { d, userId, workspaceId } = await ready();
    addMemory(d, workspaceId, userId, { agent: 'phone', content: 'Caller is a repeat customer — priority handling.' });

    const wf = listWorkflows(d, workspaceId).find((w) => w.definitionKey === 'inbound_enquiry')!;
    const { run } = await runNow(
      d,
      {
        workspaceId,
        workflowId: wf.id,
        input: {
          channel: 'call',
          contact: { handle: '+33612345678', name: 'Mme Martin' },
          message: 'I need to book an appointment urgently.',
        },
      },
      { now: fixedClock('2026-01-15T09:05:00.000Z') },
    );

    const finished = findRunById(d, run.id)!;
    expect(finished.status).toBe('succeeded');
    const applied = finished.output!.appliedMemories as { id: string; content: string }[];
    expect(applied.map((m) => m.content)).toEqual(['Caller is a repeat customer — priority handling.']);

    // And on the activity event, same ids.
    const succeeded = listActivity(d, workspaceId).find(
      (e) => e.kind === 'run.succeeded' && e.data.runId === run.id,
    );
    expect((succeeded?.data.appliedMemoryIds as string[]).length).toBe(1);
  });
});

describe('deliverable correction → memory', () => {
  it('edits the output and promotes the note to a correction-sourced memory', async () => {
    const { d, userId, workspaceId } = await ready();
    const task = runTask(d, { workspaceId, agent: 'sales', input: 'Draft outreach to a logistics prospect.' });

    const { task: edited, memory } = editTaskDeliverable(d, workspaceId, task.id, userId, {
      output: 'Corrected copy that opens with their situation.',
      rememberNote: 'Open every outreach with the prospect’s situation, never our product.',
    });

    expect(edited.output).toBe('Corrected copy that opens with their situation.');
    expect(memory?.source).toBe('correction');
    expect(memory?.agentKey).toBe('sales');

    // The very next task cites it.
    const next = runTask(d, { workspaceId, agent: 'sales', input: 'Draft outreach to a SaaS prospect.' });
    expect(next.output).toContain('[M1] Open every outreach with the prospect’s situation, never our product.');

    const kinds = listActivity(d, workspaceId).map((e) => e.kind);
    expect(kinds).toContain('task.edited');
    expect(kinds).toContain('memory.created');
  });

  it('rejects edits to another workspace task', async () => {
    const a = await ready();
    const b = await ready();
    const task = runTask(a.d, { workspaceId: a.workspaceId, agent: 'sales', input: 'Outreach.' });
    expect(() => editTaskDeliverable(b.d, b.workspaceId, task.id, b.userId, { output: 'hijack' })).toThrowError(AppError);
  });
});
