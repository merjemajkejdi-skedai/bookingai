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
  CREATE TABLE IF NOT EXISTS hotel_config (
    tenant_id TEXT PRIMARY KEY,
    hotel_name TEXT NOT NULL DEFAULT '',
    check_in_time TEXT NOT NULL DEFAULT '14:00',
    check_out_time TEXT NOT NULL DEFAULT '11:00',
    wifi_password TEXT,
    breakfast_hours TEXT,
    pool_hours TEXT,
    restaurant_hours TEXT,
    reception_phone TEXT,
    emergency_phone TEXT,
    timezone TEXT NOT NULL DEFAULT 'Europe/Tirane'
  );
  CREATE TABLE IF NOT EXISTS hotel_guest_stays (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'checked_in',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS hotel_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    stay_id TEXT,
    room_number TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    request_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    department TEXT NOT NULL DEFAULT 'reception',
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS hotel_faq (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS hotel_conversations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    channel_user_id TEXT NOT NULL,
    subject TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_conv_unique ON hotel_conversations(tenant_id, channel, channel_user_id);
  CREATE TABLE IF NOT EXISTS tenant_email_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'imap',
    email_address TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    imap_host TEXT,
    imap_port INTEGER DEFAULT 993,
    imap_secure INTEGER DEFAULT 1,
    smtp_host TEXT,
    smtp_port INTEGER DEFAULT 587,
    smtp_secure INTEGER DEFAULT 0,
    username TEXT,
    password_enc TEXT,
    oauth_access_token_enc TEXT,
    oauth_refresh_token_enc TEXT,
    oauth_expires_at TEXT,
    oauth_email TEXT,
    watch_folder TEXT NOT NULL DEFAULT 'SkedAI',
    answered_folder TEXT NOT NULL DEFAULT 'SkedAI/Answered',
    failed_folder TEXT NOT NULL DEFAULT 'SkedAI/Failed',
    is_enabled INTEGER NOT NULL DEFAULT 0,
    ai_enabled INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, email_address)
  );
  CREATE TABLE IF NOT EXISTS email_messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    conversation_id TEXT,
    direction TEXT NOT NULL DEFAULT 'inbound',
    rfc822_message_id TEXT NOT NULL,
    in_reply_to TEXT,
    references_header TEXT,
    from_address TEXT NOT NULL,
    from_name TEXT,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT,
    body_raw TEXT,
    provider_ref TEXT,
    sent_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, rfc822_message_id)
  );
  CREATE TABLE IF NOT EXISTS email_skipped_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    rfc822_message_id TEXT,
    from_address TEXT,
    subject TEXT,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_email_msgs_conv ON email_messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_email_msgs_tenant ON email_messages(tenant_id, created_at);
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
      `ALTER TABLE restaurant_zones ADD COLUMN IF NOT EXISTS is_vip INTEGER NOT NULL DEFAULT 0`,
      // email_001 — hotel tables (CREATE IF NOT EXISTS is idempotent on PG too)
      `CREATE TABLE IF NOT EXISTS hotel_config (tenant_id TEXT PRIMARY KEY, hotel_name TEXT NOT NULL DEFAULT '', check_in_time TEXT NOT NULL DEFAULT '14:00', check_out_time TEXT NOT NULL DEFAULT '11:00', wifi_password TEXT, breakfast_hours TEXT, pool_hours TEXT, restaurant_hours TEXT, reception_phone TEXT, emergency_phone TEXT, timezone TEXT NOT NULL DEFAULT 'Europe/Tirane')`,
      `CREATE TABLE IF NOT EXISTS hotel_guest_stays (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, room_number TEXT NOT NULL, guest_name TEXT NOT NULL, guest_phone TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'checked_in', created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE TABLE IF NOT EXISTS hotel_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, stay_id TEXT, room_number TEXT NOT NULL, guest_phone TEXT NOT NULL, request_type TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', department TEXT NOT NULL DEFAULT 'reception', priority TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), resolved_at TEXT)`,
      `CREATE TABLE IF NOT EXISTS hotel_faq (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', is_active INTEGER NOT NULL DEFAULT 1)`,
      // email_002 — hotel_conversations + email tables
      `CREATE TABLE IF NOT EXISTS hotel_conversations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'whatsapp', channel_user_id TEXT NOT NULL, subject TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_conv_unique ON hotel_conversations(tenant_id, channel, channel_user_id)`,
      `CREATE TABLE IF NOT EXISTS tenant_email_accounts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'imap', email_address TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', imap_host TEXT, imap_port INTEGER DEFAULT 993, imap_secure INTEGER DEFAULT 1, smtp_host TEXT, smtp_port INTEGER DEFAULT 587, smtp_secure INTEGER DEFAULT 0, username TEXT, password_enc TEXT, oauth_access_token_enc TEXT, oauth_refresh_token_enc TEXT, oauth_expires_at TEXT, oauth_email TEXT, watch_folder TEXT NOT NULL DEFAULT 'SkedAI', answered_folder TEXT NOT NULL DEFAULT 'SkedAI/Answered', failed_folder TEXT NOT NULL DEFAULT 'SkedAI/Failed', is_enabled INTEGER NOT NULL DEFAULT 0, ai_enabled INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_checked_at TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), UNIQUE(tenant_id, email_address))`,
      // email_003 — email_messages + email_skipped_log
      `CREATE TABLE IF NOT EXISTS email_messages (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, conversation_id TEXT, direction TEXT NOT NULL DEFAULT 'inbound', rfc822_message_id TEXT NOT NULL, in_reply_to TEXT, references_header TEXT, from_address TEXT NOT NULL, from_name TEXT, to_address TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body_text TEXT, body_raw TEXT, provider_ref TEXT, sent_message_id TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), UNIQUE(tenant_id, rfc822_message_id))`,
      `CREATE TABLE IF NOT EXISTS email_skipped_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, rfc822_message_id TEXT, from_address TEXT, subject TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE INDEX IF NOT EXISTS idx_email_msgs_conv ON email_messages(conversation_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_email_msgs_tenant ON email_messages(tenant_id, created_at)`,
      // gb_001 — General Business: business config
      `CREATE TABLE IF NOT EXISTS gb_business_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_name VARCHAR(255) NOT NULL,
  business_description TEXT,
  phone VARCHAR(50),
  website VARCHAR(255),
  email VARCHAR(255),
  opening_hours JSONB NOT NULL DEFAULT '{}',
  notification_whatsapp VARCHAR(50),
  fallback_message TEXT,
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id)
)`,
      // gb_002 — General Business: locations
      `CREATE TABLE IF NOT EXISTS gb_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_003 — General Business: FAQs
      `CREATE TABLE IF NOT EXISTS gb_faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_004 — General Business: documents
      `CREATE TABLE IF NOT EXISTS gb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  r2_key TEXT NOT NULL,
  file_size_bytes INTEGER,
  extracted_text TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_005 — General Business: departments
      `CREATE TABLE IF NOT EXISTS gb_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  whatsapp_number VARCHAR(50),
  request_types TEXT[] NOT NULL DEFAULT '{}',
  response_time_minutes INTEGER DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_006 — General Business: conversations
      `CREATE TABLE IF NOT EXISTS gb_conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  guest_phone TEXT,
  guest_name TEXT,
  guest_username TEXT,
  guest_email TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  last_message TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  channel_user_id TEXT,
  ai_paused_until TEXT,
  ai_paused_by TEXT,
  updated_at TEXT,
  last_guest_message_at TEXT,
  UNIQUE(tenant_id, channel, channel_user_id)
)`,
      `CREATE INDEX IF NOT EXISTS idx_gb_conversations_tenant ON gb_conversations(tenant_id, updated_at DESC)`,
      // gb_007 — General Business: requests
      `CREATE TABLE IF NOT EXISTS gb_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  conversation_id TEXT,
  department_id UUID,
  guest_phone TEXT,
  guest_name TEXT,
  request_type VARCHAR(100),
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  staff_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_008 — General Business: menu items
      `CREATE TABLE IF NOT EXISTS gb_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  currency VARCHAR(10) NOT NULL DEFAULT 'ALL',
  category VARCHAR(100),
  is_available BOOLEAN NOT NULL DEFAULT true,
  image_r2_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_009 — General Business: orders
      `CREATE TABLE IF NOT EXISTS gb_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  conversation_id TEXT,
  order_number VARCHAR(50) NOT NULL,
  guest_phone TEXT,
  guest_name TEXT,
  guest_instagram TEXT,
  guest_email TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  total_price DECIMAL(10,2),
  currency VARCHAR(10) NOT NULL DEFAULT 'ALL',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
      // gb_tenant_columns
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS menu_enabled BOOLEAN DEFAULT false`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_notes TEXT`,
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
