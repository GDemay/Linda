import { z } from 'zod';
import type { AgentKey } from '../agents/catalog.ts';

/**
 * Workflow definitions are the unit of automation. A definition is a named,
 * ordered list of steps plus an input schema; a `workflows` row is a
 * workspace's configured instance of one; a `workflow_runs` row is one
 * execution.
 *
 * Steps are pure-ish functions of (input, context, prior step outputs). The
 * engine (runner.ts) owns retries, persistence and ordering — steps stay
 * simple and testable.
 */

export type StepContext = {
  workspaceId: string;
  workflowId: string;
  runId: string;
  /** Config of the owning workspace agent. */
  agentConfig: Record<string, unknown>;
  /**
   * Knowledge-base grounding (LIN-54): text blocks from the workspace's
   * uploaded documents, pre-scoped to this agent and pre-capped. Empty array
   * means the workspace has no knowledge uploaded — steps must treat it as
   * optional context, never as a requirement.
   */
  knowledge: string[];
  /** Providers currently connected for this workspace. */
  connectedProviders: string[];
  /** Outputs of steps that already ran, keyed by step key. */
  steps: Record<string, unknown>;
  /** Injected so runs are deterministic under test. */
  now: () => Date;
  logger: (message: string) => void;
};

export type StepResult =
  | { status: 'ok'; output: unknown }
  | { status: 'skipped'; reason: string }
  | {
      status: 'needs_approval';
      /** What kind of external effect is being gated — drives the inbox copy, not a separate rule. */
      actionKind: 'send' | 'post' | 'spend' | 'delete' | 'other';
      summary: string;
      payload?: Record<string, unknown>;
    };

export type Step = {
  key: string;
  title: string;
  /** Step is skipped (not failed) when a provider it needs isn't connected. */
  requiresProvider?: string;
  run: (input: Record<string, unknown>, ctx: StepContext) => Promise<StepResult> | StepResult;
};

export type WorkflowDefinition = {
  key: string;
  agent: AgentKey;
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  defaultTrigger: { kind: 'manual' | 'schedule' | 'event'; config: Record<string, unknown> };
  steps: Step[];
};

const ok = (output: unknown): StepResult => ({ status: 'ok', output });

/**
 * Placeholder for the model call each drafting step will make. Isolated here so
 * swapping in a real provider is a one-file change and tests stay deterministic.
 */
function draft(kind: string, ctx: StepContext, detail: Record<string, unknown>): unknown {
  const tone = (ctx.agentConfig.tone as string) ?? 'professional';
  // Grounding provenance (LIN-54): how many knowledge passages fed this draft.
  // Zero is a normal value — knowledge is optional context, never a gate.
  const knowledgeChunks = ctx.knowledge.length;
  return { kind, tone, generatedAt: ctx.now().toISOString(), knowledgeChunks, ...detail };
}

function def(d: WorkflowDefinition): WorkflowDefinition {
  return d;
}

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  // ---------------------------------------------------------------- Tom (phone)
  def({
    key: 'inbound_enquiry',
    agent: 'phone',
    name: 'Handle inbound enquiry',
    description: 'Qualifies an inbound call, chat or form enquiry and decides the next action.',
    inputSchema: z.object({
      channel: z.enum(['call', 'whatsapp', 'web']),
      contact: z.object({ name: z.string().max(200).optional(), handle: z.string().max(200) }),
      message: z.string().max(4000),
    }),
    defaultTrigger: { kind: 'event', config: { event: 'enquiry.received' } },
    steps: [
      {
        key: 'classify',
        title: 'Classify the enquiry',
        run: (input) => {
          const text = String(input.message ?? '').toLowerCase();
          const intent = /price|quote|cost|pricing/.test(text)
            ? 'pricing'
            : /book|appointment|meet|demo|schedule/.test(text)
              ? 'booking'
              : /broken|issue|problem|refund|help/.test(text)
                ? 'support'
                : 'general';
          const urgency = /urgent|asap|today|immediately/.test(text) ? 'high' : 'normal';
          return ok({ intent, urgency });
        },
      },
      {
        key: 'reply',
        title: 'Draft a reply',
        run: (input, ctx) => {
          const { intent } = ctx.steps.classify as { intent: string };
          return ok(
            draft('reply', ctx, {
              channel: input.channel,
              to: (input.contact as { handle: string }).handle,
              intent,
            }),
          );
        },
      },
      {
        key: 'book',
        title: 'Offer calendar slots',
        requiresProvider: 'calendar',
        run: (_input, ctx) => {
          const { intent } = ctx.steps.classify as { intent: string };
          if (intent !== 'booking') return { status: 'skipped', reason: 'not a booking enquiry' };
          const base = ctx.now();
          const slots = [1, 2, 3].map((d) =>
            new Date(base.getTime() + d * 24 * 3600 * 1000).toISOString(),
          );
          return ok({ slots });
        },
      },
      {
        key: 'handoff',
        title: 'Escalate if needed',
        run: (_input, ctx) => {
          const { urgency, intent } = ctx.steps.classify as { urgency: string; intent: string };
          const escalate = urgency === 'high' || intent === 'support';
          return ok({ escalate, reason: escalate ? `${intent}/${urgency}` : null });
        },
      },
    ],
  }),

  def({
    key: 'appointment_booking',
    agent: 'phone',
    name: 'Book an appointment',
    description: 'Confirms a slot with the contact and writes it to the calendar.',
    inputSchema: z.object({
      contact: z.object({ name: z.string().max(200), handle: z.string().max(200) }),
      slotIso: z.string().datetime(),
      durationMinutes: z.number().int().min(15).max(240).default(30),
    }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'create_event',
        title: 'Create the calendar event',
        requiresProvider: 'calendar',
        run: (input) =>
          ok({
            startsAt: input.slotIso,
            durationMinutes: input.durationMinutes ?? 30,
            attendee: (input.contact as { handle: string }).handle,
          }),
      },
      {
        key: 'confirm',
        title: 'Send the confirmation',
        run: (input, ctx) =>
          ok(draft('confirmation', ctx, { to: (input.contact as { handle: string }).handle })),
      },
    ],
  }),

  def({
    key: 'call_campaign',
    agent: 'phone',
    name: 'Run a call campaign',
    description: 'Works through a call list and logs the outcome of each attempt.',
    inputSchema: z.object({
      contacts: z
        .array(z.object({ name: z.string().max(200), handle: z.string().max(200) }))
        .min(1)
        .max(500),
      script: z.string().max(4000),
    }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'plan',
        title: 'Order the call list',
        run: (input, ctx) => {
          const contacts = input.contacts as { handle: string }[];
          const cap = Number((ctx.agentConfig.dailyOutreachCap as number) ?? contacts.length);
          return ok({ queued: contacts.slice(0, cap).map((c) => c.handle), deferred: Math.max(0, contacts.length - cap) });
        },
      },
      {
        key: 'dial',
        title: 'Place the calls',
        requiresProvider: 'telephony',
        run: (_input, ctx) => {
          const { queued } = ctx.steps.plan as { queued: string[] };
          return ok({ attempted: queued.length, results: queued.map((h) => ({ handle: h, outcome: 'queued' })) });
        },
      },
    ],
  }),

  // ------------------------------------------------------------ John (marketing)
  def({
    key: 'content_calendar',
    agent: 'marketing',
    name: 'Plan the content calendar',
    description: 'Lays out the coming weeks of posts across the workspace channels.',
    inputSchema: z.object({
      weeks: z.number().int().min(1).max(12).default(4),
      themes: z.array(z.string().max(120)).max(20).default([]),
    }),
    defaultTrigger: { kind: 'schedule', config: { cron: 'weekly', day: 'mon', time: '09:00' } },
    steps: [
      {
        key: 'plan',
        title: 'Draft the calendar',
        run: (input, ctx) => {
          const weeks = Number(input.weeks ?? 4);
          const perWeek = Number((ctx.agentConfig.postsPerWeek as number) ?? 3);
          const channels = (ctx.agentConfig.channels as string[]) ?? ['linkedin'];
          const themes = (input.themes as string[]) ?? [];
          const entries = [];
          for (let w = 0; w < weeks; w++) {
            for (let i = 0; i < perWeek; i++) {
              entries.push({
                week: w + 1,
                channel: channels[(w * perWeek + i) % channels.length],
                theme: themes.length ? themes[(w * perWeek + i) % themes.length] : 'general',
              });
            }
          }
          return ok({ entries, total: entries.length });
        },
      },
    ],
  }),

  def({
    key: 'social_post',
    agent: 'marketing',
    name: 'Write and publish a post',
    description: 'Drafts a post with a visual and publishes it, or queues it for approval.',
    inputSchema: z.object({
      channel: z.enum(['linkedin', 'instagram', 'x', 'tiktok']),
      topic: z.string().max(500),
    }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'copy',
        title: 'Write the copy',
        run: (input, ctx) => ok(draft('post', ctx, { channel: input.channel, topic: input.topic })),
      },
      { key: 'visual', title: 'Generate the visual', run: (input, ctx) => ok(draft('image', ctx, { topic: input.topic })) },
      {
        key: 'publish',
        title: 'Publish',
        run: (input, ctx) => {
          const provider = String(input.channel);
          if (!ctx.connectedProviders.includes(provider)) {
            return { status: 'skipped', reason: `${provider} not connected` };
          }
          // `approve` and `suggest` both stop short of publishing on their own.
          if (ctx.agentConfig.autonomy !== 'autonomous') {
            return {
              status: 'needs_approval',
              actionKind: 'post',
              summary: `Publish "${input.topic}" to ${provider}`,
              payload: { channel: provider, topic: input.topic },
            };
          }
          return ok({ published: true, channel: provider });
        },
      },
    ],
  }),

  // -------------------------------------------------------------------- Lou (SEO)
  def({
    key: 'site_audit',
    agent: 'seo',
    name: 'Audit the site',
    description: 'Crawls the site and reports the technical and content issues worth fixing.',
    inputSchema: z.object({ url: z.string().url(), maxPages: z.number().int().min(1).max(500).default(50) }),
    defaultTrigger: { kind: 'schedule', config: { cron: 'monthly', time: '03:00' } },
    steps: [
      { key: 'crawl', title: 'Crawl pages', run: (input) => ok({ url: input.url, pagesScanned: Number(input.maxPages ?? 50) }) },
      {
        key: 'findings',
        title: 'Summarise findings',
        run: (_input, ctx) => {
          const { pagesScanned } = ctx.steps.crawl as { pagesScanned: number };
          return ok({ pagesScanned, issues: [], score: 100 });
        },
      },
    ],
  }),

  def({
    key: 'article_draft',
    agent: 'seo',
    name: 'Draft an article',
    description: 'Researches a keyword and writes a publish-ready draft.',
    inputSchema: z.object({ keyword: z.string().max(200), outlineOnly: z.boolean().default(false) }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      { key: 'outline', title: 'Build the outline', run: (input, ctx) => ok(draft('outline', ctx, { keyword: input.keyword })) },
      {
        key: 'write',
        title: 'Write the draft',
        run: (input, ctx) => {
          if (input.outlineOnly === true) return { status: 'skipped', reason: 'outline only' };
          const lengths = { short: 600, standard: 1200, long: 2200 } as Record<string, number>;
          const words = lengths[(ctx.agentConfig.articleLength as string) ?? 'standard'];
          return ok(draft('article', ctx, { keyword: input.keyword, words }));
        },
      },
    ],
  }),

  // ------------------------------------------------------------------ Elio (sales)
  def({
    key: 'prospect_list',
    agent: 'sales',
    name: 'Build a prospect list',
    description: 'Finds accounts matching the ICP and scores them.',
    inputSchema: z.object({ size: z.number().int().min(1).max(500).default(50), filters: z.record(z.string()).default({}) }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'search',
        title: 'Search for matches',
        run: (input, ctx) => ok({ requested: Number(input.size ?? 50), icp: ctx.agentConfig.icp ?? '', found: 0, prospects: [] }),
      },
      {
        key: 'score',
        title: 'Score and rank',
        run: (_input, ctx) => {
          const { prospects } = ctx.steps.search as { prospects: unknown[] };
          return ok({ scored: prospects.length });
        },
      },
    ],
  }),

  def({
    key: 'outreach_sequence',
    agent: 'sales',
    name: 'Run an outreach sequence',
    description: 'Sends a multi-step sequence to a prospect list, respecting the daily cap.',
    inputSchema: z.object({
      prospects: z.array(z.object({ handle: z.string().max(200) })).min(1).max(500),
      steps: z.number().int().min(1).max(6).default(3),
    }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'compose',
        title: 'Compose the sequence',
        run: (input, ctx) => ok(draft('sequence', ctx, { steps: Number(input.steps ?? 3) })),
      },
      {
        key: 'send',
        title: 'Send the first touch',
        run: (input, ctx) => {
          const prospects = input.prospects as { handle: string }[];
          const cap = Number((ctx.agentConfig.dailyOutreachCap as number) ?? 25);
          if (ctx.agentConfig.autonomy === 'suggest') {
            return { status: 'skipped', reason: 'autonomy is suggest-only' };
          }
          return ok({ sent: Math.min(prospects.length, cap), deferred: Math.max(0, prospects.length - cap) });
        },
      },
    ],
  }),

  // ------------------------------------------------------------- Manue (finance)
  def({
    key: 'cash_forecast',
    agent: 'accounting',
    name: 'Refresh the cash forecast',
    description: 'Projects the cash position and flags months that go negative.',
    inputSchema: z.object({
      openingBalance: z.number(),
      monthlyInflow: z.number().default(0),
      monthlyOutflow: z.number().default(0),
    }),
    defaultTrigger: { kind: 'schedule', config: { cron: 'monthly', day: 1, time: '07:00' } },
    steps: [
      {
        key: 'project',
        title: 'Project the balance',
        run: (input, ctx) => {
          const months = Number((ctx.agentConfig.forecastMonths as number) ?? 6);
          const inflow = Number(input.monthlyInflow ?? 0);
          const outflow = Number(input.monthlyOutflow ?? 0);
          let balance = Number(input.openingBalance ?? 0);
          const series: { month: number; balance: number }[] = [];
          for (let m = 1; m <= months; m++) {
            balance = balance + inflow - outflow;
            series.push({ month: m, balance: Math.round(balance * 100) / 100 });
          }
          return ok({ currency: ctx.agentConfig.currency ?? 'EUR', series });
        },
      },
      {
        key: 'alert',
        title: 'Flag risk',
        run: (_input, ctx) => {
          const { series } = ctx.steps.project as { series: { month: number; balance: number }[] };
          const breach = series.find((p) => p.balance < 0) ?? null;
          return ok({ runwayMonths: breach ? breach.month - 1 : series.length, breach });
        },
      },
    ],
  }),

  def({
    key: 'expense_review',
    agent: 'accounting',
    name: 'Review expenses',
    description: 'Groups the period’s spend and surfaces the outliers.',
    inputSchema: z.object({
      expenses: z.array(z.object({ category: z.string().max(80), amount: z.number() })).max(5000).default([]),
    }),
    defaultTrigger: { kind: 'schedule', config: { cron: 'monthly', day: 1, time: '07:30' } },
    steps: [
      {
        key: 'summarise',
        title: 'Group by category',
        run: (input) => {
          const rows = (input.expenses as { category: string; amount: number }[]) ?? [];
          const byCategory: Record<string, number> = {};
          for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
          const total = rows.reduce((s, r) => s + r.amount, 0);
          return ok({ total: Math.round(total * 100) / 100, byCategory, count: rows.length });
        },
      },
    ],
  }),

  // ---------------------------------------------------------------- Julia (legal)
  def({
    key: 'contract_draft',
    agent: 'legal',
    name: 'Draft a contract',
    description: 'Produces a first draft from a template and the deal terms.',
    inputSchema: z.object({
      template: z.enum(['nda', 'msa', 'sow', 'employment']),
      counterparty: z.string().max(200),
      terms: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'draft',
        title: 'Draft the document',
        run: (input, ctx) =>
          ok(
            draft('contract', ctx, {
              template: input.template,
              counterparty: input.counterparty,
              jurisdiction: ctx.agentConfig.jurisdiction ?? 'FR',
            }),
          ),
      },
      {
        key: 'review_queue',
        title: 'Queue for human review',
        // Legal drafts always get a human in the loop before they leave the building.
        run: () => ok({ queuedForReview: true }),
      },
    ],
  }),

  def({
    key: 'contract_review',
    agent: 'legal',
    name: 'Review a contract',
    description: 'Reads an incoming contract and flags the clauses worth negotiating.',
    inputSchema: z.object({ documentText: z.string().max(200000) }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'flag',
        title: 'Flag clauses',
        run: (input) => {
          const text = String(input.documentText ?? '').toLowerCase();
          const checks: [string, RegExp][] = [
            // Matches "auto-renew", "automatic renewal" and "automatically renew".
            ['auto_renewal', /auto(-|\s)?renew|automatic(ally)?\s+renew/],
            ['unlimited_liability', /unlimited liability|no cap on liability/],
            ['exclusivity', /exclusiv/],
            ['non_compete', /non[- ]compete/],
          ];
          return ok({ flags: checks.filter(([, re]) => re.test(text)).map(([k]) => k) });
        },
      },
    ],
  }),

  // ------------------------------------------------------------ Rony (recruiting)
  def({
    key: 'resume_screen',
    agent: 'recruiting',
    name: 'Screen applicants',
    description: 'Scores applicants against the role and splits them into advance / reject.',
    inputSchema: z.object({
      role: z.string().max(120),
      applicants: z
        .array(z.object({ name: z.string().max(200), years: z.number().min(0).max(60), skills: z.array(z.string().max(60)).default([]) }))
        .max(1000)
        .default([]),
      requiredSkills: z.array(z.string().max(60)).default([]),
      minYears: z.number().min(0).max(40).default(0),
    }),
    defaultTrigger: { kind: 'event', config: { event: 'application.received' } },
    steps: [
      {
        key: 'score',
        title: 'Score applicants',
        run: (input) => {
          const applicants = (input.applicants as { name: string; years: number; skills: string[] }[]) ?? [];
          const required = ((input.requiredSkills as string[]) ?? []).map((s) => s.toLowerCase());
          const minYears = Number(input.minYears ?? 0);
          const scored = applicants.map((a) => {
            const have = new Set((a.skills ?? []).map((s) => s.toLowerCase()));
            const matched = required.filter((s) => have.has(s));
            const skillScore = required.length ? matched.length / required.length : 1;
            const advance = a.years >= minYears && skillScore >= 0.5;
            return { name: a.name, skillScore: Math.round(skillScore * 100) / 100, advance };
          });
          return ok({ advance: scored.filter((s) => s.advance), reject: scored.filter((s) => !s.advance) });
        },
      },
    ],
  }),

  def({
    key: 'interview_schedule',
    agent: 'recruiting',
    name: 'Schedule interviews',
    description: 'Offers slots to the applicants who cleared screening.',
    inputSchema: z.object({
      candidates: z.array(z.object({ name: z.string().max(200), handle: z.string().max(200) })).max(200).default([]),
    }),
    defaultTrigger: { kind: 'manual', config: {} },
    steps: [
      {
        key: 'offer_slots',
        title: 'Offer slots',
        requiresProvider: 'calendar',
        run: (input, ctx) => {
          const candidates = (input.candidates as { handle: string }[]) ?? [];
          const base = ctx.now();
          return ok({
            invited: candidates.length,
            slots: [2, 3, 4].map((d) => new Date(base.getTime() + d * 24 * 3600 * 1000).toISOString()),
          });
        },
      },
    ],
  }),

  // --------------------------------------------------------------- Charly (chief)
  def({
    key: 'daily_briefing',
    agent: 'assistant',
    name: 'Send the daily briefing',
    description: 'Summarises what the agents did and what needs a decision.',
    inputSchema: z.object({ lookbackHours: z.number().int().min(1).max(168).default(24) }),
    defaultTrigger: { kind: 'schedule', config: { cron: 'daily', time: '08:00' } },
    steps: [
      {
        key: 'compose',
        title: 'Compose the briefing',
        run: (input, ctx) =>
          ok(draft('briefing', ctx, { lookbackHours: Number(input.lookbackHours ?? 24) })),
      },
    ],
  }),

  def({
    key: 'route_request',
    agent: 'assistant',
    name: 'Route a request',
    description: 'Reads a free-text request and hands it to the right agent.',
    inputSchema: z.object({ request: z.string().max(4000) }),
    defaultTrigger: { kind: 'event', config: { event: 'message.received' } },
    steps: [
      {
        key: 'route',
        title: 'Pick the agent',
        run: (input) => {
          const text = String(input.request ?? '').toLowerCase();
          const rules: [AgentKey, RegExp][] = [
            ['phone', /call|phone|voicemail|whatsapp/],
            ['marketing', /post|social|linkedin|instagram|campaign/],
            ['seo', /seo|keyword|article|blog|rank/],
            ['sales', /prospect|outreach|lead|pipeline|crm/],
            ['accounting', /invoice|cash|expense|forecast|budget/],
            ['legal', /contract|nda|clause|legal|compliance/],
            ['recruiting', /candidate|resume|cv|hire|interview/],
          ];
          const match = rules.find(([, re]) => re.test(text));
          return ok({ agent: match ? match[0] : 'assistant', confident: Boolean(match) });
        },
      },
    ],
  }),
];

const BY_KEY = new Map(WORKFLOW_DEFINITIONS.map((d) => [d.key, d]));

export function getWorkflowDefinition(key: string): WorkflowDefinition {
  const d = BY_KEY.get(key);
  if (!d) throw new Error(`unknown workflow definition: ${key}`);
  return d;
}

export function hasWorkflowDefinition(key: string): boolean {
  return BY_KEY.has(key);
}

export function definitionsForAgent(agent: AgentKey): WorkflowDefinition[] {
  return WORKFLOW_DEFINITIONS.filter((d) => d.agent === agent);
}
