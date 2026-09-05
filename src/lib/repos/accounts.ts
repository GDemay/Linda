import { createHash } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { id, token } from '../ids.ts';
import {
  AppError,
  parseJson,
  type CompanyProfile,
  type Connection,
  type Membership,
  type OnboardingStep,
  type Role,
  type User,
  type Workspace,
  type WorkspaceAgent,
} from './types.ts';

type Row = Record<string, any>;

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// ------------------------------------------------------------------- users

function toUser(r: Row): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    emailVerifiedAt: r.email_verified_at ?? null,
    createdAt: r.created_at,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createUser(
  db: Db,
  input: { email: string; name: string; passwordHash: string },
): User {
  const ts = nowIso();
  const row = {
    id: id(),
    email: input.email.trim(),
    email_lower: normalizeEmail(input.email),
    name: input.name.trim(),
    password_hash: input.passwordHash,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO users (id, email, email_lower, name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.email, row.email_lower, row.name, row.password_hash, row.created_at, row.updated_at);
  return toUser({ ...row, email_verified_at: null });
}

export function findUserByEmail(db: Db, email: string): (User & { passwordHash: string }) | null {
  const r = db.prepare('SELECT * FROM users WHERE email_lower = ?').get(normalizeEmail(email)) as Row | undefined;
  return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
}

export function findUserById(db: Db, userId: string): User | null {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
  return r ? toUser(r) : null;
}

export function markEmailVerified(db: Db, userId: string): void {
  db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    userId,
  );
}

// ---------------------------------------------------------------- sessions

/** We store only the hash, so a database leak can't be replayed as a login. */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createSession(db: Db, userId: string): { token: string; expiresAt: string } {
  const raw = token();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(raw),
    userId,
    nowIso(),
    expiresAt,
  );
  return { token: raw, expiresAt };
}

export function resolveSession(db: Db, raw: string): User | null {
  const r = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(hashToken(raw), nowIso()) as Row | undefined;
  return r ? toUser(r) : null;
}

export function revokeSession(db: Db, raw: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
    nowIso(),
    hashToken(raw),
  );
}

export function revokeAllSessions(db: Db, userId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
    nowIso(),
    userId,
  );
}

/** Housekeeping: drop sessions that expired more than a day ago. */
export function purgeExpiredSessions(db: Db): number {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const res = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(cutoff);
  return Number(res.changes ?? 0);
}

// -------------------------------------------------------------- workspaces

function toWorkspace(r: Row): Workspace {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    plan: r.plan,
    onboardingStep: r.onboarding_step as OnboardingStep,
    onboardingDoneAt: r.onboarding_done_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

export function createWorkspace(db: Db, input: { name: string; slug: string }): Workspace {
  const ts = nowIso();
  const wid = id();
  db.prepare(
    'INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(wid, input.name.trim(), input.slug, ts, ts);
  return toWorkspace(db.prepare('SELECT * FROM workspaces WHERE id = ?').get(wid) as Row);
}

export function findWorkspace(db: Db, workspaceId: string): Workspace | null {
  const r = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as Row | undefined;
  return r ? toWorkspace(r) : null;
}

export function setOnboardingStep(db: Db, workspaceId: string, step: OnboardingStep): void {
  const done = step === 'done' ? nowIso() : null;
  db.prepare(
    `UPDATE workspaces SET onboarding_step = ?, updated_at = ?,
       onboarding_done_at = COALESCE(onboarding_done_at, ?) WHERE id = ?`,
  ).run(step, nowIso(), done, workspaceId);
}

export function addMembership(db: Db, workspaceId: string, userId: string, role: Role): Membership {
  const mid = id();
  db.prepare(
    'INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(mid, workspaceId, userId, role, nowIso());
  return { id: mid, workspaceId, userId, role };
}

export function findMembership(db: Db, workspaceId: string, userId: string): Membership | null {
  const r = db
    .prepare('SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as Row | undefined;
  return r ? { id: r.id, workspaceId: r.workspace_id, userId: r.user_id, role: r.role } : null;
}

/** Cascades to memberships, agents, connections, workflows, runs, activity, approvals. */
export function deleteWorkspace(db: Db, workspaceId: string): void {
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
}

/** Cascades to sessions and memberships. Does not touch workspaces the user belongs to. */
export function deleteUser(db: Db, userId: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function countMemberships(db: Db, workspaceId: string): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?').get(workspaceId) as Row;
  return Number(r.n);
}

export function listWorkspacesForUser(db: Db, userId: string): (Workspace & { role: Role })[] {
  const rows = db
    .prepare(
      `SELECT w.*, m.role FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = ? ORDER BY w.created_at ASC`,
    )
    .all(userId) as Row[];
  return rows.map((r) => ({ ...toWorkspace(r), role: r.role as Role }));
}

// --------------------------------------------------------- company profile

export function upsertCompanyProfile(
  db: Db,
  workspaceId: string,
  p: Omit<CompanyProfile, 'workspaceId'>,
): CompanyProfile {
  db.prepare(
    `INSERT INTO company_profiles
       (workspace_id, legal_name, industry, size, website, description, tone, timezone, goals, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       legal_name=excluded.legal_name, industry=excluded.industry, size=excluded.size,
       website=excluded.website, description=excluded.description, tone=excluded.tone,
       timezone=excluded.timezone, goals=excluded.goals, updated_at=excluded.updated_at`,
  ).run(
    workspaceId,
    p.legalName,
    p.industry,
    p.size,
    p.website ?? null,
    p.description,
    p.tone,
    p.timezone,
    JSON.stringify(p.goals ?? []),
    nowIso(),
  );
  return { workspaceId, ...p };
}

export function findCompanyProfile(db: Db, workspaceId: string): CompanyProfile | null {
  const r = db.prepare('SELECT * FROM company_profiles WHERE workspace_id = ?').get(workspaceId) as
    | Row
    | undefined;
  if (!r) return null;
  return {
    workspaceId: r.workspace_id,
    legalName: r.legal_name,
    industry: r.industry,
    size: r.size,
    website: r.website ?? null,
    description: r.description,
    tone: r.tone,
    timezone: r.timezone,
    goals: parseJson<string[]>(r.goals, []),
  };
}

export function setCompanyGoals(db: Db, workspaceId: string, goals: string[]): void {
  db.prepare('UPDATE company_profiles SET goals = ?, updated_at = ? WHERE workspace_id = ?').run(
    JSON.stringify(goals),
    nowIso(),
    workspaceId,
  );
}

// ------------------------------------------------------------------ agents

function toWorkspaceAgent(r: Row): WorkspaceAgent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentKey: r.agent_key,
    displayName: r.display_name,
    status: r.status,
    config: parseJson<Record<string, unknown>>(r.config, {}),
    createdAt: r.created_at,
  };
}

/** Hiring the same agent twice is a no-op that refreshes config, not an error. */
export function hireAgent(
  db: Db,
  input: { workspaceId: string; agentKey: string; displayName: string; config: Record<string, unknown> },
): WorkspaceAgent {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO workspace_agents (id, workspace_id, agent_key, display_name, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, agent_key) DO UPDATE SET
       display_name=excluded.display_name, config=excluded.config, updated_at=excluded.updated_at`,
  ).run(id(), input.workspaceId, input.agentKey, input.displayName, JSON.stringify(input.config), ts, ts);
  return findWorkspaceAgentByKey(db, input.workspaceId, input.agentKey)!;
}

export function findWorkspaceAgentByKey(db: Db, workspaceId: string, agentKey: string): WorkspaceAgent | null {
  const r = db
    .prepare('SELECT * FROM workspace_agents WHERE workspace_id = ? AND agent_key = ?')
    .get(workspaceId, agentKey) as Row | undefined;
  return r ? toWorkspaceAgent(r) : null;
}

export function findWorkspaceAgent(db: Db, workspaceId: string, agentId: string): WorkspaceAgent | null {
  const r = db
    .prepare('SELECT * FROM workspace_agents WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, agentId) as Row | undefined;
  return r ? toWorkspaceAgent(r) : null;
}

export function listWorkspaceAgents(db: Db, workspaceId: string): WorkspaceAgent[] {
  return (
    db.prepare('SELECT * FROM workspace_agents WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId) as Row[]
  ).map(toWorkspaceAgent);
}

export function updateWorkspaceAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
  patch: { status?: 'active' | 'paused'; config?: Record<string, unknown>; displayName?: string },
): WorkspaceAgent | null {
  const current = findWorkspaceAgent(db, workspaceId, agentId);
  if (!current) return null;
  db.prepare(
    'UPDATE workspace_agents SET status = ?, config = ?, display_name = ?, updated_at = ? WHERE id = ?',
  ).run(
    patch.status ?? current.status,
    JSON.stringify(patch.config ?? current.config),
    patch.displayName ?? current.displayName,
    nowIso(),
    agentId,
  );
  return findWorkspaceAgent(db, workspaceId, agentId);
}

// ------------------------------------------------------------- connections

function toConnection(r: Row): Connection {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    provider: r.provider,
    status: r.status,
    accessLevel: r.access_level,
    externalAccount: r.external_account ?? null,
    createdAt: r.created_at,
  };
}

export function connectProvider(
  db: Db,
  input: { workspaceId: string; provider: string; externalAccount?: string; secretRef?: string },
): Connection {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO connections (id, workspace_id, provider, external_account, secret_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, provider) DO UPDATE SET
       status='connected', external_account=excluded.external_account,
       secret_ref=excluded.secret_ref, updated_at=excluded.updated_at`,
  ).run(id(), input.workspaceId, input.provider, input.externalAccount ?? null, input.secretRef ?? null, ts, ts);
  return findConnection(db, input.workspaceId, input.provider)!;
}

export function findConnection(db: Db, workspaceId: string, provider: string): Connection | null {
  const r = db
    .prepare('SELECT * FROM connections WHERE workspace_id = ? AND provider = ?')
    .get(workspaceId, provider) as Row | undefined;
  return r ? toConnection(r) : null;
}

export function listConnections(db: Db, workspaceId: string): Connection[] {
  return (
    db.prepare('SELECT * FROM connections WHERE workspace_id = ? ORDER BY provider ASC').all(workspaceId) as Row[]
  ).map(toConnection);
}

export function connectedProviders(db: Db, workspaceId: string): string[] {
  return (
    db
      .prepare("SELECT provider FROM connections WHERE workspace_id = ? AND status = 'connected'")
      .all(workspaceId) as Row[]
  ).map((r) => r.provider as string);
}

export function disconnectProvider(db: Db, workspaceId: string, provider: string): void {
  db.prepare(
    "UPDATE connections SET status = 'revoked', secret_ref = NULL, access_level = 'read_only', updated_at = ? WHERE workspace_id = ? AND provider = ?",
  ).run(nowIso(), workspaceId, provider);
}

/**
 * Promotes a connection to read-write. Only allowed once the workspace has
 * completed onboarding (the trust contract) — a connection can never be
 * write-enabled while the workspace is still mid-setup.
 */
export function grantWriteAccess(db: Db, workspaceId: string, provider: string): Connection {
  const workspace = findWorkspace(db, workspaceId);
  if (!workspace?.onboardingDoneAt) {
    throw new AppError('forbidden', 'trust contract not satisfied: onboarding is not complete');
  }
  const connection = findConnection(db, workspaceId, provider);
  if (!connection || connection.status !== 'connected') {
    throw new AppError('conflict', `${provider} is not connected`);
  }
  db.prepare('UPDATE connections SET access_level = ?, updated_at = ? WHERE workspace_id = ? AND provider = ?').run(
    'read_write',
    nowIso(),
    workspaceId,
    provider,
  );
  return findConnection(db, workspaceId, provider)!;
}
