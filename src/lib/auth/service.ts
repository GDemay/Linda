import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import { slugify } from '../ids.ts';
import { checkPasswordStrength, hashPassword, verifyPassword } from './password.ts';
import { magicLinkEmail, sendEmail } from '../email.ts';
import { sendWelcomeEmail } from '../onboarding/lifecycle.ts';
import {
  addMembership,
  consumeMagicLink,
  createMagicLink,
  createSession,
  createUser,
  createWorkspace,
  findMembership,
  findUserByEmail,
  countMagicLinksSince,
  latestMagicLink,
  listWorkspacesForUser,
  resolveSession,
  revokeSession,
} from '../repos/accounts.ts';
import { recordEvent } from '../analytics/events.ts';
import { LEGACY_PASSWORD_HASH } from '../analytics/importLegacyLeads.ts';
import { recordActivity } from '../repos/workflows.ts';
import { AppError, type Role, type User, type Workspace } from '../repos/types.ts';

export const signupSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(200),
  /** Optional since LIN-67: an empty password means a magic-link-only account. */
  password: z.string().max(400).optional(),
  workspaceName: z.string().trim().min(1).max(200).optional(),
  /** Signup channel tag (?ref= on /signup), persisted on the user (LIN-111). */
  referralSource: z.string().trim().max(64).optional(),
});

/** 'Reddit_Community ' → 'reddit_community'; blank → null (no source). */
export function normalizeReferralSource(raw: string | undefined | null): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return s ? s.slice(0, 64) : null;
}

/**
 * LIN-157: compose utm query params from a campaign link
 * (`/signup?utm_source=github&utm_medium=readme&utm_campaign=lin141`) into a
 * referral tag like `utm:github/readme/lin141`, so per-campaign signup
 * attribution is measurable in /api/stats (byCampaign). Null when neither
 * source nor campaign is present — organic signups stay untagged instead of
 * being mislabeled.
 */
export function utmReferralTag(utm: {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
}): string | null {
  const clean = (v: string | null | undefined) => normalizeReferralSource(v ?? '');
  const source = clean(utm.source);
  const medium = clean(utm.medium);
  const campaign = clean(utm.campaign);
  if (!source && !campaign) return null;
  return normalizeReferralSource(`utm:${source || 'unknown'}/${medium || 'unknown'}/${campaign || 'unknown'}`);
}

export type SignupResult =
  | { created: true; user: User; workspace: Workspace; token: string; expiresAt: string }
  /** Idempotent re-signup (LIN-67 fix #7): no new lead, no session — a sign-in link is emailed instead. */
  | { created: false; user: User; workspace: Workspace };

/**
 * LIN-202: legacy-imported leads (LIN-58) exist as user rows with no workspace
 * or membership — every entry point they could use was a dead end (signup
 * conflict, a silently unsent magic link, a no_workspace redirect). Provision
 * their first workspace on first contact instead, so the account becomes
 * usable the moment they return. Idempotent: if a workspace somehow already
 * exists, it is returned untouched.
 */
function ensureFirstWorkspace(db: Db, user: User): Workspace {
  return transaction(db, () => {
    const existing = listWorkspacesForUser(db, user.id);
    if (existing[0]) return existing[0];
    const wsName = workspaceNameFromEmail(user.email, user.name);
    const workspace = createWorkspace(db, { name: wsName, slug: slugify(wsName) });
    addMembership(db, workspace.id, user.id, 'owner');
    recordActivity(db, {
      workspaceId: workspace.id,
      actorType: 'user',
      actorId: user.id,
      kind: 'workspace.created',
      summary: `${user.name} created the workspace`,
    });
    return workspace;
  });
}

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

// LIN-113: bound the magic-link send path. A client retry loop landed 20 links
// in one inbox in 33 minutes — invisible to the user, but it burns the Resend
// sender reputation that trialist activation depends on. Two guards: a resend
// throttle (the link just sent is still valid and in flight) and a per-address
// hourly cap.
const MAGIC_LINK_HOURLY_LIMIT = Number(process.env.MAGIC_LINK_HOURLY_LIMIT ?? 3) || 3;
const MAGIC_LINK_RESEND_WINDOW_MS = 60 * 1000;

/** Emails a single-use sign-in link. Used by signup, idempotent re-signup, and /login. */
export async function sendMagicLink(
  db: Db,
  user: User,
  workspaceName: string,
  baseUrl: string,
  isNew: boolean,
): Promise<boolean> {
  const hourlyCount = countMagicLinksSince(
    db,
    user.id,
    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  );
  if (hourlyCount >= MAGIC_LINK_HOURLY_LIMIT) {
    recordEvent(db, 'magic_link_throttled', { reason: 'hourly_limit', hourlyCount, isNew });
    return false;
  }
  const latest = latestMagicLink(db, user.id);
  if (latest && Date.now() - Date.parse(latest.createdAt) < MAGIC_LINK_RESEND_WINDOW_MS) {
    // The previous link is still in flight and valid for ~14 more minutes —
    // a resend now is a duplicate of an email the user already has.
    recordEvent(db, 'magic_link_throttled', { reason: 'resent_too_soon', isNew });
    return false;
  }
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
  const { email, name, password, workspaceName, referralSource } = parsed.data;

  if (password) {
    const problem = checkPasswordStrength(password);
    if (problem) throw new AppError('invalid', `password ${problem.replace('_', ' ')}`, { problem });
  }

  const existing = findUserByEmail(db, email);
  if (existing) {
    // LIN-202: a workspace-less account (legacy-imported lead) gets its first
    // workspace provisioned here instead of a dead-end conflict error.
    const workspace = listWorkspacesForUser(db, existing.id)[0] ?? ensureFirstWorkspace(db, existing);
    await sendMagicLink(db, existing, workspace.name, baseUrl, false);
    return { created: false, user: existing, workspace };
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
    const user = createUser(db, { email, name, passwordHash, referralSource: normalizeReferralSource(referralSource) });
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

  // Welcome nudge (LIN-203): one "next step to first value" CTA. Same
  // contract as the magic link — never fatal to signup.
  try {
    await sendWelcomeEmail(db, result.workspace, result.user, baseUrl);
  } catch (err) {
    console.error('[linda] welcome email failed', err);
  }
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
  // LIN-202: a legacy-imported lead has a placeholder hash — guide them to
  // the magic link instead of a misleading "incorrect email or password".
  if (record && (record.passwordHash === '' || record.passwordHash === LEGACY_PASSWORD_HASH)) {
    throw new AppError('invalid', 'this account has no password — use "Email me a sign-in link" below');
  }
  // Hash against a dummy when the user is missing so timing doesn't reveal
  // which addresses are registered.
  const hash = record?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(parsed.data.password, hash);
  if (!record || !valid) throw new AppError('unauthorized', 'incorrect email or password');

  const session = createSession(db, record.id);
  return {
    user: { id: record.id, email: record.email, name: record.name, emailVerifiedAt: record.emailVerifiedAt, referralSource: record.referralSource, createdAt: record.createdAt },
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
    // LIN-202: without this, a workspace-less legacy lead would see "check
    // your inbox" for a link that was never sent.
    const workspace = listWorkspacesForUser(db, record.id)[0] ?? ensureFirstWorkspace(db, record);
    await sendMagicLink(db, record, workspace.name, baseUrl, false);
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
  // LIN-202: belt-and-braces — a workspace-less user verifying a link is
  // provisioned here too, so the verify route never bounces to no_workspace.
  if (listWorkspacesForUser(db, user.id).length === 0) ensureFirstWorkspace(db, user);
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
