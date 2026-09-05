import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as statsGET } from '../src/app/api/stats/route.ts';
import { GET as leadsGET } from '../src/app/api/leads/route.ts';
import { getDb, resetDbSingleton } from '../src/lib/db/index.ts';
import { signup } from '../src/lib/auth/service.ts';

/**
 * LIN-74: /api/stats must serve aggregates only to the public, and the
 * per-user detail (recentSignups, /api/leads) must sit behind ADMIN_TOKEN.
 * When ADMIN_TOKEN is unset the gate fails closed — never open.
 */

// Point the route's getDb() singleton at a throwaway in-memory database.
const prevDbPath = process.env.LINDA_DB_PATH;
const prevAdminToken = process.env.ADMIN_TOKEN;
const EMAIL = 'gate-check@example.com';

beforeAll(async () => {
  process.env.LINDA_DB_PATH = ':memory:';
  resetDbSingleton();
  await signup(getDb(), {
    email: EMAIL,
    name: 'Gate Check',
    password: 'correct-horse-battery',
    workspaceName: 'Gate',
  });
});

afterAll(() => {
  resetDbSingleton();
  if (prevDbPath === undefined) delete process.env.LINDA_DB_PATH;
  else process.env.LINDA_DB_PATH = prevDbPath;
  if (prevAdminToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = prevAdminToken;
});

function setAdminToken(value: string | undefined) {
  if (value === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = value;
}

// Route handlers are wrapped by `handle`, which takes (req, ctx).
const call = (handler: (req: Request, ctx: unknown) => Promise<Response>, url: string, token?: string) =>
  handler(new Request(url, token ? { headers: { 'x-admin-token': token } } : undefined), undefined);

describe('GET /api/stats — PII gate', () => {
  it('serves aggregates only to anonymous callers (no emails anywhere in the body)', async () => {
    setAdminToken('sekrit');
    const res = await call(statsGET, 'http://localhost/api/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.totalSignups).toBeGreaterThanOrEqual(1);
    expect(body).not.toHaveProperty('recentSignups');
    expect(body).not.toHaveProperty('recentTasks');
    expect(JSON.stringify(body)).not.toContain(EMAIL);
  });

  it('returns recentSignups/recentTasks with a matching admin token', async () => {
    setAdminToken('sekrit');
    const res = await call(statsGET, 'http://localhost/api/stats', 'sekrit');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recentSignups.map((l: { email: string }) => l.email)).toContain(EMAIL);
    expect(body.recentTasks).toEqual([]);
  });

  it('rejects a wrong token: aggregates only, no detail', async () => {
    setAdminToken('sekrit');
    const res = await call(statsGET, 'http://localhost/api/stats', 'wrong');
    const body = await res.json();
    expect(body).not.toHaveProperty('recentSignups');
    expect(JSON.stringify(body)).not.toContain(EMAIL);
  });

  it('fails closed when ADMIN_TOKEN is not configured', async () => {
    setAdminToken(undefined);
    const res = await call(statsGET, 'http://localhost/api/stats', 'anything');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('recentSignups');
    expect(JSON.stringify(body)).not.toContain(EMAIL);
  });
});

describe('GET /api/leads — full-PII endpoint', () => {
  it('is disabled (503) when ADMIN_TOKEN is not configured', async () => {
    setAdminToken(undefined);
    const res = await call(leadsGET, 'http://localhost/api/leads');
    expect(res.status).toBe(503);
  });

  it('returns 401 without a token and 200 with the right one', async () => {
    setAdminToken('sekrit');
    const denied = await call(leadsGET, 'http://localhost/api/leads');
    expect(denied.status).toBe(401);

    const ok = await call(leadsGET, 'http://localhost/api/leads', 'sekrit');
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.leads.map((l: { email: string }) => l.email)).toContain(EMAIL);
  });

  it('accepts ?token= as well as the header (legacy prototype parity)', async () => {
    setAdminToken('sekrit');
    const res = await call(leadsGET, 'http://localhost/api/leads?token=sekrit');
    expect(res.status).toBe(200);
  });
});
