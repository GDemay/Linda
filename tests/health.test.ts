import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/health/route.ts';

describe('GET /api/health (LIN-151 Railway healthcheck)', () => {
  it('returns 200 { ok: true } without touching the DB', async () => {
    const res = await GET(new Request('https://localhost:8080/api/health'), {} as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
