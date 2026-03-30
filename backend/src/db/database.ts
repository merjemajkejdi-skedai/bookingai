// ---------------------------------------------------------------------------
// database.ts — PostgreSQL (production) + SQLite (local dev)
// Detects environment via DATABASE_URL env var
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';

export const isPg = !!process.env.DATABASE_URL;

export interface Stmt {
  run: (...params: unknown[]) => void;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
let pgPool: any = null;
async function getPool() {
  if (!pgPool) {
    const { Pool } = await import('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pgPool;
}

function toPg(sql: string): string {
  let i = 0; return sql.replace(/\?/g, () => `$${++i}`);
}

export async function query(sql: string, params: unknown[] = []) {
  const pool = await getPool();
  const r = await pool.query(toPg(sql), params.map(p => p ?? null));
  return r.rows as Record<string, unknown>[];
}
export async function queryOne(sql: string, params: unknown[] = []) {
  return (await query(sql, params))[0];
}
export async function queryRun(sql: string, params: unknown[] = []) {
  const pool = await getPool();
  await pool.query(toPg(sql), params.map(p => p ?? null));
}

// ── SQLite (local dev only — dynamically imported so it never loads in prod) ──
let _sqliteDb: any = null;
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bookingai.db');

function persist() {
  if (_sqliteDb) fs.writeFileSync(DB_PATH, Buffer.from(_sqliteDb.export()));
}

async function initSqlite() {
  if (_sqliteDb) return _sqliteDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs();
  _sqliteDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  return _sqliteDb;
}

function getDb() {
  if (!_sqliteDb) throw new Error('DB not initialised — call runMigrations() first');
  return _sqliteDb;
}

// ── Unified API ───────────────────────────────────────────────────────────────
export function prepare(sql: string): Stmt {
  if (isPg) return {
    run(...p) {
      getPool()
        .then(pool => pool.query(toPg(sql), p.map(v => v ?? null)))
        .catch(e => console.error('pg run:', e.message, sql.slice(0, 60)));
    },
    get() { throw new Error('Use queryOne() for pg reads'); },
    all() { throw new Error('Use query() for pg reads'); },
  };
  return {
    run(...p) { getDb().run(sql, p.map(v => v === undefined ? null : v)); persist(); },
    get(...p) {
      const s = getDb().prepare(sql);
      s.bind(p.map(v => v === undefined ? null : v));
      const row = s.step() ? s.getAsObject() : undefined;
      s.free(); return row;
    },
    all(...p) {
      const s = getDb().prepare(sql);
      s.bind(p.map(v => v === undefined ? null : v));
      const rows: Record<string, unknown>[] = [];
      while (s.step()) rows.push(s.getAsObject());
      s.free(); return rows;
    },
  };
}

export function exec(sql: string) {
  if (isPg) {
    getPool().then(p => p.query(sql)).catch(e => console.error('pg exec:', e.message));
    return;
  }
  getDb().run(sql); persist();
}

export function getDb2() { return { prepare, exec }; }

// ── Schema ────────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'barbershop',
    timezone TEXT NOT NULL DEFAULT 'Europe/Tirane',
    whatsapp_number TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT 'starter',
    is_active INTEGER NOT NULL DEFAULT 1,
    billing_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS specialists (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Specialist',
    color TEXT NOT NULL DEFAULT '#6366f1', is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS working_hours (
    id TEXT PRIMARY KEY, specialist_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL DEFAULT '09:00',
    end_time TEXT NOT NULL DEFAULT '18:00',
    is_working INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS service_groups (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS specialist_skills (
    specialist_id TEXT NOT NULL,
    service_group_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    PRIMARY KEY (specialist_id, service_group_id)
  );
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
    duration_mins INTEGER NOT NULL DEFAULT 30, price REAL NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#8b5cf6', is_active INTEGER NOT NULL DEFAULT 1,
    group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
    specialist_id TEXT NOT NULL, service_id TEXT NOT NULL,
    customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT NOT NULL DEFAULT '',
    recurrence_rule TEXT NOT NULL DEFAULT 'none',
    recurrence_group_id TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'shop_owner',
    tenant_id TEXT, is_active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS art_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '10:00',
    end_time TEXT NOT NULL DEFAULT '11:00',
    age_min INTEGER,
    age_max INTEGER,
    max_capacity INTEGER,
    price INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS event_registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    parent_phone TEXT NOT NULL DEFAULT '',
    parent_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    registered_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_spec   ON bookings(specialist_id, starts_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_tenant ON bookings(tenant_id, starts_at);
  CREATE INDEX IF NOT EXISTS idx_wh_spec         ON working_hours(specialist_id);
  CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_tenant    ON users(tenant_id);
  CREATE TABLE IF NOT EXISTS event_templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    teacher_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '10:00',
    end_time TEXT NOT NULL DEFAULT '11:00',
    age_min INTEGER,
    age_max INTEGER,
    max_capacity INTEGER,
    price INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_art_events_tenant ON art_events(tenant_id, date);
  CREATE INDEX IF NOT EXISTS idx_event_regs_event  ON event_registrations(event_id);
  CREATE INDEX IF NOT EXISTS idx_event_regs_phone  ON event_registrations(parent_phone);
  CREATE INDEX IF NOT EXISTS idx_event_templates_tenant ON event_templates(tenant_id);
  CREATE TABLE IF NOT EXISTS restaurant_zones (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6366f1',
    max_concurrent INTEGER NOT NULL DEFAULT 10,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS restaurant_tables (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 4,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS restaurant_reservations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    zone_id TEXT NOT NULL,
    table_id TEXT,
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL DEFAULT '',
    guest_count INTEGER NOT NULL DEFAULT 2,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    duration_mins INTEGER NOT NULL DEFAULT 90,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_restaurant_res_tenant ON restaurant_reservations(tenant_id, date);
  CREATE INDEX IF NOT EXISTS idx_restaurant_tables_zone ON restaurant_tables(zone_id);
`;

export async function runMigrations() {
  if (isPg) {
    const pool = await getPool();
    await pool.query(SCHEMA);
    // Safe ALTER TABLE for columns added after initial deploy
    const pgAlters = [
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NOT NULL DEFAULT 'none'`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurrence_group_id TEXT`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter'`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS billing_email TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE art_events ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE specialists ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS has_analytics INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE services ADD COLUMN IF NOT EXISTS group_id TEXT`,
      `ALTER TABLE specialists ADD COLUMN IF NOT EXISTS service_group_ids TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE restaurant_zones ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE restaurant_zones ADD COLUMN IF NOT EXISTS max_concurrent INTEGER NOT NULL DEFAULT 10`,
    ];
    for (const sql of pgAlters) {
      await pool.query(sql).catch((e: any) => console.warn('PG alter skipped:', e.message));
    }
    // Seed default prices based on tenant type (only touches rows where price is still 0)
    const priceSeeds = [
      `UPDATE art_events SET price = 2500 WHERE price = 0 AND tenant_id IN (SELECT id FROM tenants WHERE type = 'art_class')`,
      `UPDATE art_events SET price = 3500 WHERE price = 0 AND tenant_id IN (SELECT id FROM tenants WHERE type = 'art_event')`,
      `UPDATE event_templates SET price = 2500 WHERE price = 0 AND tenant_id IN (SELECT id FROM tenants WHERE type = 'art_class')`,
      `UPDATE event_templates SET price = 3500 WHERE price = 0 AND tenant_id IN (SELECT id FROM tenants WHERE type = 'art_event')`,
    ];
    for (const sql of priceSeeds) {
      await pool.query(sql).catch((e: any) => console.warn('PG price seed skipped:', e.message));
    }
    console.log('✅ PostgreSQL migrations complete');
    return;
  }
  await initSqlite();
  getDb().run(SCHEMA); persist();

  // Safe ALTER for existing local DBs
  const cols = prepare("SELECT name FROM pragma_table_info('tenants')")
    .all().map((r: any) => r.name as string);
  // Add recurrence columns if missing (safe on existing local DB)
  const bookingCols = prepare("SELECT name FROM pragma_table_info('bookings')")
    .all().map((r: any) => r.name as string);
  if (!bookingCols.includes('recurrence_rule'))
    exec("ALTER TABLE bookings ADD COLUMN recurrence_rule TEXT NOT NULL DEFAULT 'none'");
  if (!bookingCols.includes('recurrence_group_id'))
    exec('ALTER TABLE bookings ADD COLUMN recurrence_group_id TEXT');

  const svcCols = prepare("SELECT name FROM pragma_table_info('services')")
    .all().map((r: any) => r.name as string);
  if (!svcCols.includes('group_id'))
    exec('ALTER TABLE services ADD COLUMN group_id TEXT');

  const artEventCols = prepare("SELECT name FROM pragma_table_info('art_events')")
    .all().map((r: any) => r.name as string);
  if (!artEventCols.includes('price'))
    exec('ALTER TABLE art_events ADD COLUMN price INTEGER NOT NULL DEFAULT 0');

  const tmplCols = prepare("SELECT name FROM pragma_table_info('event_templates')")
    .all().map((r: any) => r.name as string);
  if (!tmplCols.includes('price'))
    exec('ALTER TABLE event_templates ADD COLUMN price INTEGER NOT NULL DEFAULT 0');

  for (const [col, def] of [
    ['whatsapp_number', "whatsapp_number TEXT NOT NULL DEFAULT ''"],
    ['plan',            "plan TEXT NOT NULL DEFAULT 'starter'"],
    ['is_active',       'is_active INTEGER NOT NULL DEFAULT 1'],
    ['billing_email',   "billing_email TEXT NOT NULL DEFAULT ''"],
    ['has_analytics',   'has_analytics INTEGER NOT NULL DEFAULT 0'],
  ] as [string,string][]) {
    if (!cols.includes(col)) exec(`ALTER TABLE tenants ADD COLUMN ${def}`);
  }
  console.log('✅ SQLite migrations complete');
}
