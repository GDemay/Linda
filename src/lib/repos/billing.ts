import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id } from '../ids.ts';
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  PlanKey,
  SpendCap,
  Subscription,
  SubscriptionStatus,
  UsageEntry,
} from './types.ts';

type Row = Record<string, any>;

// ------------------------------------------------------------- usage ledger

/** Append-only. Meters are derived with sumUsageCreditsSince, never stored. */
export function appendUsage(
  db: Db,
  input: {
    workspaceId: string;
    agent: string;
    source: UsageEntry['source'];
    sourceId?: string | null;
    credits: number;
    tokens: number;
    reason: string;
    occurredAt?: string;
  },
): UsageEntry {
  const entry: UsageEntry = {
    id: id(),
    workspaceId: input.workspaceId,
    agent: input.agent,
    source: input.source,
    sourceId: input.sourceId ?? null,
    credits: input.credits,
    tokens: input.tokens,
    reason: input.reason,
    occurredAt: input.occurredAt ?? nowIso(),
  };
  db.prepare(
    `INSERT INTO usage_ledger (id, workspace_id, agent, source, source_id, credits, tokens, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.workspaceId,
    entry.agent,
    entry.source,
    entry.sourceId,
    entry.credits,
    entry.tokens,
    entry.reason,
    entry.occurredAt,
  );
  return entry;
}

export function sumUsageCreditsSince(db: Db, workspaceId: string, sinceIso: string): number {
  const r = db
    .prepare('SELECT COALESCE(SUM(credits), 0) AS total FROM usage_ledger WHERE workspace_id = ? AND occurred_at >= ?')
    .get(workspaceId, sinceIso) as Row;
  return Number(r.total);
}

export function usageSourceExists(db: Db, source: UsageEntry['source'], sourceId: string): boolean {
  const r = db.prepare('SELECT 1 AS hit FROM usage_ledger WHERE source = ? AND source_id = ? LIMIT 1').get(source, sourceId);
  return Boolean(r);
}

export function listUsage(db: Db, workspaceId: string, limit = 100): UsageEntry[] {
  const rows = db
    .prepare('SELECT * FROM usage_ledger WHERE workspace_id = ? ORDER BY occurred_at DESC, rowid DESC LIMIT ?')
    .all(workspaceId, limit) as Row[];
  return rows.map(toUsageEntry);
}

function toUsageEntry(r: Row): UsageEntry {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agent: r.agent,
    source: r.source,
    sourceId: r.source_id ?? null,
    credits: Number(r.credits),
    tokens: Number(r.tokens),
    reason: r.reason,
    occurredAt: r.occurred_at,
  };
}

// -------------------------------------------------------------- spend caps

export function setSpendCap(db: Db, workspaceId: string, monthlyLimitCredits: number): SpendCap {
  db.prepare(
    `INSERT INTO spend_caps (workspace_id, monthly_limit_credits, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       monthly_limit_credits = excluded.monthly_limit_credits, updated_at = excluded.updated_at`,
  ).run(workspaceId, monthlyLimitCredits, nowIso());
  return findSpendCap(db, workspaceId)!;
}

export function findSpendCap(db: Db, workspaceId: string): SpendCap | null {
  const r = db.prepare('SELECT * FROM spend_caps WHERE workspace_id = ?').get(workspaceId) as Row | undefined;
  return r
    ? { workspaceId: r.workspace_id, monthlyLimitCredits: Number(r.monthly_limit_credits), updatedAt: r.updated_at }
    : null;
}

// ------------------------------------------------------------ subscriptions

export function upsertSubscription(
  db: Db,
  input: { workspaceId: string; plan: PlanKey; status: SubscriptionStatus; periodStart: string; periodEnd: string },
): Subscription {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO subscriptions
       (workspace_id, plan, status, current_period_start, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       plan = excluded.plan, status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end, updated_at = excluded.updated_at`,
  ).run(input.workspaceId, input.plan, input.status, input.periodStart, input.periodEnd, ts, ts);
  return findSubscription(db, input.workspaceId)!;
}

export function findSubscription(db: Db, workspaceId: string): Subscription | null {
  const r = db.prepare('SELECT * FROM subscriptions WHERE workspace_id = ?').get(workspaceId) as Row | undefined;
  return r ? toSubscription(r) : null;
}

function toSubscription(r: Row): Subscription {
  return {
    workspaceId: r.workspace_id,
    plan: r.plan,
    status: r.status,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ----------------------------------------------------------------- invoices

export type InvoiceLineInput = {
  kind: InvoiceLineItem['kind'];
  description: string;
  quantity: number;
  unitUsd: number;
};

export function insertInvoice(
  db: Db,
  input: {
    workspaceId: string;
    status?: InvoiceStatus;
    periodStart: string;
    periodEnd: string;
    issuedAt?: string;
    paidAt?: string | null;
    lines: InvoiceLineInput[];
  },
): Invoice {
  const iid = id();
  const issuedAt = input.issuedAt ?? nowIso();
  const status = input.status ?? 'paid';
  const subtotal = round2(input.lines.reduce((sum, l) => sum + l.quantity * l.unitUsd, 0));
  db.prepare(
    `INSERT INTO invoices
       (id, workspace_id, number, status, period_start, period_end, currency, subtotal_usd, total_usd, issued_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?)`,
  ).run(
    iid,
    input.workspaceId,
    nextInvoiceNumber(db, input.workspaceId, issuedAt),
    status,
    input.periodStart,
    input.periodEnd,
    subtotal,
    subtotal,
    issuedAt,
    input.paidAt ?? (status === 'paid' ? issuedAt : null),
  );
  for (const line of input.lines) {
    db.prepare(
      `INSERT INTO invoice_line_items (id, invoice_id, kind, description, quantity, unit_usd, amount_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id(), iid, line.kind, line.description, line.quantity, line.unitUsd, round2(line.quantity * line.unitUsd));
  }
  return findInvoice(db, input.workspaceId, iid)!;
}

/** Human-shaped: INV-202609-0001, sequential per workspace. */
function nextInvoiceNumber(db: Db, workspaceId: string, issuedAt: string): string {
  const r = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE workspace_id = ?').get(workspaceId) as Row;
  const seq = Number(r.n) + 1;
  const ym = issuedAt.slice(0, 10).replace(/-/g, '').slice(0, 6);
  return `INV-${ym}-${String(seq).padStart(4, '0')}`;
}

export function listInvoices(db: Db, workspaceId: string): Invoice[] {
  const rows = db
    .prepare('SELECT * FROM invoices WHERE workspace_id = ? ORDER BY issued_at DESC, rowid DESC')
    .all(workspaceId) as Row[];
  if (rows.length === 0) return [];
  const items = db
    .prepare(
      `SELECT li.* FROM invoice_line_items li
       JOIN invoices i ON i.id = li.invoice_id
       WHERE i.workspace_id = ? ORDER BY li.rowid ASC`,
    )
    .all(workspaceId) as Row[];
  const byInvoice = new Map<string, InvoiceLineItem[]>();
  for (const li of items) {
    const list = byInvoice.get(li.invoice_id) ?? [];
    list.push({
      id: li.id,
      kind: li.kind,
      description: li.description,
      quantity: Number(li.quantity),
      unitUsd: Number(li.unit_usd),
      amountUsd: Number(li.amount_usd),
    });
    byInvoice.set(li.invoice_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    number: r.number,
    status: r.status,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    currency: r.currency,
    subtotalUsd: Number(r.subtotal_usd),
    totalUsd: Number(r.total_usd),
    issuedAt: r.issued_at,
    paidAt: r.paid_at ?? null,
    lineItems: byInvoice.get(r.id) ?? [],
  }));
}

export function findInvoice(db: Db, workspaceId: string, invoiceId: string): Invoice | null {
  const all = listInvoices(db, workspaceId);
  return all.find((i) => i.id === invoiceId) ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
