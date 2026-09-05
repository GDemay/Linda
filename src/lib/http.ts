import { NextResponse } from 'next/server';
import { getDb } from './db/index.ts';
import { authorize, authenticate } from './auth/service.ts';
import { AppError, ERROR_STATUS, type Role } from './repos/types.ts';

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
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
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

export async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError('invalid', 'expected a JSON body');
  }
}

/** Authenticated caller, no workspace scope. */
export function requireUser(req: Request) {
  return authenticate(getDb(), tokenFrom(req));
}

/** Authenticated caller scoped to a workspace, with the role floor enforced. */
export function requireWorkspace(req: Request, workspaceId: string, role: Role = 'member') {
  return authorize(getDb(), tokenFrom(req), workspaceId, role);
}
