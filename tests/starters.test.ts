import { describe, expect, it } from 'vitest';
import { STARTER_TASKS, findStarter, starterTaskBody } from '../src/lib/tasks/starters.ts';
import { findTemplate } from '../src/lib/tasks/templates.ts';
import { runTask, listWorkspaceTasks } from '../src/lib/tasks/engine.ts';
import { createTaskSchema } from '../src/lib/tasks/engine.ts';
import { isAgentKey } from '../src/lib/agents/catalog.ts';
import { db, onboard, newAccount } from './helpers.ts';

/**
 * LIN-153 — guided first-task experience. The empty-state starters must be
 * wired to real catalog agents and templates, build valid engine payloads,
 * and execute to a completed task on a fresh workspace with no human in the
 * loop — the <2min activation path.
 */

describe('starter catalog', () => {
  it('offers exactly three starters, one of which takes a URL', () => {
    expect(STARTER_TASKS).toHaveLength(3);
    expect(STARTER_TASKS.filter((s) => s.inputMode === 'url')).toHaveLength(1);
  });

  it('wires every starter to a real agent and template (no invented workflows)', () => {
    for (const s of STARTER_TASKS) {
      expect(isAgentKey(s.agent), `starter ${s.key} agent`).toBe(true);
      expect(findTemplate(s.agent, s.template), `starter ${s.key} template`).not.toBeNull();
      // One-click starters must be runnable without any user input at all.
      if (s.inputMode === 'fixed') expect(s.input.length).toBeGreaterThan(0);
    }
  });

  it('finds a starter by key and rejects unknown keys', () => {
    expect(findStarter('competitor_pricing')?.agent).toBe('sales');
    expect(findStarter('nope')).toBeNull();
  });
});

describe('starter payloads', () => {
  it('builds engine-valid bodies for every starter', () => {
    for (const s of STARTER_TASKS) {
      const url = s.inputMode === 'url' ? 'https://acme.example/pricing' : undefined;
      const body = starterTaskBody(s, 'ws_1', url);
      expect(createTaskSchema.safeParse(body).success, `starter ${s.key} payload`).toBe(true);
      expect(body.starter).toBe(s.key);
      expect(body.title).toBe(s.title);
    }
  });

  it('embeds the pasted URL in the summarize starter input', () => {
    const body = starterTaskBody(findStarter('summarize_url')!, 'ws_1', 'https://example.com/post');
    expect(body.input).toBe('Summarize this page: https://example.com/post');
  });
});

describe('starter execution — signup to first value, self-serve', () => {
  it('runs every starter on a fresh workspace and records the launch event', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);

    for (const s of STARTER_TASKS) {
      const url = s.inputMode === 'url' ? 'https://acme.example/competitor-pricing' : undefined;
      const task = runTask(d, starterTaskBody(s, workspace.id, url));

      expect(task.status, `starter ${s.key}`).toBe('completed');
      expect(task.title).toBe(s.title);
      expect(task.output!.length).toBeGreaterThan(0);
    }

    // The empty state's disappearance condition: once these tasks exist, the
    // workspace is no longer empty.
    expect(listWorkspaceTasks(d, workspace.id)).toHaveLength(STARTER_TASKS.length);

    // Attribution: one starter_task_launched event per click, first task also
    // marks the workspace activated in the funnel.
    const events = d
      .prepare('SELECT name, data FROM analytics_events WHERE name IN (?, ?) ORDER BY created_at')
      .all('starter_task_launched', 'first_task_dispatched') as { name: string; data: string }[];
    const launches = events.filter((e) => e.name === 'starter_task_launched');
    expect(launches).toHaveLength(STARTER_TASKS.length);
    expect(events.some((e) => e.name === 'first_task_dispatched')).toBe(true);
    // Every launch carries its starter key (order is by timestamp, which can
    // tie within the same second).
    expect(launches.map((e) => JSON.parse(e.data).starter).sort()).toEqual(
      STARTER_TASKS.map((s) => s.key).sort(),
    );
  });

  it('summarizes the exact URL the trialist pasted', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);

    const task = runTask(
      d,
      starterTaskBody(findStarter('summarize_url')!, workspace.id, 'https://example.com/blog/launch'),
    );
    expect(task.output).toContain('https://example.com/blog/launch');
    expect(task.agent).toBe('assistant');
  });

  it('records a starter launch even when it is not the first task', async () => {
    const d = db();
    const { workspace } = await newAccount(d);
    await onboard(d, workspace.id);

    runTask(d, { workspaceId: workspace.id, agent: 'assistant', input: 'Anything new today?' });
    runTask(d, starterTaskBody(findStarter('cold_outreach')!, workspace.id));

    const first = d
      .prepare(`SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'first_task_dispatched'`)
      .get() as { n: number };
    const launches = d
      .prepare(`SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'starter_task_launched'`)
      .get() as { n: number };
    expect(first.n).toBe(1);
    expect(launches.n).toBe(1);
  });
});
