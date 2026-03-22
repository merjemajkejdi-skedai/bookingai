// ---------------------------------------------------------------------------
// db.ts — unified async helpers that work on both SQLite and PostgreSQL
//
// Use these in routes instead of prepare().get() / prepare().all()
// They automatically use the right backend.
// ---------------------------------------------------------------------------
import { isPg, prepare, query, queryOne, queryRun } from './database.js';

export { queryRun };

// SELECT multiple rows
export async function dbAll(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  if (isPg) return query(sql, params);
  return prepare(sql).all(...params);
}

// SELECT one row
export async function dbGet(sql: string, ...params: unknown[]): Promise<Record<string, unknown> | undefined> {
  if (isPg) return queryOne(sql, params);
  return prepare(sql).get(...params);
}

// INSERT / UPDATE / DELETE
export async function dbRun(sql: string, ...params: unknown[]): Promise<void> {
  if (isPg) return queryRun(sql, params);
  prepare(sql).run(...params);
}

// Execute raw SQL (migrations, multi-statement)
export async function dbExec(sql: string): Promise<void> {
  if (isPg) { const { getPool } = await import('./database.js'); return; }
  const { exec } = await import('./database.js');
  exec(sql);
}
