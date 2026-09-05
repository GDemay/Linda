import type { AgentKey } from '../agents/catalog.ts';

/**
 * Instant-execution task templates (LIN-36). A template is a pure function
 * from the user's request to a structured result — no network, no queue —
 * so POST /api/tasks returns the finished task in one round-trip.
 *
 * Long-running, integration-backed work stays in lib/workflows; these
 * templates cover the "give the agent an instruction, get an answer now"
 * surface of the dashboard.
 */

export type TemplateContext = {
  /** The persona name shown in the dashboard, e.g. "Tom". */
  persona: string;
  /** The raw user instruction. */
  input: string;
  /**
   * Knowledge-base grounding blocks (LIN-54), pre-scoped to the agent and
   * pre-capped. Templates treat it as optional context: absent knowledge
   * must not change a template's output shape, only its specificity.
   */
  knowledge?: string[];
};

export type TaskTemplate = {
  key: string;
  category: string;
  title: string;
  /** Rough token cost attributed to the task, for usage metering. */
  tokens: number;
  render: (ctx: TemplateContext) => string;
};

const firstSentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  const cut = t.search(/[.!?]/);
  return cut === -1 ? t : t.slice(0, cut + 1);
};

const bullets = (items: string[]) => items.map((i) => `• ${i}`).join('\n');

/**
 * Appended to template output when knowledge grounding contributed context
 * (LIN-54). Absent knowledge changes nothing — the note only appears when
 * there was something to ground on.
 */
const groundingNote = (knowledge?: string[]) =>
  knowledge && knowledge.length > 0
    ? `\n\nGrounded in ${knowledge.length} passage${knowledge.length === 1 ? '' : 's'} from your uploaded knowledge.`
    : '';

export const TASK_TEMPLATES: Record<AgentKey, TaskTemplate[]> = {
  phone: [
    {
      key: 'inbound_reply',
      category: 'Phone & inbox',
      title: 'Draft a reply to an inbound enquiry',
      tokens: 180,
      render: ({ input, knowledge }) =>
        `Reply drafted for the inbound enquiry:\n\n"${firstSentence(input)}"\n\n` +
        bullets([
          'Acknowledged the enquiry and thanked the sender',
          'Answered the question directly in the first line',
          'Proposed two concrete slots to talk further',
          'No commitment asked for before the call',
        ]) +
        `\n\nNext: send via the connected channel once you approve.` +
        groundingNote(knowledge),
    },
    {
      key: 'call_summary',
      category: 'Phone & inbox',
      title: 'Summarise a call',
      tokens: 150,
      render: ({ input }) =>
        `Call summary:\n\n${firstSentence(input)}\n\n` +
        bullets(['Reason for the call captured', 'Outcomes and owner noted', 'Follow-up proposed with a date']) +
        `\n\nFiled to the workspace activity feed.`,
    },
  ],
  marketing: [
    {
      key: 'post_draft',
      category: 'Marketing',
      title: 'Draft a social post',
      tokens: 120,
      render: ({ input }) =>
        `Social post draft:\n\n"${firstSentence(input)}"\n\n` +
        bullets(['Hook in the first line', 'One idea per post', 'Call to action at the end']) +
        `\n\nReady to schedule on your channels after review.`,
    },
    {
      key: 'content_ideas',
      category: 'Marketing',
      title: 'Propose content ideas',
      tokens: 200,
      render: ({ input }) =>
        `Content ideas around "${firstSentence(input)}":\n\n` +
        bullets([
          'A behind-the-scenes post on how you do this today',
          'A customer story showing the outcome, not the feature',
          'A short contrarian take on the common way of doing it',
          'A checklist your audience can save and reuse',
        ]),
    },
  ],
  seo: [
    {
      key: 'keyword_ideas',
      category: 'SEO & content',
      title: 'Suggest keywords to target',
      tokens: 160,
      render: ({ input }) =>
        `Keyword opportunities for "${firstSentence(input)}":\n\n` +
        bullets([
          'The exact phrase your buyers type when they have the problem',
          'A "best/alternative" comparison variant',
          'A long-tail question form for a how-to article',
          'A local variant if you serve a specific market',
        ]) +
        `\n\nCheck search volume in Search Console before committing.`,
    },
    {
      key: 'article_outline',
      category: 'SEO & content',
      title: 'Outline an article',
      tokens: 220,
      render: ({ input }) =>
        `Article outline for "${firstSentence(input)}":\n\n` +
        bullets([
          'Intro: the problem, stated in the reader’s words',
          'Section 1: why the obvious approach falls short',
          'Section 2: your approach, step by step',
          'Section 3: a worked example with numbers',
          'Close: what to do next, one action',
        ]),
    },
  ],
  sales: [
    {
      key: 'outreach_draft',
      category: 'Sales',
      title: 'Draft a first-touch outreach message',
      tokens: 140,
      render: ({ input }) =>
        `First-touch draft:\n\n${firstSentence(input)}\n\n` +
        bullets([
          'Opens with their situation, not your product',
          'One sentence on why you specifically can help',
          'Closes with a low-friction question',
        ]) +
        `\n\nSequence it after you approve the copy.`,
    },
    {
      key: 'profit_research',
      category: 'Sales',
      title: 'Research a prospect',
      tokens: 190,
      render: ({ input }) =>
        `Prospect brief for ${firstSentence(input)}\n\n` +
        bullets([
          'Firmographics to confirm before outreach',
          'Likely trigger events to look for',
          'Suggested angle based on their role',
          'Two conversation starters that are not about you',
        ]),
    },
  ],
  accounting: [
    {
      key: 'expense_review',
      category: 'Finance',
      title: 'Review an expense',
      tokens: 130,
      render: ({ input }) =>
        `Expense review — ${firstSentence(input)}\n\n` +
        bullets(['Categorised against your chart of accounts', 'Flagged if it recurs or looks unusual', 'VAT treatment noted where it applies']) +
        `\n\nNothing is booked without your approval.`,
    },
    {
      key: 'cash_snapshot',
      category: 'Finance',
      title: 'Take a cash snapshot',
      tokens: 170,
      render: ({ input }) =>
        `Cash snapshot — ${firstSentence(input)}\n\n` +
        bullets([
          'Current position vs last month',
          'Biggest planned outflows this month',
          'Invoices overdue and by how many days',
          'Runway estimate at the current burn rate',
        ]),
    },
  ],
  legal: [
    {
      key: 'contract_checklist',
      category: 'Legal',
      title: 'Checklist a contract',
      tokens: 210,
      render: ({ input }) =>
        `Contract checklist — ${firstSentence(input)}\n\n` +
        bullets([
          'Parties and signatures all present',
          'Payment terms and late-payment consequences stated',
          'Termination and notice periods defined',
          'Liability cap and indemnities reviewed',
          'Governing law and venue match your expectations',
        ]) +
        `\n\nThis is a checklist, not legal advice — have counsel sign off.`,
    },
    {
      key: 'clause_flags',
      category: 'Legal',
      title: 'Flag risky clauses',
      tokens: 200,
      render: ({ input }) =>
        `Clauses worth a second look in "${firstSentence(input)}":\n\n` +
        bullets([
          'Anything uncapped or open-ended on your side',
          'Auto-renewal without a notice window',
          'IP assignment broader than the deal needs',
          'One-way confidentiality',
        ]),
    },
  ],
  recruiting: [
    {
      key: 'candidate_screen',
      category: 'Recruiting',
      title: 'Screen a candidate',
      tokens: 180,
      render: ({ input }) =>
        `Screening notes — ${firstSentence(input)}\n\n` +
        bullets([
          'Requirements met, with evidence from the CV',
          'Gaps to probe in the first call',
          'Signals on motivation and fit',
          'Recommendation: advance / hold / decline',
        ]),
    },
    {
      key: 'interview_plan',
      category: 'Recruiting',
      title: 'Plan an interview loop',
      tokens: 160,
      render: ({ input }) =>
        `Interview plan for ${firstSentence(input)}\n\n` +
        bullets([
          '30-min screen: motivation and logistics',
          '60-min skills: a real task from the role',
          '45-min team fit with future teammates',
          'Debrief criteria written before the loop starts',
        ]),
    },
  ],
  assistant: [
    {
      key: 'daily_briefing',
      category: 'Chief of staff',
      title: 'Prepare the daily briefing',
      tokens: 240,
      render: ({ input }) =>
        `Today's briefing:\n\n${firstSentence(input)}\n\n` +
        bullets([
          'What the team shipped yesterday',
          'What needs your decision today',
          'Enquiries waiting longer than 24h',
          'One thing worth celebrating',
        ]),
    },
    {
      key: 'route_request',
      category: 'Chief of staff',
      title: 'Route a request to the right agent',
      tokens: 120,
      render: ({ input, persona }) =>
        `Request routed by ${persona}:\n\n"${firstSentence(input)}"\n\n` +
        `Matched to the agent who owns this kind of work; they will pick it up and report back here.`,
    },
  ],
};

/** All template keys for an agent, for validation and API discovery. */
export function templatesFor(agent: AgentKey): TaskTemplate[] {
  return TASK_TEMPLATES[agent] ?? [];
}

export function findTemplate(agent: AgentKey, templateKey: string): TaskTemplate | null {
  return templatesFor(agent).find((t) => t.key === templateKey) ?? null;
}
