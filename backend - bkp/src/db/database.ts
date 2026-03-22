// ---------------------------------------------------------------------------
// Database — sql.js (pure JavaScript SQLite, no C++ compilation needed)
// Exposes prepare/exec/getDb with the same API as better-sqlite3 so all
// other files work unchanged.
// ---------------------------------------------------------------------------
import initSqlJs, { type Database as SqlJsDb } from 'sql.js';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bookingai.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db: SqlJsDb | null = null;

function persist(): void {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

export async function initDb(): Promise<SqlJsDb> {
  if (_db) return _db;
  const SQL = await initSqlJs();
  _db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  return _db;
}

function getDbRaw(): SqlJsDb {
  if (!_db) throw new Error('DB not initialised — call runMigrations() first');
  return _db;
}

export interface Stmt {
  run: (...params: unknown[]) => void;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

export function prepare(sql: string): Stmt {
  return {
    run(...params) {
      getDbRaw().run(sql, params.map(p => p === undefined ? null : p) as any);
      persist();
    },
    get(...params) {
      const stmt = getDbRaw().prepare(sql);
      stmt.bind(params.map(p => p === undefined ? null : p) as any);
      const row = stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
      stmt.free();
      return row;
    },
    all(...params) {
      const stmt = getDbRaw().prepare(sql);
      stmt.bind(params.map(p => p === undefined ? null : p) as any);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
      stmt.free();
      return rows;
    },
  };
}

export function exec(sql: string): void {
  getDbRaw().run(sql);
  persist();
}

// Drop-in replacement: getDb().prepare(sql) works the same as before
export function getDb() {
  return { prepare, exec };
}

export async function runMigrations(): Promise<void> {
  await initDb();
  exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'barbershop',
      timezone TEXT NOT NULL DEFAULT 'Europe/Tirane',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS specialists (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
      name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Specialist',
      color TEXT NOT NULL DEFAULT '#6366f1', is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS working_hours (
      id TEXT PRIMARY KEY, specialist_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '18:00',
      is_working INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
      duration_mins INTEGER NOT NULL DEFAULT 30, price REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#8b5cf6', is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
      specialist_id TEXT NOT NULL, service_id TEXT NOT NULL,
      customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_spec   ON bookings(specialist_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_wh_spec         ON working_hours(specialist_id);
  `);
  console.log('✅ Database migrations complete');
}
