import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/health/route.ts';

describe('GET /api/health (LIN-151 Railway healthcheck)', () => {
  it('returns 200 { ok: true } without touching the DB', async () => {
    // The route is DB-free and takes no request argument; passing one failed
    // typecheck (TS2554) even though vitest happily ran it.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
