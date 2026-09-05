import { z } from 'zod';

/**
 * The catalog of AI coworkers a workspace can hire. Each entry owns a set of
 * workflow definitions (see lib/workflows/definitions.ts) and declares the
 * integrations it needs, which is what drives the onboarding connect step.
 */

export type AgentKey =
  | 'phone'
  | 'marketing'
  | 'seo'
  | 'sales'
  | 'accounting'
  | 'legal'
  | 'recruiting'
  | 'assistant';

export type AgentDefinition = {
  key: AgentKey;
  name: string;
  /** The persona customers see in the dashboard, e.g. "Tom" for the phone agent. */
  persona: string;
  role: string;
  blurb: string;
  /** Providers the agent needs before it can run. Onboarding asks for these. */
  requiredProviders: string[];
  optionalProviders: string[];
  /** Workflow definition keys this agent can run. */
  workflows: string[];
  /** Per-agent config, validated on write. */
  configSchema: z.ZodTypeAny;
  /** Applied when the agent is hired during onboarding, so it works immediately. */
  defaultConfig: Record<string, unknown>;
  /** Business functions this agent serves; used to recommend agents from goals. */
  goals: string[];
};

const baseConfig = {
  tone: z.enum(['professional', 'friendly', 'concise', 'formal']).default('professional'),
  workingHours: z
    .object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
    .default({ start: '09:00', end: '18:00' }),
  autonomy: z.enum(['suggest', 'approve', 'autonomous']).default('approve'),
};

export const AGENT_CATALOG: Record<AgentKey, AgentDefinition> = {
  phone: {
    key: 'phone',
    persona: 'Tom',
    name: 'Phone',
    role: 'Phone & inbox agent',
    blurb: 'Answers calls, WhatsApp and web enquiries around the clock, and books meetings straight into your calendar.',
    requiredProviders: ['calendar'],
    optionalProviders: ['whatsapp', 'telephony', 'email'],
    workflows: ['inbound_enquiry', 'appointment_booking', 'call_campaign'],
    configSchema: z.object({
      ...baseConfig,
      greeting: z.string().max(400).default('Thanks for calling — how can I help?'),
      escalateAfterMinutes: z.number().int().min(1).max(60).default(10),
    }),
    defaultConfig: { autonomy: 'approve' },
    goals: ['capture_leads', 'book_meetings', 'support_customers'],
  },
  marketing: {
    key: 'marketing',
    persona: 'John',
    name: 'Marketing',
    role: 'Marketing agent',
    blurb: 'Plans, writes and schedules social content across your channels, with visuals to match.',
    requiredProviders: [],
    optionalProviders: ['linkedin', 'instagram', 'x'],
    workflows: ['content_calendar', 'social_post'],
    configSchema: z.object({
      ...baseConfig,
      channels: z.array(z.enum(['linkedin', 'instagram', 'x', 'tiktok'])).default(['linkedin']),
      postsPerWeek: z.number().int().min(1).max(21).default(3),
    }),
    defaultConfig: { autonomy: 'approve' },
    goals: ['grow_audience', 'generate_demand'],
  },
  seo: {
    key: 'seo',
    persona: 'Lou',
    name: 'SEO',
    role: 'SEO agent',
    blurb: 'Audits your site, finds the keywords worth winning, and drafts articles that rank.',
    requiredProviders: [],
    optionalProviders: ['wordpress', 'search_console'],
    workflows: ['site_audit', 'article_draft'],
    configSchema: z.object({
      ...baseConfig,
      targetKeywords: z.array(z.string().max(80)).max(50).default([]),
      articleLength: z.enum(['short', 'standard', 'long']).default('standard'),
    }),
    defaultConfig: { autonomy: 'approve' },
    goals: ['grow_audience', 'generate_demand'],
  },
  sales: {
    key: 'sales',
    persona: 'Elio',
    name: 'Sales',
    role: 'Sales agent',
    blurb: 'Builds prospect lists, runs outreach sequences, and keeps your CRM honest.',
    requiredProviders: [],
    optionalProviders: ['linkedin', 'email', 'crm'],
    workflows: ['prospect_list', 'outreach_sequence'],
    configSchema: z.object({
      ...baseConfig,
      icp: z.string().max(600).default(''),
      dailyOutreachCap: z.number().int().min(1).max(200).default(25),
    }),
    defaultConfig: { autonomy: 'approve' },
    goals: ['capture_leads', 'generate_demand', 'close_deals'],
  },
  accounting: {
    key: 'accounting',
    persona: 'Manue',
    name: 'Finance',
    role: 'Finance agent',
    blurb: 'Keeps a rolling cash forecast and flags anything that needs your attention.',
    requiredProviders: [],
    optionalProviders: ['accounting', 'banking'],
    workflows: ['cash_forecast', 'expense_review'],
    configSchema: z.object({
      ...baseConfig,
      currency: z.string().length(3).default('EUR'),
      forecastMonths: z.number().int().min(1).max(24).default(6),
    }),
    defaultConfig: { autonomy: 'suggest' },
    goals: ['control_costs', 'stay_compliant'],
  },
  legal: {
    key: 'legal',
    persona: 'Julia',
    name: 'Legal',
    role: 'Legal agent',
    blurb: 'Drafts and reviews everyday contracts, and flags clauses worth a second look.',
    requiredProviders: [],
    optionalProviders: ['drive', 'esign'],
    workflows: ['contract_draft', 'contract_review'],
    configSchema: z.object({
      ...baseConfig,
      jurisdiction: z.string().max(80).default('FR'),
      // Legal output should not go out unreviewed by default.
      autonomy: z.enum(['suggest', 'approve']).default('suggest'),
    }),
    defaultConfig: { autonomy: 'suggest' },
    goals: ['stay_compliant'],
  },
  recruiting: {
    key: 'recruiting',
    persona: 'Rony',
    name: 'Recruiting',
    role: 'Recruiting agent',
    blurb: 'Screens applicants against your bar, and schedules the ones worth meeting.',
    requiredProviders: ['calendar'],
    optionalProviders: ['ats', 'email'],
    workflows: ['resume_screen', 'interview_schedule'],
    configSchema: z.object({
      ...baseConfig,
      openRoles: z.array(z.string().max(120)).max(50).default([]),
    }),
    defaultConfig: { autonomy: 'approve' },
    goals: ['hire_faster'],
  },
  assistant: {
    key: 'assistant',
    persona: 'Charly',
    name: 'Chief of Staff',
    role: 'Chief of staff',
    blurb: 'Your single point of contact — routes work to the right agent and reports back.',
    requiredProviders: [],
    optionalProviders: ['whatsapp', 'email', 'calendar'],
    workflows: ['daily_briefing', 'route_request'],
    configSchema: z.object({
      ...baseConfig,
      briefingTime: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
    }),
    defaultConfig: { autonomy: 'autonomous' },
    goals: ['save_time'],
  },
};

export const AGENT_KEYS = Object.keys(AGENT_CATALOG) as AgentKey[];

export function isAgentKey(v: string): v is AgentKey {
  return Object.prototype.hasOwnProperty.call(AGENT_CATALOG, v);
}

export function getAgent(key: string): AgentDefinition {
  if (!isAgentKey(key)) throw new Error(`unknown agent: ${key}`);
  return AGENT_CATALOG[key];
}

/**
 * Parses + fills defaults for an agent's config. Throws on invalid input so
 * callers can turn it into a 422 rather than persisting junk.
 */
export function parseAgentConfig(key: string, raw: unknown): Record<string, unknown> {
  const def = getAgent(key);
  const merged = { ...def.defaultConfig, ...(raw && typeof raw === 'object' ? raw : {}) };
  return def.configSchema.parse(merged) as Record<string, unknown>;
}

export const GOALS = [
  { key: 'capture_leads', label: 'Never miss an inbound lead' },
  { key: 'book_meetings', label: 'Fill my calendar' },
  { key: 'support_customers', label: 'Answer customers faster' },
  { key: 'grow_audience', label: 'Grow my audience' },
  { key: 'generate_demand', label: 'Generate more demand' },
  { key: 'close_deals', label: 'Close more deals' },
  { key: 'control_costs', label: 'Stay on top of cash' },
  { key: 'stay_compliant', label: 'Stay compliant' },
  { key: 'hire_faster', label: 'Hire faster' },
  { key: 'save_time', label: 'Just save me time' },
] as const;

export const GOAL_KEYS = GOALS.map((g) => g.key);

/**
 * Maps the goals picked during onboarding to the agents worth hiring, best
 * match first. Charly is always included — she's the front door.
 */
export function recommendAgents(goals: string[]): AgentKey[] {
  const wanted = new Set(goals);
  const scored = AGENT_KEYS.filter((k) => k !== 'assistant')
    .map((k) => ({ key: k, score: AGENT_CATALOG[k].goals.filter((g) => wanted.has(g)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || AGENT_KEYS.indexOf(a.key) - AGENT_KEYS.indexOf(b.key));

  return ['assistant', ...scored.map((s) => s.key)];
}
