import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../src/lib/db/index.ts';
import { findUserByEmail } from '../src/lib/repos/accounts.ts';
import { importLegacyLeads } from '../src/lib/analytics/importLegacyLeads.ts';
import { leadStatsSummary } from '../src/lib/analytics/leads.ts';

/**
 * LIN-58: historical prototype signups are re-imported into a fresh database
 * so /api/stats keeps reporting the real sales history (2 external active
 * trials from the 2026-09-05 reddit cohort) instead of resetting to zero.
 */
describe('legacy lead import', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'linda-legacy-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function writeLeads(rows: unknown[]): string {
    const file = path.join(dir, `leads-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(rows));
    return file;
  }

  it('imports deduped legacy leads and preserves their original signup timestamps', () => {
    const d = createTestDb();
    const file = writeLeads([
      { name: 'Sarah Connor', email: 'sarah.connor@example.com', createdAt: '2026-09-05T17:16:37.034Z' },
      { name: 'Sarah Connor', email: 'sarah.connor@example.com', createdAt: '2026-09-05T17:16:14.787Z' },
      { name: 'Alex Rivera', email: 'alex.rivera@example.com', createdAt: '2026-09-05T17:13:11.881Z' },
      { name: 'Alex Rivera', email: 'alex.rivera@example.com', createdAt: '2026-09-05T16:41:41.827Z' },
    ]);

    const result = importLegacyLeads(d, file);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);

    const sarah = findUserByEmail(d, 'sarah.connor@example.com');
    expect(sarah?.createdAt).toBe('2026-09-05T17:16:14.787Z'); // earliest submission wins

    const stats = leadStatsSummary(d);
    expect(stats.totalSignups).toBe(2);
    expect(stats.uniqueExternalSignups).toBe(2);
    expect(stats.externalActiveTrials).toBe(2);
    expect(stats.internalSignups).toBe(0);
  });

  it('is idempotent and never overwrites an existing account', () => {
    const d = createTestDb();
    const file = writeLeads([{ name: 'Alex Rivera', email: 'alex.rivera@example.com' }]);

    expect(importLegacyLeads(d, file).imported).toBe(1);
    const second = importLegacyLeads(d, file);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('tolerates a missing or malformed legacy file', () => {
    const d = createTestDb();
    expect(importLegacyLeads(d, path.join(dir, 'does-not-exist.json'))).toEqual({ imported: 0, skipped: 0 });

    const malformed = path.join(dir, `malformed-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(malformed, 'not json');
    expect(importLegacyLeads(d, malformed)).toEqual({ imported: 0, skipped: 0 });
  });
});
