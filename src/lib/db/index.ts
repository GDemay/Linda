import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyMigrations } from './migrations.ts';

export type Db = DatabaseSync;

/**
 * Row values SQLite can hand back. `null` is included because every nullable
 * column comes back as null rather than undefined.
 */
export type SqlValue = string | number | bigint | Uint8Array | null;

let singleton: Db | null = null;

function openDatabase(location: string): Db {
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true });
  const db = new DatabaseSync(location);
  // WAL keeps readers from blocking the workflow runner's writes.
  if (location !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  applyMigrations(db);
  return db;
}

/** Process-wide database handle, migrated on first use. */
export function getDb(): Db {
  if (!singleton) {
    singleton = openDatabase(process.env.LINDA_DB_PATH ?? '.data/linda.db');
  }
  return singleton;
}

/** A fresh, migrated, in-memory database. Used by tests. */
export function createTestDb(): Db {
  return openDatabase(':memory:');
}

export function resetDbSingleton(): void {
  singleton?.close();
  singleton = null;
}

/**
 * Runs `fn` inside a transaction. Nested calls join the outer transaction
 * rather than opening a second one (SQLite has no nested BEGIN).
 */
let txDepth = 0;
export function transaction<T>(db: Db, fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec('BEGIN');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
