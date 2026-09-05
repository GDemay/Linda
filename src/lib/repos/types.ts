export type Role = 'owner' | 'admin' | 'member';

export type User = {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
  createdAt: string;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  onboardingStep: OnboardingStep;
  onboardingDoneAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingStep =
  | 'company_profile'
  | 'pick_goals'
  | 'hire_agents'
  | 'add_knowledge'
  | 'connect_tools'
  | 'first_run'
  | 'done';

export type Membership = { id: string; workspaceId: string; userId: string; role: Role };

export type CompanyProfile = {
  workspaceId: string;
  legalName: string;
  industry: string;
  size: string;
  website: string | null;
  description: string;
  tone: string;
  timezone: string;
  goals: string[];
};

export type WorkspaceAgent = {
  id: string;
  workspaceId: string;
  agentKey: string;
  displayName: string;
  status: 'active' | 'paused';
  config: Record<string, unknown>;
  createdAt: string;
};

export type Connection = {
  id: string;
  workspaceId: string;
  provider: string;
  status: 'connected' | 'error' | 'revoked';
  /** A connection starts read-only; only the trust contract (onboarding done) unlocks write actions. */
  accessLevel: 'read_only' | 'read_write';
  externalAccount: string | null;
  createdAt: string;
};

export type Workflow = {
  id: string;
  workspaceId: string;
  workspaceAgentId: string;
  definitionKey: string;
  name: string;
  status: 'active' | 'paused';
  triggerKind: 'manual' | 'schedule' | 'event';
  triggerConfig: Record<string, unknown>;
  inputDefaults: Record<string, unknown>;
  createdAt: string;
};

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type WorkflowRun = {
  id: string;
  workspaceId: string;
  workflowId: string;
  status: RunStatus;
  trigger: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  runAfter: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type RunStep = {
  id: string;
  runId: string;
  seq: number;
  stepKey: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export type Task = {
  id: string;
  workspaceId: string;
  agent: string;
  category: string;
  title: string;
  input: string;
  output: string | null;
  status: TaskStatus;
  tokensUsed: number;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

/** One learned fact an agent retains across runs (LIN-53). */
export type AgentMemory = {
  id: string;
  workspaceId: string;
  agentKey: string;
  content: string;
  pinned: boolean;
  source: 'manual' | 'correction';
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityEvent = {
  id: string;
  workspaceId: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  kind: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
};

/** What kind of gated effect an action has on the outside world. Drives approval copy, not per-tool rules. */
export type ActionKind = 'send' | 'post' | 'spend' | 'delete' | 'other';

// ----------------------------------------------------------------- billing

/** The defined plan vocabulary for workspaces.plan (LIN-52). */
export type PlanKey = 'trial' | 'free' | 'starter' | 'team' | 'scale';

export type SubscriptionStatus = 'trialing' | 'active' | 'canceled';

export type Subscription = {
  workspaceId: string;
  plan: PlanKey;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  updatedAt: string;
};

/** One append-only usage entry. Every meter is derived from these rows. */
export type UsageEntry = {
  id: string;
  workspaceId: string;
  agent: string;
  source: 'task' | 'workflow_run' | 'seed' | 'grant';
  sourceId: string | null;
  credits: number;
  tokens: number;
  reason: string;
  occurredAt: string;
};

/** A user-set hard monthly credit limit. Defaults to the plan's monthlyCredits. */
export type SpendCap = {
  workspaceId: string;
  monthlyLimitCredits: number;
  updatedAt: string;
};

export type InvoiceStatus = 'open' | 'paid' | 'void';

export type InvoiceLineItem = {
  id: string;
  kind: 'subscription' | 'overage';
  description: string;
  quantity: number;
  unitUsd: number;
  amountUsd: number;
};

export type Invoice = {
  id: string;
  workspaceId: string;
  number: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  currency: string;
  subtotalUsd: number;
  totalUsd: number;
  issuedAt: string;
  paidAt: string | null;
  lineItems: InvoiceLineItem[];
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// -------------------------------------------------------------- knowledge

export type KnowledgeSource = 'paste' | 'url' | 'file';

export type KnowledgeStatus = 'processing' | 'ready' | 'failed';

/**
 * One customer-uploaded document (LIN-54 / LIN-2 W8). Chunks are derived
 * data: they exist only to be retrieved for grounding and cascade away with
 * the document — deleting a document removes everything derived from it (GTM
 * reversibility promise, LIN-14).
 */
export type KnowledgeDocument = {
  id: string;
  workspaceId: string;
  source: KnowledgeSource;
  /** The URL for fetched docs, the filename for uploads, empty for pastes. */
  sourceRef: string;
  title: string;
  status: KnowledgeStatus;
  error: string | null;
  /** Agent keys this doc is scoped to; empty means visible to the whole workspace. */
  agentKeys: string[];
  chunkCount: number;
  charCount: number;
  lastUsedAt: string | null;
  createdAt: string;
};

/** Derived text extracted from a document, in reading order. Grounding retrieves these. */
export type KnowledgeChunk = {
  id: string;
  documentId: string;
  workspaceId: string;
  seq: number;
  content: string;
  createdAt: string;
};

/** One item in the workspace-level approval inbox (W6). */
export type ApprovalItem = {
  id: string;
  workspaceId: string;
  workspaceAgentId: string;
  workflowRunId: string | null;
  workflowRunStepId: string | null;
  actionKind: ActionKind;
  summary: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'payment_required'
  | 'rate_limited';

/**
 * Thrown by the service layer; API routes map `code` onto an HTTP status.
 *
 * Fields are declared and assigned explicitly rather than via constructor
 * parameter properties, which Node's --experimental-strip-types cannot erase
 * (the seed and worker scripts run this code directly under node).
 */
export class AppError extends Error {
  code: ErrorCode;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 422,
  payment_required: 402,
  rate_limited: 429,
};

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
