import { json } from '@/lib/http.ts';

/**
 * Liveness probe for Railway's deploy healthcheck (LIN-151). Deliberately
 * DB-free: the 502 it fixes was a not-yet-ready replica during deploys, so
 * the probe only asserts that this process is serving HTTP. Anything deeper
 * (DB reachability) would turn an app hiccup into a failed deploy.
 */
export const GET = () => json({ ok: true });
