import { describe, expect, it } from 'vitest';
import { db, newAccount, uniqueEmail, VALID_PASSWORD } from './helpers.ts';
import { authenticate, authorize, login, logout, signup } from '../src/lib/auth/service.ts';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../src/lib/auth/password.ts';
import { addMembership, listWorkspacesForUser, purgeExpiredSessions } from '../src/lib/repos/accounts.ts';
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

  it('defaults the workspace name from the user name', async () => {
    const d = db();
    const r = await signup(d, { email: uniqueEmail(), name: 'Grace Hopper', password: VALID_PASSWORD });
    expect(r.workspace.name).toBe("Grace's workspace");
  });

  it('rejects a duplicate email case-insensitively', async () => {
    const d = db();
    const email = uniqueEmail();
    await newAccount(d, { email });
    await expect(newAccount(d, { email: email.toUpperCase() })).rejects.toMatchObject({ code: 'conflict' });
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
