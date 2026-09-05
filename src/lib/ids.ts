import { randomUUID, randomBytes } from 'node:crypto';

export function id(): string {
  return randomUUID();
}

export function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * URL-safe slug with a short random suffix so two workspaces named
 * "Acme" don't collide.
 */
export function slugify(input: string): string {
  const base =
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
