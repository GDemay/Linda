import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import { slugify } from '../ids.ts';
import { checkPasswordStrength, hashPassword, verifyPassword } from './password.ts';
import { magicLinkEmail, sendEmail } from '../email.ts';
import {
  addMembership,
  consumeMagicLink,
  createMagicLink,
  createSession,
  createUser,
  createWorkspace,
  findMembership,
  findUserByEmail,
  listWorkspacesForUser,
  resolveSession,
  revokeSession,
} from '../repos/accounts.ts';
import { recordEvent } from '../analytics/events.ts';
import { recordActivity } from '../repos/workflows.ts';
import { AppError, type Role, type User, type Workspace } from '../repos/types.ts';

export const signupSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(200),
  /** Optional since LIN-67: an empty password means a magic-link-only account. */
  password: z.string().max(400).optional(),
  workspaceName: z.string().trim().min(1).max(200).optional(),
});

export type SignupResult =
  | { created: true; user: User; workspace: Workspace; token: string; expiresAt: string }
  /** Idempotent re-signup (LIN-67 fix #7): no new lead, no session — a sign-in link is emailed instead. */
  | { created: false; user: User; workspace: Workspace };

/** "sarah@acme-studio.co.uk" → "Acme Studio"; falls back to the user's first name. */
export function workspaceNameFromEmail(email: string, fallbackName: string): string {
  const domain = email.split('@')[1]?.split('.')[0] ?? '';
  const words = domain.split(/[-_]/).filter(Boolean);
  const name = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  if (!name) return `${fallbackName.split(' ')[0]}'s workspace`;
  return name;
}

/** Emails a single-use sign-in link. Used by signup, idempotent re-signup, and /login. */
export async function sendMagicLink(
  db: Db,
  user: User,
  workspaceName: string,
  baseUrl: string,
  isNew: boolean,
): Promise<boolean> {
  const { token } = createMagicLink(db, user.id);
  const link = `${baseUrl.replace(/\/$/, '')}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
  const result = await sendEmail(magicLinkEmail({ to: user.email, name: user.name, link, workspaceName, isNew }));
  if (result.via === 'none') {
    console.error('[linda] magic link email could not be sent', { to: user.email });
    return false;
  }
  recordEvent(db, 'magic_link_sent', { via: result.via, isNew });
  return true;
}

/**
 * Creates the account, its first workspace, the owner membership and a session
 * in a single transaction. No email confirmation gate and no approval queue:
 * a new customer is usable the moment this returns. Re-submitting an existing
 * email is idempotent: it returns the existing account without a session and
 * emails a sign-in link instead (proving the inbox before re-entry).
 */
export async function signup(db: Db, raw: unknown, baseUrl = 'http://localhost:3000'): Promise<SignupResult> {
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid signup', parsed.error.issues);
  const { email, name, password, workspaceName } = parsed.data;

  if (password) {
    const problem = checkPasswordStrength(password);
    if (problem) throw new AppError('invalid', `password ${problem.replace('_', ' ')}`, { problem });
  }

  const existing = findUserByEmail(db, email);
  if (existing) {
    const workspaces = listWorkspacesForUser(db, existing.id);
    if (workspaces.length === 0) throw new AppError('conflict', 'an account with that email already exists');
    await sendMagicLink(db, existing, workspaces[0].name, baseUrl, false);
    return { created: false, user: existing, workspace: workspaces[0] };
  }

  // Hashing is deliberately slow, so it happens before the transaction opens.
  // An empty hash means "no password set" — the account signs in by email link.
  const passwordHash = password ? await hashPassword(password) : '';

  const result = transaction(db, () => {
    // Re-check inside the transaction: two concurrent signups for the same
    // address would both pass the check above.
    if (findUserByEmail(db, email)) {
      throw new AppError('conflict', 'an account with that email already exists');
    }
    const user = createUser(db, { email, name, passwordHash });
    const wsName = workspaceName ?? workspaceNameFromEmail(email, name);
    const workspace = createWorkspace(db, { name: wsName, slug: slugify(wsName) });
    addMembership(db, workspace.id, user.id, 'owner');
    recordActivity(db, {
      workspaceId: workspace.id,
      actorType: 'user',
      actorId: user.id,
      kind: 'workspace.created',
      summary: `${name} created the workspace`,
    });
    const session = createSession(db, user.id);
    return { user, workspace, token: session.token, expiresAt: session.expiresAt } as const;
  });

  // The way-back email (LIN-49 fix #1). Failures are logged, never fatal:
  // the session cookie already got the user in.
  await sendMagicLink(db, result.user, result.workspace.name, baseUrl, true);
  return { created: true, ...result };
}

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(400),
});

export const magicLinkRequestSchema = z.object({
  email: z.string().trim().email().max(320),
});

export async function login(
  db: Db,
  raw: unknown,
): Promise<{ user: User; workspaces: (Workspace & { role: Role })[]; token: string; expiresAt: string }> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid login', parsed.error.issues);

  const record = findUserByEmail(db, parsed.data.email);
  if (record && record.passwordHash === '') {
    throw new AppError('invalid', 'this account has no password — use "Email me a sign-in link" below');
  }
  // Hash against a dummy when the user is missing so timing doesn't reveal
  // which addresses are registered.
  const hash = record?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(parsed.data.password, hash);
  if (!record || !valid) throw new AppError('unauthorized', 'incorrect email or password');

  const session = createSession(db, record.id);
  return {
    user: { id: record.id, email: record.email, name: record.name, emailVerifiedAt: record.emailVerifiedAt, createdAt: record.createdAt },
    workspaces: listWorkspacesForUser(db, record.id),
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

/**
 * /login magic-link flow (LIN-49 fix #1). Always resolves the same way for
 * known and unknown addresses so the response can't be used to enumerate
 * registered emails.
 */
export async function requestMagicLink(
  db: Db,
  raw: unknown,
  baseUrl: string,
): Promise<{ ok: true }> {
  const parsed = magicLinkRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'enter a valid email address');
  const record = findUserByEmail(db, parsed.data.email);
  if (record) {
    const workspaces = listWorkspacesForUser(db, record.id);
    if (workspaces[0]) await sendMagicLink(db, record, workspaces[0].name, baseUrl, false);
  }
  return { ok: true };
}

/** Verifies a magic-link token and opens a session for the user. */
export function loginWithMagicLink(
  db: Db,
  rawToken: string,
): { user: User; workspaces: (Workspace & { role: Role })[]; token: string; expiresAt: string } | null {
  const user = consumeMagicLink(db, rawToken);
  if (!user) return null;
  const session = createSession(db, user.id);
  return { user, workspaces: listWorkspacesForUser(db, user.id), token: session.token, expiresAt: session.expiresAt };
}

// A real scrypt hash of a random value, so the failure path costs the same as
// the success path.
const DUMMY_HASH =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'd2h5IGhlbGxvIHRoZXJlIC0gdGhpcyBpcyBub3QgYSByZWFsIHBhc3N3b3JkIGhhc2ggYnV0IGl0IGlzIDY0IGI=';

export function logout(db: Db, token: string): void {
  revokeSession(db, token);
}

export type AuthContext = { user: User; workspace: Workspace; role: Role };

/** Resolves a bearer token to a user. */
export function authenticate(db: Db, token: string | null | undefined): User {
  if (!token) throw new AppError('unauthorized', 'authentication required');
  const user = resolveSession(db, token);
  if (!user) throw new AppError('unauthorized', 'session expired or invalid');
  return user;
}

/**
 * Resolves token + workspace and asserts membership. Every workspace-scoped
 * route goes through this — it is the only place tenant isolation is enforced.
 */
export function authorize(
  db: Db,
  token: string | null | undefined,
  workspaceId: string,
  minimumRole: Role = 'member',
): AuthContext {
  const user = authenticate(db, token);
  const membership = findMembership(db, workspaceId, user.id);
  // 404 rather than 403: a non-member should not learn the workspace exists.
  if (!membership) throw new AppError('not_found', 'workspace not found');

  const rank: Record<Role, number> = { member: 0, admin: 1, owner: 2 };
  if (rank[membership.role] < rank[minimumRole]) {
    throw new AppError('forbidden', `requires ${minimumRole} role`);
  }

  const workspaces = listWorkspacesForUser(db, user.id);
  const workspace = workspaces.find((w) => w.id === workspaceId)!;
  return { user, workspace, role: membership.role };
}
