import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP-recommended scrypt parameters (N=2^17, r=8, p=1).
const PARAMS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEYLEN = 64;

/** Encoded as `scrypt$N$r$p$salt$hash` so parameters can change without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  try {
    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common';

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwertyui',
  'qwerty123', 'iloveyou', 'letmein1', 'welcome1', 'admin123', 'changeme',
]);

/** Length + denylist only; we deliberately don't impose character-class rules. */
export function checkPasswordStrength(password: string): PasswordProblem | null {
  if (password.length < 10) return 'too_short';
  // scrypt runs over the whole input; cap it so a huge body can't burn CPU.
  if (password.length > 200) return 'too_long';
  if (COMMON.has(password.toLowerCase())) return 'too_common';
  return null;
}
