import { describe, expect, it } from 'vitest';
import { AGENT_CATALOG, AGENT_KEYS } from '../src/lib/agents/catalog.ts';
import { runTask, getWorkspaceTask, listWorkspaceTasks } from '../src/lib/tasks/engine.ts';
import { TASK_TEMPLATES, templatesFor, findTemplate } from '../src/lib/tasks/templates.ts';
import { listActivity } from '../src/lib/repos/workflows.ts';
import { AppError } from '../src/lib/repos/types.ts';
import { db, newAccount } from './helpers.ts';

describe('task templates', () => {
  it('gives every agent in the catalog at least one template', () => {
    for (const key of AGENT_KEYS) {
      expect(templatesFor(key).length, `agent ${key}`).toBeGreaterThan(0);
    }
  });

  it('covers exactly the catalog agents', () => {
    expect(Object.keys(TASK_TEMPLATES).sort()).toEqual([...AGENT_KEYS].sort());
  });

  it('finds a template by key and rejects unknown keys', () => {
    expect(findTemplate('assistant', 'daily_briefing')?.category).toBe('Chief of staff');
    expect(findTemplate('assistant', 'nope')).toBeNull();
  });

  it('renders deterministically from the input', () => {
    const t = findTemplate('sales', 'outreach_draft')!;
    const a = t.render({ persona: 'Elio', input: 'Acme needs a new CRM. They called on Monday.' });
    const b = t.render({ persona: 'Elio', input: 'Acme needs a new CRM. They called on Monday.' });
    expect(a).toBe(b);
    expect(a).toContain('Acme needs a new CRM.');
  });
});

describe('task engine — execution', () => {
  it('runs a task to completion instantly and persists it', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const task = runTask(d, {
      workspaceId: workspace.id,
      agent: 'phone',
      template: 'inbound_reply',
      input: 'Do you integrate with Google Calendar? Asking for our office manager.',
    });

    expect(task.status).toBe('completed');
    expect(task.completedAt).toBe(task.createdAt);
    expect(task.output).toContain('Do you integrate with Google Calendar?');
    expect(task.tokensUsed).toBeGreaterThan(0);

    const fetched = getWorkspaceTask(d, workspace.id, task.id);
    expect(fetched.id).toBe(task.id);
    expect(fetched.agent).toBe('phone');
  });

  it('defaults to the first template and lets the caller override the title', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const task = runTask(d, {
      workspaceId: workspace.id,
      agent: 'assistant',
      input: 'What happened yesterday?',
      title: 'Briefing for Monday',
    });

    const first = templatesFor('assistant')[0];
    expect(task.title).toBe('Briefing for Monday');
    expect(task.category).toBe(first.category);
    expect(task.output).toContain("Today's briefing");
  });

  it('attributes the task to the agent persona in the activity feed', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    runTask(d, { workspaceId: workspace.id, agent: 'sales', input: 'Draft outreach to a logistics prospect.' });

    const event = listActivity(d, workspace.id).find((e) => e.kind === 'task.completed');
    expect(event?.summary).toContain(AGENT_CATALOG.sales.persona);
  });

  it('rejects an unknown agent, template, and workspace with the right codes', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const badAgent = () => runTask(d, { workspaceId: workspace.id, agent: 'intern', input: 'hi' });
    expect(badAgent).toThrowError(AppError);

    const badTemplate = () =>
      runTask(d, { workspaceId: workspace.id, agent: 'phone', template: 'nope', input: 'hi' });
    expect(badTemplate).toThrowError(/no template/);

    const badWorkspace = () =>
      runTask(d, { workspaceId: 'ws_missing', agent: 'phone', input: 'hi' });
    expect(badWorkspace).toThrowError(/workspace/);

    const badInput = () =>
      runTask(d, { workspaceId: workspace.id, agent: 'phone', input: '' });
    expect(badInput).toThrowError(AppError);
  });
});

describe('task engine — listing and tenant isolation', () => {
  it('lists a workspace tasks newest first and filters by agent', async () => {
    const d = db();
    const { workspace } = await newAccount(d);

    const first = runTask(d, { workspaceId: workspace.id, agent: 'phone', input: 'Question about pricing.' });
    const second = runTask(d, { workspaceId: workspace.id, agent: 'seo', input: 'Keywords for our booking page.' });

    const all = listWorkspaceTasks(d, workspace.id);
    expect(all.map((t) => t.id)).toEqual([second.id, first.id]);

    const onlySeo = listWorkspaceTasks(d, workspace.id, { agent: 'seo' });
    expect(onlySeo.map((t) => t.id)).toEqual([second.id]);
  });

  it('never returns another workspace task, in lists or by id', async () => {
    const d = db();
    const a = await newAccount(d);
    const b = await newAccount(d);

    const task = runTask(d, { workspaceId: a.workspace.id, agent: 'marketing', input: 'Post about our launch.' });

    expect(listWorkspaceTasks(d, b.workspace.id).map((t) => t.id)).not.toContain(task.id);
    expect(() => getWorkspaceTask(d, b.workspace.id, task.id)).toThrowError(AppError);
  });
});
