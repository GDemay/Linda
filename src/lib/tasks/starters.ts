import type { AgentKey } from '../agents/catalog.ts';

/**
 * One-click starter tasks (LIN-153). When a workspace has no tasks and no
 * runs yet, the dashboard empty-state offers these instead of a blank slate:
 * one click builds the task, executes it via the instant task engine, and
 * the result lands on the dashboard — first value with no human in the loop.
 *
 * Pure data + pure helpers (no db) so the client page can import it directly;
 * execution still goes through POST /api/tasks → runTask like every other task.
 */

export type StarterTask = {
  key: string;
  /** Button label the trialist sees. */
  title: string;
  /** One line under the label: what they get back. */
  description: string;
  /** Agent that runs the starter; need not be hired by the workspace — the
   * starter picks the right specialist for the trialist. */
  agent: AgentKey;
  /** Task template key from templates.ts; starters reuse the catalog rather
   * than inventing execution paths (LIN-153 constraint). */
  template: string;
  /** The instruction sent to the agent. */
  input: string;
  /** 'fixed' runs on click; 'url' shows one URL field and runs with it. */
  inputMode: 'fixed' | 'url';
};

export const STARTER_TASKS: StarterTask[] = [
  {
    key: 'competitor_pricing',
    title: "Research my competitor's pricing",
    description: 'A teardown of their plans and where you win on price.',
    agent: 'sales',
    template: 'profit_research',
    input: 'Research our closest competitor’s pricing and packaging — plans, discounts and how they position against us.',
    inputMode: 'fixed',
  },
  {
    key: 'cold_outreach',
    title: 'Draft a cold outbound sequence',
    description: 'A first-touch message ready to personalise and send.',
    agent: 'sales',
    template: 'outreach_draft',
    input: 'Draft a cold outbound sequence for our ideal customer.',
    inputMode: 'fixed',
  },
  {
    key: 'summarize_url',
    title: 'Summarize this URL',
    description: 'Paste any link — get the key points back.',
    agent: 'assistant',
    template: 'url_summary',
    input: '',
    inputMode: 'url',
  },
];

export function findStarter(key: string): StarterTask | null {
  return STARTER_TASKS.find((s) => s.key === key) ?? null;
}

/**
 * Builds the POST /api/tasks body for a starter click. `url` is required for
 * `inputMode: 'url'` starters and ignored otherwise. The starter key rides
 * along so the engine can attribute the launch in the activation funnel.
 */
export function starterTaskBody(
  starter: StarterTask,
  workspaceId: string,
  url?: string,
): { workspaceId: string; agent: string; template: string; title: string; input: string; starter: string } {
  const input =
    starter.inputMode === 'url'
      ? `Summarize this page: ${(url ?? '').trim()}`
      : starter.input;
  return {
    workspaceId,
    agent: starter.agent,
    template: starter.template,
    title: starter.title,
    input,
    starter: starter.key,
  };
}
