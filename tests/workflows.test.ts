import { describe, expect, it, vi } from 'vitest';
import { db, fixedClock, newAccount, onboard } from './helpers.ts';
import {
  MAX_ATTEMPTS,
  backoffMs,
  drainQueue,
  executeRun,
  runNow,
} from '../src/lib/workflows/runner.ts';
import {
  WORKFLOW_DEFINITIONS,
  getWorkflowDefinition,
  definitionsForAgent,
} from '../src/lib/workflows/definitions.ts';
import {
  cancelRun,
  claimNextRun,
  claimRun,
  enqueueRun,
  findRunById,
  listRunSteps,
  listRuns,
  listWorkflows,
  updateWorkflow,
} from '../src/lib/repos/workflows.ts';
import { AGENT_CATALOG, AGENT_KEYS } from '../src/lib/agents/catalog.ts';
import { disconnectProvider } from '../src/lib/repos/accounts.ts';

async function ready(agents = ['assistant', 'phone', 'marketing'], connect = ['calendar']) {
  const d = db();
  const { workspace } = await newAccount(d);
  await onboard(d, workspace.id, { agents, connect, now: fixedClock() });
  return { d, workspaceId: workspace.id };
}

function workflowFor(d: ReturnType<typeof db>, workspaceId: string, key: string) {
  const wf = listWorkflows(d, workspaceId).find((w) => w.definitionKey === key);
  if (!wf) throw new Error(`no workflow ${key}`);
  return wf;
}

describe('workflow catalog integrity', () => {
  it('every catalog workflow key resolves to a definition owned by that agent', () => {
    for (const key of AGENT_KEYS) {
      for (const defKey of AGENT_CATALOG[key].workflows) {
        expect(getWorkflowDefinition(defKey).agent).toBe(key);
      }
    }
  });

  it('every definition is reachable from exactly one agent', () => {
    for (const def of WORKFLOW_DEFINITIONS) {
      const owners = AGENT_KEYS.filter((k) => AGENT_CATALOG[k].workflows.includes(def.key));
      expect(owners).toEqual([def.agent]);
    }
  });

  it('definition keys and step keys are unique', () => {
    const keys = WORKFLOW_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of WORKFLOW_DEFINITIONS) {
      const steps = def.steps.map((s) => s.key);
      expect(new Set(steps).size, `${def.key} has duplicate steps`).toBe(steps.length);
      expect(steps.length).toBeGreaterThan(0);
    }
  });

  it('definitionsForAgent partitions the registry', () => {
    const total = AGENT_KEYS.reduce((n, k) => n + definitionsForAgent(k).length, 0);
    expect(total).toBe(WORKFLOW_DEFINITIONS.length);
  });
});

describe('run execution', () => {
  it('runs every step in order and records each one', async () => {
    const { d, workspaceId } = await ready();
    const wf = workflowFor(d, workspaceId, 'inbound_enquiry');
    const { run, outcome } = await runNow(
      d,
      {
        workspaceId,
        workflowId: wf.id,
        input: { channel: 'web', contact: { handle: 'lead@example.com' }, message: 'Can I book a demo?' },
      },
      { now: fixedClock() },
    );

    expect(outcome.status).toBe('succeeded');
    expect(run.status).toBe('succeeded');
    expect(run.finishedAt).toBeTruthy();

    const steps = listRunSteps(d, run.id);
    expect(steps.map((s) => s.stepKey)).toEqual(['classify', 'reply', 'book', 'handoff']);
    expect(steps.map((s) => s.seq)).toEqual([0, 1, 2, 3]);
    expect(steps.every((s) => s.finishedAt)).toBe(true);
  });

  it('threads earlier step output into later steps', async () => {
    const { d, workspaceId } = await ready();
    const wf = workflowFor(d, workspaceId, 'inbound_enquiry');
    const { run } = await runNow(
      d,
      {
        workspaceId,
        workflowId: wf.id,
        input: { channel: 'call', contact: { handle: '+33123' }, message: 'urgent — my thing is broken' },
      },
      { now: fixedClock() },
    );

    const byKey = Object.fromEntries(listRunSteps(d, run.id).map((s) => [s.stepKey, s]));
    expect((byKey.classify.output as any).intent).toBe('support');
    expect((byKey.classify.output as any).urgency).toBe('high');
    // `reply` read the classification, and `handoff` escalated on it.
    expect((byKey.reply.output as any).intent).toBe('support');
    expect((byKey.handoff.output as any).escalate).toBe(true);
    // Not a booking enquiry, so the calendar step opted out.
    expect(byKey.book.status).toBe('skipped');
  });

  it('skips steps whose provider is not connected, without failing the run', async () => {
    const { d, workspaceId } = await ready(['phone'], []);
    const wf = workflowFor(d, workspaceId, 'inbound_enquiry');
    const { run, outcome } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { channel: 'web', contact: { handle: 'x@y.z' }, message: 'book a demo' } },
      { now: fixedClock() },
    );

    expect(outcome.status).toBe('succeeded');
    const book = listRunSteps(d, run.id).find((s) => s.stepKey === 'book')!;
    expect(book.status).toBe('skipped');
    expect((book.output as any).reason).toMatch(/calendar not connected/);
    void run;
  });

  it('reflects a provider being disconnected after onboarding', async () => {
    const { d, workspaceId } = await ready(['phone'], ['calendar']);
    disconnectProvider(d, workspaceId, 'calendar');
    const wf = workflowFor(d, workspaceId, 'inbound_enquiry');
    const { run } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { channel: 'web', contact: { handle: 'x@y.z' }, message: 'book a demo' } },
      { now: fixedClock() },
    );
    expect(listRunSteps(d, run.id).find((s) => s.stepKey === 'book')!.status).toBe('skipped');
  });

  it('fails a run with invalid input immediately, without retrying', async () => {
    const { d, workspaceId } = await ready();
    const wf = workflowFor(d, workspaceId, 'inbound_enquiry');
    const { run, outcome } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { channel: 'carrier-pigeon' } },
      { now: fixedClock() },
    );
    expect(outcome.status).toBe('failed');
    expect(run.status).toBe('failed');
    expect(run.attempt).toBe(1);
    expect(run.error).toMatch(/invalid input/);
  });

  it('merges workflow input defaults under the trigger input', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    updateWorkflow(d, workspaceId, wf.id, { inputDefaults: { weeks: 2, themes: ['fallback'] } });

    const { run } = await runNow(d, { workspaceId, workflowId: wf.id, input: { weeks: 5 } }, { now: fixedClock() });
    const plan = listRunSteps(d, run.id)[0].output as any;
    // `weeks` came from the trigger, `themes` from the stored defaults.
    expect(plan.entries[0].theme).toBe('fallback');
    expect(new Set(plan.entries.map((e: any) => e.week)).size).toBe(5);
  });
});

describe('retries and failure handling', () => {
  it('backs off exponentially', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(480_000);
  });

  it('requeues a throwing step until attempts run out, then fails', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const def = getWorkflowDefinition('content_calendar');
    const original = def.steps[0].run;
    const spy = vi.spyOn(def.steps[0], 'run').mockImplementation(() => {
      throw new Error('provider exploded');
    });

    try {
      const clock = fixedClock();
      const queued = enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 'test', input: { weeks: 1 } });

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const claimed = claimRun(d, queued.id, clock().toISOString())!;
        expect(claimed.attempt).toBe(attempt);
        const outcome = await executeRun(d, claimed, { now: clock });
        if (attempt < MAX_ATTEMPTS) {
          expect(outcome.status).toBe('retrying');
          const row = findRunById(d, queued.id)!;
          expect(row.status).toBe('queued');
          // Scheduled into the future, so a drain right now won't pick it up.
          expect(new Date(row.runAfter).getTime()).toBeGreaterThan(clock().getTime());
        } else {
          expect(outcome.status).toBe('failed');
        }
      }

      const final = findRunById(d, queued.id)!;
      expect(final.status).toBe('failed');
      expect(final.attempt).toBe(MAX_ATTEMPTS);
      expect(final.error).toMatch(/provider exploded/);
      expect(spy).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    } finally {
      spy.mockRestore();
      def.steps[0].run = original;
    }
  });

  it('records the failing step as failed', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const def = getWorkflowDefinition('content_calendar');
    const spy = vi.spyOn(def.steps[0], 'run').mockImplementation(() => {
      throw new Error('nope');
    });
    try {
      const { run } = await runNow(d, { workspaceId, workflowId: wf.id, input: { weeks: 1 } }, { now: fixedClock() });
      expect(listRunSteps(d, run.id)[0].status).toBe('failed');
      expect(listRunSteps(d, run.id)[0].error).toMatch(/nope/);
    } finally {
      spy.mockRestore();
    }
  });

  it('cascades runs and steps away when their workflow is deleted', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const { run } = await runNow(d, { workspaceId, workflowId: wf.id, input: { weeks: 1 } }, { now: fixedClock() });
    expect(listRunSteps(d, run.id).length).toBeGreaterThan(0);

    d.prepare('DELETE FROM workflows WHERE id = ?').run(wf.id);
    expect(findRunById(d, run.id)).toBeNull();
    expect(listRunSteps(d, run.id)).toEqual([]);
  });

  it('fails a claimed run whose workflow has gone missing', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const queued = enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 'test' });
    const claimed = claimRun(d, queued.id)!;
    // Simulate the row vanishing between claim and execute, without cascading
    // the run away, so the runner's own guard is what we exercise.
    const outcome = await executeRun(d, { ...claimed, workflowId: 'does-not-exist' }, { now: fixedClock() });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/no longer exists/);
    expect(findRunById(d, queued.id)!.status).toBe('failed');
  });
});

describe('queue semantics', () => {
  it('claims each run exactly once', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const a = enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 't' });

    expect(claimRun(d, a.id)!.id).toBe(a.id);
    // Second claim on an already-running row must fail.
    expect(claimRun(d, a.id)).toBeNull();
  });

  it('does not claim runs scheduled for the future', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const future = new Date(Date.now() + 3600_000).toISOString();
    enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 't', runAfter: future });
    expect(claimNextRun(d)).toBeNull();
    expect(claimNextRun(d, future)).not.toBeNull();
  });

  it('drains due runs oldest-first and stops at the cap', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    // run_after must be at or before the runner's clock for a run to be due.
    const dueAt = fixedClock()().toISOString();
    for (let i = 0; i < 5; i++) {
      enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 't', input: { weeks: 1 }, runAfter: dueAt });
    }
    const first = await drainQueue(d, 3, { now: fixedClock() });
    expect(first).toHaveLength(3);
    expect(first.every((o) => o.status === 'succeeded')).toBe(true);

    const rest = await drainQueue(d, 10, { now: fixedClock() });
    expect(rest).toHaveLength(2);
    expect(await drainQueue(d, 10, { now: fixedClock() })).toHaveLength(0);
  });

  it('cancels a queued run but not a finished one', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const queued = enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 't' });
    expect(cancelRun(d, workspaceId, queued.id)).toBe(true);
    expect(findRunById(d, queued.id)!.status).toBe('cancelled');
    // Already cancelled — no longer queued, so a second cancel is a no-op.
    expect(cancelRun(d, workspaceId, queued.id)).toBe(false);
  });

  it('will not cancel another tenant’s run', async () => {
    const { d, workspaceId } = await ready(['marketing'], []);
    const other = await newAccount(d);
    const wf = workflowFor(d, workspaceId, 'content_calendar');
    const queued = enqueueRun(d, { workspaceId, workflowId: wf.id, trigger: 't' });
    expect(cancelRun(d, other.workspace.id, queued.id)).toBe(false);
    expect(findRunById(d, queued.id)!.status).toBe('queued');
  });
});

describe('tenant isolation on runs', () => {
  it('never lists another workspace’s runs', async () => {
    const { d, workspaceId } = await ready();
    const other = await newAccount(d);
    await onboard(d, other.workspace.id, { agents: ['marketing'], connect: [] });

    const mine = listRuns(d, workspaceId);
    const theirs = listRuns(d, other.workspace.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    const mineIds = new Set(mine.map((r) => r.id));
    expect(theirs.some((r) => mineIds.has(r.id))).toBe(false);
  });
});

describe('agent config drives behaviour', () => {
  it('holds a post back unless the agent is fully autonomous', async () => {
    const { d, workspaceId } = await ready(['marketing'], ['linkedin']);
    const wf = workflowFor(d, workspaceId, 'social_post');
    const { run } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { channel: 'linkedin', topic: 'launch' } },
      { now: fixedClock() },
    );
    const publish = listRunSteps(d, run.id).find((s) => s.stepKey === 'publish')!;
    expect(publish.status).toBe('skipped');
    expect((publish.output as any).reason).toMatch(/awaiting approval/);
  });

  it('publishes once autonomy is raised and the channel is connected', async () => {
    const { d, workspaceId } = await ready(['marketing'], ['linkedin']);
    d.prepare("UPDATE workspace_agents SET config = json_set(config, '$.autonomy', 'autonomous') WHERE agent_key = 'marketing'").run();
    const wf = workflowFor(d, workspaceId, 'social_post');
    const { run } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { channel: 'linkedin', topic: 'launch' } },
      { now: fixedClock() },
    );
    const publish = listRunSteps(d, run.id).find((s) => s.stepKey === 'publish')!;
    expect(publish.status).toBe('succeeded');
    expect((publish.output as any).published).toBe(true);
  });

  it('respects the forecast horizon and flags a negative runway', async () => {
    const { d, workspaceId } = await ready(['accounting'], []);
    const wf = workflowFor(d, workspaceId, 'cash_forecast');
    const { run } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { openingBalance: 1000, monthlyInflow: 0, monthlyOutflow: 500 } },
      { now: fixedClock() },
    );
    const steps = Object.fromEntries(listRunSteps(d, run.id).map((s) => [s.stepKey, s.output as any]));
    expect(steps.project.series).toHaveLength(6);
    expect(steps.project.series.at(-1).balance).toBe(-2000);
    // Balance goes negative in month 3, so runway is 2 months.
    expect(steps.alert.runwayMonths).toBe(2);
    expect(steps.alert.breach.month).toBe(3);
  });
});

describe('pure step logic', () => {
  it('routes free-text requests to the right agent', async () => {
    const { d, workspaceId } = await ready(['assistant'], []);
    const wf = workflowFor(d, workspaceId, 'route_request');
    const cases: [string, string][] = [
      ['Draft an NDA for a supplier', 'legal'],
      ['Write a LinkedIn post about our launch', 'marketing'],
      ['Screen these CVs for the backend role', 'recruiting'],
      ['What is our cash forecast', 'accounting'],
      ['Something entirely unrelated', 'assistant'],
    ];
    for (const [request, expected] of cases) {
      const { run } = await runNow(d, { workspaceId, workflowId: wf.id, input: { request } }, { now: fixedClock() });
      expect((listRunSteps(d, run.id)[0].output as any).agent, request).toBe(expected);
    }
  });

  it('screens applicants against the required skills and years', async () => {
    const { d, workspaceId } = await ready(['recruiting'], ['calendar']);
    const wf = workflowFor(d, workspaceId, 'resume_screen');
    const { run } = await runNow(
      d,
      {
        workspaceId,
        workflowId: wf.id,
        input: {
          role: 'Backend engineer',
          minYears: 3,
          requiredSkills: ['go', 'postgres'],
          applicants: [
            { name: 'Meets bar', years: 5, skills: ['Go', 'Postgres'] },
            { name: 'Too junior', years: 1, skills: ['Go', 'Postgres'] },
            { name: 'Wrong stack', years: 8, skills: ['cobol'] },
            { name: 'Half match', years: 4, skills: ['go'] },
          ],
        },
      },
      { now: fixedClock() },
    );
    const out = listRunSteps(d, run.id)[0].output as any;
    expect(out.advance.map((a: any) => a.name)).toEqual(['Meets bar', 'Half match']);
    expect(out.reject.map((a: any) => a.name)).toEqual(['Too junior', 'Wrong stack']);
  });

  it('flags risky contract clauses', async () => {
    const { d, workspaceId } = await ready(['legal'], []);
    const wf = workflowFor(d, workspaceId, 'contract_review');
    const { run } = await runNow(
      d,
      {
        workspaceId,
        workflowId: wf.id,
        input: { documentText: 'This agreement shall automatically renew. Supplier accepts unlimited liability.' },
      },
      { now: fixedClock() },
    );
    expect((listRunSteps(d, run.id)[0].output as any).flags).toEqual(['auto_renewal', 'unlimited_liability']);
  });

  it('recognises every phrasing of an auto-renewal clause', async () => {
    const { d, workspaceId } = await ready(['legal'], []);
    const wf = workflowFor(d, workspaceId, 'contract_review');
    const phrasings = [
      'the term shall auto-renew annually',
      'this contract will automatically renew',
      'subject to automatic renewal each year',
      'the parties may auto renew',
    ];
    for (const documentText of phrasings) {
      const { run } = await runNow(d, { workspaceId, workflowId: wf.id, input: { documentText } }, { now: fixedClock() });
      expect((listRunSteps(d, run.id)[0].output as any).flags, documentText).toContain('auto_renewal');
    }
  });

  it('flags nothing in a clean contract', async () => {
    const { d, workspaceId } = await ready(['legal'], []);
    const wf = workflowFor(d, workspaceId, 'contract_review');
    const { run } = await runNow(
      d,
      { workspaceId, workflowId: wf.id, input: { documentText: 'A plain one-year agreement with a liability cap.' } },
      { now: fixedClock() },
    );
    expect((listRunSteps(d, run.id)[0].output as any).flags).toEqual([]);
  });

  it('caps outreach at the configured daily limit', async () => {
    const { d, workspaceId } = await ready(['sales'], []);
    d.prepare("UPDATE workspace_agents SET config = json_set(config, '$.dailyOutreachCap', 2) WHERE agent_key = 'sales'").run();
    const wf = workflowFor(d, workspaceId, 'outreach_sequence');
    const { run } = await runNow(
      d,
      {
        workspaceId,
        workflowId: wf.id,
        input: { prospects: [{ handle: 'a' }, { handle: 'b' }, { handle: 'c' }, { handle: 'd' }], steps: 3 },
      },
      { now: fixedClock() },
    );
    const send = listRunSteps(d, run.id).find((s) => s.stepKey === 'send')!.output as any;
    expect(send.sent).toBe(2);
    expect(send.deferred).toBe(2);
  });
});
