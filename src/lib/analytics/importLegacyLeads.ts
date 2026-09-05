import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index.ts';
import { createUser, findUserByEmail } from '../repos/accounts.ts';
import { normalizeEmail } from './leads.ts';

/**
 * LIN-58: the prototype captured signups in legacy/prototype/leads.json. When
 * the platform boots against a fresh database (first deploy, volume loss),
 * re-import those historical leads so /api/stats keeps reporting the real
 * sales history instead of resetting to zero. Idempotent: existing users are
 * matched by normalized email and left untouched, so re-running is a no-op.
 */

// Overridable so a fresh DB can be reseeded from a volume file (LINDA_LEGACY_LEADS_PATH)
// without keeping prospect PII in the repo. See the PII follow-up on LIN-59.
const LEGACY_LEADS_FILE =
  process.env.LINDA_LEGACY_LEADS_PATH ??
  path.join(process.cwd(), 'legacy', 'prototype', 'leads.json');

/** Not a valid scrypt encoding, so verifyPassword() always rejects it. */
const LEGACY_PASSWORD_HASH = '!legacy-imported';

type LegacyLeadRow = {
  email?: unknown;
  name?: unknown;
  createdAt?: unknown;
};

export type ImportResult = { imported: number; skipped: number };

export function importLegacyLeads(db: Db, filePath: string = LEGACY_LEADS_FILE): ImportResult {
  if (!existsSync(filePath)) return { imported: 0, skipped: 0 };

  let rows: LegacyLeadRow[];
  try {
    rows = JSON.parse(readFileSync(filePath, 'utf8')) as LegacyLeadRow[];
  } catch {
    return { imported: 0, skipped: 0 };
  }
  if (!Array.isArray(rows)) return { imported: 0, skipped: 0 };

  // Dedupe by normalized email, earliest submission wins — same rule the
  // stats pipeline applies, so the import never resurrects removed duplicates.
  const byEmail = new Map<string, LegacyLeadRow>();
  for (const row of rows) {
    const email = normalizeEmail(String(row?.email ?? ''));
    if (!email.includes('@')) continue;
    const existing = byEmail.get(email);
    if (!existing || String(row.createdAt ?? '') < String(existing.createdAt ?? '')) {
      byEmail.set(email, row);
    }
  }

  let imported = 0;
  let skipped = 0;
  for (const [email, row] of byEmail) {
    if (findUserByEmail(db, email)) {
      skipped++;
      continue;
    }
    const createdAt = typeof row.createdAt === 'string' && row.createdAt ? row.createdAt : new Date().toISOString();
    const user = createUser(db, {
      email,
      name: String(row.name ?? '').trim() || email,
      passwordHash: LEGACY_PASSWORD_HASH,
    });
    // createUser stamps "now"; restore the original signup timestamp so
    // cohort/recent-signup ordering matches the prototype history.
    db.prepare('UPDATE users SET created_at = ?, updated_at = ? WHERE id = ?').run(
      createdAt,
      createdAt,
      user.id,
    );
    imported++;
  }

  return { imported, skipped };
}
