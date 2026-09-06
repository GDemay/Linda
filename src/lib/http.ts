import { NextResponse } from 'next/server';
import { getDb } from './db/index.ts';
import { authorize, authenticate } from './auth/service.ts';
import { resolveSession } from './repos/accounts.ts';
import { AppError, ERROR_STATUS, type Role, type User } from './repos/types.ts';

export const SESSION_COOKIE = 'linda_session';

/** Reads the session token from the cookie, falling back to a bearer header. */
export function tokenFrom(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (cookie) {
    for (const part of cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
    }
  }
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export function sessionCookie(token: string, expiresAt: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  // `Secure` is right for the https deployment, but `next start` also runs
  // with NODE_ENV=production and serves plain http on localhost, where the
  // cookie can be dropped (it broke the Playwright UI-QA suite's API flow).
  // Local e2e/UI-QA servers set LINDA_INSECURE_COOKIES=1 to keep it off.
  if (process.env.NODE_ENV === 'production' && !process.env.LINDA_INSECURE_COOKIES) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body as Record<string, unknown>, init);
}

/**
 * Wraps a handler so AppError becomes the right status code and anything
 * unexpected becomes a 500 without leaking internals to the client.
 */
export function handle(fn: (req: Request, ctx: any) => Promise<Response> | Response) {
  return async (req: Request, ctx: any): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof AppError) {
        return json({ error: err.message, code: err.code, details: err.details }, { status: ERROR_STATUS[err.code] });
      }
      console.error('[linda] unhandled error', err);
      return json({ error: 'internal error', code: 'internal' }, { status: 500 });
    }
  };
}

export async function body<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError('invalid', 'expected a JSON body');
  }
}

/**
 * Public origin for links in outbound email. Behind Railway's proxy req.url
 * carries the internal origin (https://localhost:8080), so prefer the
 * forwarded host/proto headers, with APP_ORIGIN as a deterministic override.
 */
export function publicOrigin(req: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** Authenticated caller, no workspace scope. */
export function requireUser(req: Request) {
  return authenticate(getDb(), tokenFrom(req));
}

/**
 * Caller if a valid session is present, null otherwise — for endpoints a
 * public page probes (e.g. GET /api/auth/me) where a 401 would surface as a
 * console error for every anonymous visitor.
 */
export function optionalUser(req: Request): User | null {
  const token = tokenFrom(req);
  if (!token) return null;
  return resolveSession(getDb(), token);
}

/** Authenticated caller scoped to a workspace, with the role floor enforced. */
export function requireWorkspace(req: Request, workspaceId: string, role: Role = 'member') {
  return authorize(getDb(), tokenFrom(req), workspaceId, role);
}
