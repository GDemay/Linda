import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import { slugify } from '../ids.ts';
import { checkPasswordStrength, hashPassword, verifyPassword } from './password.ts';
import {
  addMembership,
  createSession,
  createUser,
  createWorkspace,
  findMembership,
  findUserByEmail,
  listWorkspacesForUser,
  resolveSession,
  revokeSession,
} from '../repos/accounts.ts';
import { recordActivity } from '../repos/workflows.ts';
import { AppError, type Role, type User, type Workspace } from '../repos/types.ts';

export const signupSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(400),
  workspaceName: z.string().trim().min(1).max(200).optional(),
});

export type SignupResult = {
  user: User;
  workspace: Workspace;
  token: string;
  expiresAt: string;
};

/**
 * Creates the account, its first workspace, the owner membership and a session
 * in a single transaction. No email confirmation gate and no approval queue:
 * a new customer is usable the moment this returns.
 */
export async function signup(db: Db, raw: unknown): Promise<SignupResult> {
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid signup', parsed.error.issues);
  const { email, name, password, workspaceName } = parsed.data;

  const problem = checkPasswordStrength(password);
  if (problem) throw new AppError('invalid', `password ${problem.replace('_', ' ')}`, { problem });

  if (findUserByEmail(db, email)) {
    throw new AppError('conflict', 'an account with that email already exists');
  }

  // Hashing is deliberately slow, so it happens before the transaction opens.
  const passwordHash = await hashPassword(password);

  return transaction(db, () => {
    // Re-check inside the transaction: two concurrent signups for the same
    // address would both pass the check above.
    if (findUserByEmail(db, email)) {
      throw new AppError('conflict', 'an account with that email already exists');
    }
    const user = createUser(db, { email, name, passwordHash });
    const wsName = workspaceName ?? `${name.split(' ')[0]}'s workspace`;
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
    return { user, workspace, token: session.token, expiresAt: session.expiresAt };
  });
}

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(400),
});

export async function login(
  db: Db,
  raw: unknown,
): Promise<{ user: User; workspaces: (Workspace & { role: Role })[]; token: string; expiresAt: string }> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('invalid', 'invalid login', parsed.error.issues);

  const record = findUserByEmail(db, parsed.data.email);
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
