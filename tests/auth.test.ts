import { describe, expect, it } from 'vitest';
import { db, newAccount, uniqueEmail, VALID_PASSWORD } from './helpers.ts';
import {
  authenticate,
  authorize,
  login,
  loginWithMagicLink,
  logout,
  requestMagicLink,
  signup,
  workspaceNameFromEmail,
} from '../src/lib/auth/service.ts';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../src/lib/auth/password.ts';
import {
  addMembership,
  createMagicLink,
  listWorkspacesForUser,
  purgeExpiredSessions,
} from '../src/lib/repos/accounts.ts';
import { AppError } from '../src/lib/repos/types.ts';

describe('password hashing', () => {
  it('round-trips and rejects the wrong password', async () => {
    const hash = await hashPassword('a-very-good-password');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('a-very-good-password', hash)).toBe(true);
    expect(await verifyPassword('a-very-good-passwore', hash)).toBe(false);
  });

  it('salts, so identical passwords hash differently', async () => {
    expect(await hashPassword('same-password-here')).not.toBe(await hashPassword('same-password-here'));
  });

  it('rejects a malformed hash rather than throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3$bad')).toBe(false);
  });

  it('enforces length and a common-password denylist', () => {
    expect(checkPasswordStrength('short')).toBe('too_short');
    expect(checkPasswordStrength('password123')).toBe('too_common');
    expect(checkPasswordStrength('x'.repeat(201))).toBe('too_long');
    expect(checkPasswordStrength('a-perfectly-fine-one')).toBeNull();
  });
});

describe('signup', () => {
  it('creates user, workspace, owner membership and session atomically', async () => {
    const d = db();
    const r = await newAccount(d);
    expect(r.user.email).toContain('@');
    expect(r.workspace.name).toBe('Acme');
    expect(r.workspace.onboardingStep).toBe('company_profile');
    expect(r.token).toBeTruthy();

    const ws = listWorkspacesForUser(d, r.user.id);
    expect(ws).toHaveLength(1);
    expect(ws[0].role).toBe('owner');
  });

  it('infers the workspace name from the email domain (LIN-67 fix #5)', async () => {
    const d = db();
    const r = await signup(d, {
      email: `grace-${process.pid}@acme-studio.example`,
      name: 'Grace Hopper',
      password: VALID_PASSWORD,
    });
    expect(r.created).toBe(true);
    if (!r.created) throw new Error('unreachable');
    expect(r.workspace.name).toBe('Acme Studio');
  });

  it('is idempotent on email: re-signup returns the existing workspace, no session (LIN-67 fix #7)', async () => {
    const d = db();
    const email = uniqueEmail();
    const first = await newAccount(d, { email });
    const again = await signup(d, { email: email.toUpperCase(), name: 'Someone Else', password: VALID_PASSWORD });
    expect(again.created).toBe(false);
    if (again.created) throw new Error('unreachable');
    // Same account and workspace — no duplicate lead was recorded.
    expect(again.user.id).toBe(first.user.id);
    expect(again.workspace.id).toBe(first.workspace.id);
    expect(listWorkspacesForUser(d, first.user.id)).toHaveLength(1);
    // And no session token was handed out without proving the inbox.
    expect('token' in again && again.token).toBeFalsy();
    // A sign-in link was emailed so the returning user can get back in.
    const links = d.prepare('SELECT * FROM magic_link_tokens WHERE user_id = ?').all(first.user.id);
    expect(links.length).toBeGreaterThan(0);
  });

  it('allows signup without a password (magic-link-only account)', async () => {
    const d = db();
    const email = uniqueEmail();
    const r = await signup(d, { email, name: 'No Password', workspaceName: 'Acme' });
    expect(r.created).toBe(true);
    // Password login is refused with a pointer to the link flow instead.
    await expect(login(d, { email, password: VALID_PASSWORD })).rejects.toThrow(/no password/);
    // The signup itself already queued a way-back link.
    const links = d.prepare('SELECT COUNT(*) AS n FROM magic_link_tokens').get() as { n: number };
    expect(links.n).toBeGreaterThan(0);
  });

  it('rejects a weak password before creating anything', async () => {
    const d = db();
    const email = uniqueEmail();
    await expect(signup(d, { email, name: 'A', password: 'short' })).rejects.toMatchObject({ code: 'invalid' });
    // Nothing was persisted, so the address is still free.
    await expect(newAccount(d, { email })).resolves.toBeTruthy();
  });

  it('rejects an invalid email', async () => {
    const d = db();
    await expect(signup(d, { email: 'nope', name: 'A', password: VALID_PASSWORD })).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('login and sessions', () => {
  it('logs in with correct credentials', async () => {
    const d = db();
    const email = uniqueEmail();
    await newAccount(d, { email });
    const r = await login(d, { email, password: VALID_PASSWORD });
    expect(r.workspaces).toHaveLength(1);
    expect(authenticate(d, r.token).email.toLowerCase()).toBe(email.toLowerCase());
  });

  it('rejects a wrong password and an unknown user identically', async () => {
    const d = db();
    const email = uniqueEmail();
    await newAccount(d, { email });
    await expect(login(d, { email, password: 'wrong-password-here' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(login(d, { email: uniqueEmail(), password: VALID_PASSWORD })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('invalidates the token on logout', async () => {
    const d = db();
    const r = await newAccount(d);
    logout(d, r.token);
    expect(() => authenticate(d, r.token)).toThrow(AppError);
  });

  it('rejects a missing or bogus token', () => {
    const d = db();
    expect(() => authenticate(d, null)).toThrow(/authentication required/);
    expect(() => authenticate(d, 'made-up')).toThrow(/expired or invalid/);
  });

  it('stores a hash, never the raw token', async () => {
    const d = db();
    const r = await newAccount(d);
    const rows = d.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(rows.some((row) => row.id === r.token)).toBe(false);
  });

  it('purges only long-expired sessions', async () => {
    const d = db();
    const r = await newAccount(d);
    expect(purgeExpiredSessions(d)).toBe(0);
    d.prepare('UPDATE sessions SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
    expect(purgeExpiredSessions(d)).toBe(1);
    expect(() => authenticate(d, r.token)).toThrow();
  });
});

describe('magic-link login (LIN-67 / LIN-49 fix #1)', () => {
  it('round-trips: consume once, session opens, address marked verified, second use fails', async () => {
    const d = db();
    const acct = await newAccount(d);
    await requestMagicLink(d, { email: acct.user.email }, 'https://linda.test');
    const { token } = createMagicLink(d, acct.user.id);

    const session = loginWithMagicLink(d, token);
    expect(session?.user.id).toBe(acct.user.id);
    expect(session?.workspaces[0]?.id).toBe(acct.workspace.id);
    expect(authenticate(d, session!.token).id).toBe(acct.user.id);

    // Single-use: the same token never opens a second session.
    expect(loginWithMagicLink(d, token)).toBeNull();

    const row = d.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(acct.user.id) as {
      email_verified_at: string | null;
    };
    expect(row.email_verified_at).toBeTruthy();
  });

  it('answers unknown emails identically, so addresses cannot be enumerated', async () => {
    const d = db();
    await expect(requestMagicLink(d, { email: 'nobody@nowhere.example' }, 'https://linda.test')).resolves.toEqual({
      ok: true,
    });
    const links = d.prepare('SELECT COUNT(*) AS n FROM magic_link_tokens').get() as { n: number };
    expect(links.n).toBe(0);
  });

  it('rejects unknown and expired tokens', async () => {
    const d = db();
    expect(loginWithMagicLink(d, 'garbage-token')).toBeNull();
    const acct = await newAccount(d);
    const { token } = createMagicLink(d, acct.user.id);
    d.prepare("UPDATE magic_link_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ?").run(
      acct.user.id,
    );
    expect(loginWithMagicLink(d, token)).toBeNull();
  });

  it('derives a sensible workspace name from an email domain', () => {
    expect(workspaceNameFromEmail('sarah@acme-studio.co.uk', 'Sarah Jenkins')).toBe('Acme Studio');
    expect(workspaceNameFromEmail('sarah@agency.com', 'Sarah Jenkins')).toBe('Agency');
    expect(workspaceNameFromEmail('sarah@x.com', 'Sarah Jenkins')).toBe('X');
  });
});

describe('workspace authorization', () => {
  it('grants access to a member', async () => {
    const d = db();
    const r = await newAccount(d);
    const ctx = authorize(d, r.token, r.workspace.id);
    expect(ctx.role).toBe('owner');
    expect(ctx.workspace.id).toBe(r.workspace.id);
  });

  it("hides another tenant's workspace behind a 404", async () => {
    const d = db();
    const a = await newAccount(d);
    const b = await newAccount(d);
    expect(() => authorize(d, b.token, a.workspace.id)).toThrow(/workspace not found/);
    try {
      authorize(d, b.token, a.workspace.id);
    } catch (err) {
      expect((err as AppError).code).toBe('not_found');
    }
  });

  it('enforces the role floor', async () => {
    const d = db();
    const owner = await newAccount(d);
    const member = await newAccount(d);
    addMembership(d, owner.workspace.id, member.user.id, 'member');

    expect(authorize(d, member.token, owner.workspace.id, 'member').role).toBe('member');
    expect(() => authorize(d, member.token, owner.workspace.id, 'admin')).toThrow(/requires admin/);
    expect(() => authorize(d, member.token, owner.workspace.id, 'owner')).toThrow(/requires owner/);
    // The owner clears every bar.
    expect(authorize(d, owner.token, owner.workspace.id, 'owner').role).toBe('owner');
  });

  it('rejects an unauthenticated caller before touching the workspace', () => {
    const d = db();
    expect(() => authorize(d, null, 'whatever')).toThrow(/authentication required/);
  });
});
