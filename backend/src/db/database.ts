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
    survey_enabled INTEGER NOT NULL DEFAULT 0,
    menus_enabled INTEGER NOT NULL DEFAULT 0,
    twilio_dept_template_sid TEXT,
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
    recurrence_group_id TEXT,
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
  CREATE TABLE IF NOT EXISTS art_class_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    classes_per_month INTEGER NOT NULL DEFAULT 4,
    price INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS art_special_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    min_capacity INTEGER,
    max_capacity INTEGER,
    price INTEGER NOT NULL DEFAULT 0,
    teacher_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
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
  CREATE TABLE IF NOT EXISTS hotel_guest_stays (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'checked_in',
    survey_sent INTEGER NOT NULL DEFAULT 0,
    survey_score INTEGER,
    survey_sent_at TEXT,
    survey_replied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS hotel_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    stay_id TEXT,
    room_number TEXT NOT NULL,
    guest_name TEXT,
    guest_phone TEXT NOT NULL,
    request_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    department TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    resolved_at TEXT,
    in_progress_at TEXT,
    resolved_by TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS hotel_faq (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS hotel_config (
    tenant_id TEXT PRIMARY KEY,
    hotel_name TEXT NOT NULL,
    check_in_time TEXT NOT NULL DEFAULT '14:00',
    check_out_time TEXT NOT NULL DEFAULT '11:00',
    wifi_password TEXT,
    breakfast_hours TEXT,
    pool_hours TEXT,
    restaurant_hours TEXT,
    reception_phone TEXT,
    emergency_phone TEXT,
    location_url TEXT,
    menu_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'Europe/Tirane',
    ask_guest_identity INTEGER NOT NULL DEFAULT 1,
    message_forward    INTEGER NOT NULL DEFAULT 1,
    review_platform_url TEXT,
    review_platform_name TEXT NOT NULL DEFAULT 'Booking.com',
    survey_positive_threshold INTEGER NOT NULL DEFAULT 8,
    survey_negative_message TEXT NOT NULL DEFAULT 'We are truly sorry your experience did not meet your expectations. Your feedback is very important to us and we will use it to improve. We hope to have the opportunity to welcome you back for a much better stay.',
    survey_positive_message TEXT NOT NULL DEFAULT 'We are so glad you enjoyed your stay! It would mean the world to us if you could share your experience online — it only takes a minute and helps us welcome more wonderful guests like you.',
    front_office_phone TEXT,
    fallback_message TEXT,
    ask_maintenance_photo INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS restaurant_config (
    tenant_id TEXT PRIMARY KEY,
    location_url TEXT,
    menu_url TEXT
  );
  CREATE TABLE IF NOT EXISTS hotel_blocked_numbers (
    tenant_id  TEXT NOT NULL,
    phone      TEXT NOT NULL,
    label      TEXT,
    staff_name TEXT,
    staff_role TEXT,
    is_staff   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (tenant_id, phone)
  );
  CREATE TABLE IF NOT EXISTS hotel_conversations (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    guest_phone           TEXT NOT NULL,
    room_number           TEXT,
    messages              TEXT NOT NULL DEFAULT '[]',
    last_message          TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at            TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    last_guest_message_at TEXT,
    ai_paused_until       TEXT,
    ai_paused_by          TEXT,
    UNIQUE (tenant_id, guest_phone)
  );
  CREATE INDEX IF NOT EXISTS idx_hotel_conv_tenant  ON hotel_conversations(tenant_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_hotel_stays_phone  ON hotel_guest_stays(tenant_id, guest_phone);
  CREATE INDEX IF NOT EXISTS idx_hotel_requests_status ON hotel_requests(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_hotel_faq_tenant   ON hotel_faq(tenant_id);
  CREATE TABLE IF NOT EXISTS skedai_config (
    tenant_id TEXT PRIMARY KEY,
    forward_phone TEXT NOT NULL DEFAULT '',
    calendly_url TEXT NOT NULL DEFAULT '',
    support_faq TEXT NOT NULL DEFAULT '[]',
    health_check_urls TEXT NOT NULL DEFAULT '[]',
    industries TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS hotel_departments (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    name                  TEXT NOT NULL,
    whatsapp              TEXT NOT NULL,
    request_types         TEXT NOT NULL DEFAULT '[]',
    is_active             INTEGER NOT NULL DEFAULT 1,
    response_time_minutes INTEGER NOT NULL DEFAULT 30,
    language              TEXT NOT NULL DEFAULT 'en',
    scheduling_enabled    INTEGER NOT NULL DEFAULT 0,
    after_hours_message   TEXT,
    created_at            TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_hotel_depts_tenant ON hotel_departments(tenant_id);
  CREATE TABLE IF NOT EXISTS hotel_department_schedules (
    id                    TEXT PRIMARY KEY,
    department_id         TEXT NOT NULL,
    tenant_id             TEXT NOT NULL,
    day_type              TEXT NOT NULL DEFAULT 'both',
    start_time            TEXT NOT NULL,
    end_time              TEXT NOT NULL,
    response_time_minutes INTEGER NOT NULL DEFAULT 30,
    display_order         INTEGER DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_dept_schedules_dept ON hotel_department_schedules(department_id);
  CREATE TABLE IF NOT EXISTS hotel_reviews (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    source             TEXT NOT NULL DEFAULT 'booking',
    reviewer_name      TEXT,
    score              REAL,
    score_max          REAL NOT NULL DEFAULT 10,
    review_date        TEXT,
    positive_text      TEXT,
    negative_text      TEXT,
    full_review_text   TEXT,
    language           TEXT NOT NULL DEFAULT 'en',
    suggested_response TEXT,
    final_response     TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    is_flagged         INTEGER NOT NULL DEFAULT 0,
    sentiment_score    REAL,
    flag_reason        TEXT,
    raw_email          TEXT,
    owner_notified     INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    replied_at         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hotel_reviews_tenant  ON hotel_reviews(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_hotel_reviews_status  ON hotel_reviews(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_hotel_reviews_flagged ON hotel_reviews(tenant_id, is_flagged);
  CREATE TABLE IF NOT EXISTS message_log (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    direction    TEXT NOT NULL,
    provider     TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_message_log_tenant  ON message_log(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_log_created ON message_log(created_at);
  CREATE TABLE IF NOT EXISTS hotel_menus (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    name          TEXT NOT NULL,
    menu_type     TEXT NOT NULL DEFAULT 'other',
    description   TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    file_url      TEXT,
    file_name     TEXT,
    file_type     TEXT,
    keywords      TEXT NOT NULL DEFAULT '[]',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS hotel_menu_items (
    id            TEXT PRIMARY KEY,
    menu_id       TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    price         REAL,
    currency      TEXT NOT NULL DEFAULT 'ALL',
    category      TEXT,
    is_available  INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_hotel_menus_tenant    ON hotel_menus(tenant_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_hotel_menu_items_menu ON hotel_menu_items(menu_id, display_order);
  CREATE TABLE IF NOT EXISTS shop_config (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL UNIQUE,
    shop_name TEXT,
    opening_hours TEXT,
    estimated_pickup_minutes INTEGER DEFAULT 15,
    pickup_mode TEXT DEFAULT 'estimated',
    agent_personality TEXT DEFAULT 'friendly',
    fallback_message TEXT DEFAULT 'We are temporarily unavailable. Please try again shortly.',
    address TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    tiktok_url TEXT,
    website_url TEXT,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS shop_menu_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS shop_menu_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    category_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    currency TEXT DEFAULT 'ALL',
    photo_url TEXT,
    photo_filename TEXT,
    stock_type TEXT DEFAULT 'unlimited',
    stock_limit INTEGER,
    stock_used INTEGER DEFAULT 0,
    stock_last_reset TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS shop_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_number INTEGER NOT NULL,
    order_date TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    pickup_name TEXT,
    status TEXT DEFAULT 'new',
    total_price REAL,
    currency TEXT DEFAULT 'ALL',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    in_progress_at TEXT,
    done_at TEXT,
    picked_up_at TEXT,
    cancelled_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_orders_unique ON shop_orders(tenant_id, order_date, order_number);
  CREATE TABLE IF NOT EXISTS shop_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shop_conversations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    cart TEXT NOT NULL DEFAULT '[]',
    cart_state TEXT DEFAULT 'idle',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, guest_phone)
  );
  CREATE TABLE IF NOT EXISTS shop_faq (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_shop_orders_status   ON shop_orders(tenant_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_shop_orders_date     ON shop_orders(tenant_id, order_date);
  CREATE INDEX IF NOT EXISTS idx_shop_items_tenant    ON shop_menu_items(tenant_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_shop_convs_phone     ON shop_conversations(tenant_id, guest_phone);
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
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS owner_whatsapp TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS studio_location TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS studio_emojis TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS studio_greeting TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS studio_farewell TEXT NOT NULL DEFAULT ''`,
      `CREATE TABLE IF NOT EXISTS skedai_config (tenant_id TEXT PRIMARY KEY, forward_phone TEXT NOT NULL DEFAULT '', calendly_url TEXT NOT NULL DEFAULT '', support_faq TEXT NOT NULL DEFAULT '[]', health_check_urls TEXT NOT NULL DEFAULT '[]', industries TEXT NOT NULL DEFAULT '[]')`,
      `ALTER TABLE art_events ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE event_templates ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE specialists ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS has_analytics INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE services ADD COLUMN IF NOT EXISTS group_id TEXT`,
      `ALTER TABLE specialists ADD COLUMN IF NOT EXISTS service_group_ids TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE restaurant_zones ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE restaurant_zones ADD COLUMN IF NOT EXISTS max_concurrent INTEGER NOT NULL DEFAULT 10`,
      `ALTER TABLE restaurant_zones ADD COLUMN IF NOT EXISTS is_vip INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS resolved_at TEXT`,
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS guest_name TEXT`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS location_url TEXT`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS menu_url TEXT`,
      `ALTER TABLE art_events ADD COLUMN IF NOT EXISTS recurrence_group_id TEXT`,
      `CREATE TABLE IF NOT EXISTS art_class_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', classes_per_month INTEGER NOT NULL DEFAULT 4, price INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE TABLE IF NOT EXISTS art_special_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', duration_minutes INTEGER NOT NULL DEFAULT 60, min_capacity INTEGER, max_capacity INTEGER, price INTEGER NOT NULL DEFAULT 0, teacher_id TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `ALTER TABLE art_special_events ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60`,
      `ALTER TABLE art_special_events ADD COLUMN IF NOT EXISTS min_capacity INTEGER`,
      `ALTER TABLE art_special_events ADD COLUMN IF NOT EXISTS teacher_id TEXT`,
      `ALTER TABLE art_special_events ALTER COLUMN date DROP NOT NULL`,
      `ALTER TABLE art_special_events ALTER COLUMN start_time DROP NOT NULL`,
      `ALTER TABLE art_special_events ALTER COLUMN end_time DROP NOT NULL`,
      // provider_001 — dual provider support (Twilio + Meta Cloud API)
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'twilio'`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_access_token TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_waba_id TEXT`,
      `UPDATE tenants SET provider = 'twilio' WHERE provider IS NULL`,
      // twilio_001 — per-tenant Twilio credentials (NULL = use global env vars)
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT`,
      // hotel_config_001 — guest identity check flag (1 = ask, 0 = skip)
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS ask_guest_identity INTEGER NOT NULL DEFAULT 1`,
      // hotel_config_002 — message forward flag (1 = forward to depts, 0 = FAQ-only + reception link)
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS message_forward INTEGER NOT NULL DEFAULT 1`,
      // reviews_001 — hotel reviews table + tenant columns
      `CREATE TABLE IF NOT EXISTS hotel_reviews (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'booking', reviewer_name TEXT, score REAL, score_max REAL NOT NULL DEFAULT 10, review_date TEXT, positive_text TEXT, negative_text TEXT, full_review_text TEXT, language TEXT NOT NULL DEFAULT 'en', suggested_response TEXT, final_response TEXT, status TEXT NOT NULL DEFAULT 'pending', is_flagged INTEGER NOT NULL DEFAULT 0, sentiment_score REAL, flag_reason TEXT, raw_email TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), replied_at TEXT)`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_reviews_tenant  ON hotel_reviews(tenant_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_reviews_status  ON hotel_reviews(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_reviews_flagged ON hotel_reviews(tenant_id, is_flagged)`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_email_slug TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_review_slug ON tenants(review_email_slug) WHERE review_email_slug IS NOT NULL`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_phone TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reviews_enabled INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_notification_frequency TEXT NOT NULL DEFAULT 'immediate'`,
      `ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS owner_notified INTEGER NOT NULL DEFAULT 0`,
      // survey_001 — post-checkout satisfaction survey
      `ALTER TABLE hotel_guest_stays ADD COLUMN IF NOT EXISTS survey_sent INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE hotel_guest_stays ADD COLUMN IF NOT EXISTS survey_score INTEGER`,
      `ALTER TABLE hotel_guest_stays ADD COLUMN IF NOT EXISTS survey_sent_at TEXT`,
      `ALTER TABLE hotel_guest_stays ADD COLUMN IF NOT EXISTS survey_replied_at TEXT`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS review_platform_url TEXT`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS review_platform_name TEXT NOT NULL DEFAULT 'Booking.com'`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS survey_positive_threshold INTEGER NOT NULL DEFAULT 8`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS survey_negative_message TEXT NOT NULL DEFAULT 'We are truly sorry your experience did not meet your expectations. Your feedback is very important to us and we will use it to improve. We hope to have the opportunity to welcome you back for a much better stay.'`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS survey_positive_message TEXT NOT NULL DEFAULT 'We are so glad you enjoyed your stay! It would mean the world to us if you could share your experience online — it only takes a minute and helps us welcome more wonderful guests like you.'`,
      // analytics_001 — message log for cost tracking
      `CREATE TABLE IF NOT EXISTS message_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, direction TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE INDEX IF NOT EXISTS idx_message_log_tenant  ON message_log(tenant_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_message_log_created ON message_log(created_at)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`,
      // survey_flag_001 — per-tenant survey feature flag (hotel only)
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS survey_enabled INTEGER NOT NULL DEFAULT 0`,
      // conv_001 — track when guest last sent a message (for survey button 24h window)
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS last_guest_message_at TEXT`,
      // menus_flag_001 — per-tenant menus feature flag (hotel only)
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS menus_enabled INTEGER NOT NULL DEFAULT 0`,
      // menus_001 — hotel menus and items
      `CREATE TABLE IF NOT EXISTS hotel_menus (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, menu_type TEXT NOT NULL DEFAULT 'other', description TEXT, is_active INTEGER NOT NULL DEFAULT 1, file_url TEXT, file_name TEXT, file_type TEXT, keywords TEXT NOT NULL DEFAULT '[]', display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE TABLE IF NOT EXISTS hotel_menu_items (id TEXT PRIMARY KEY, menu_id TEXT NOT NULL, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, price REAL, currency TEXT NOT NULL DEFAULT 'ALL', category TEXT, is_available INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_menus_tenant    ON hotel_menus(tenant_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_menu_items_menu ON hotel_menu_items(menu_id, display_order)`,
      // photos_001 — guest photo attached to maintenance/complaint requests
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS photo_url TEXT`,
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS photo_mime_type TEXT`,
      // dept_response_001 — configurable response time per department
      `ALTER TABLE hotel_departments ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER NOT NULL DEFAULT 30`,
      // dept_lang_001 — notification language per department
      `ALTER TABLE hotel_departments ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'`,
      // dept_template_001 — per-tenant dept notification template SID
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_dept_template_sid TEXT`,
      // timeout_fallback_001 — per-hotel fallback message when agent times out
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS front_office_phone TEXT`,
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS fallback_message TEXT`,
      // maintenance_photo_001 — flag to control whether agent asks for maintenance photos
      `ALTER TABLE hotel_config ADD COLUMN IF NOT EXISTS ask_maintenance_photo INTEGER NOT NULL DEFAULT 1`,
      // dept_schedules_001 — per-department operating hour windows
      `CREATE TABLE IF NOT EXISTS hotel_department_schedules (id TEXT PRIMARY KEY, department_id TEXT NOT NULL, tenant_id TEXT NOT NULL, day_type TEXT NOT NULL DEFAULT 'both', start_time TEXT NOT NULL, end_time TEXT NOT NULL, response_time_minutes INTEGER NOT NULL DEFAULT 30, display_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE INDEX IF NOT EXISTS idx_dept_schedules_dept ON hotel_department_schedules(department_id)`,
      `ALTER TABLE hotel_departments ADD COLUMN IF NOT EXISTS scheduling_enabled INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE hotel_departments ADD COLUMN IF NOT EXISTS after_hours_message TEXT`,
      // staff_takeover_001 — AI pause / staff takeover per conversation
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS ai_paused_until TEXT`,
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS ai_paused_by TEXT`,
      // staff_workflow_001 — staff status updates via WhatsApp + staff fields on blocklist
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS in_progress_at TEXT`,
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS resolved_by TEXT`,
      `ALTER TABLE hotel_requests ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE hotel_blocked_numbers ADD COLUMN IF NOT EXISTS staff_name TEXT`,
      `ALTER TABLE hotel_blocked_numbers ADD COLUMN IF NOT EXISTS staff_role TEXT`,
      `ALTER TABLE hotel_blocked_numbers ADD COLUMN IF NOT EXISTS is_staff INTEGER NOT NULL DEFAULT 1`,
      `CREATE INDEX IF NOT EXISTS idx_hotel_requests_room_status ON hotel_requests(tenant_id, room_number, status)`,
      // shop_001 — shop vertical tables
      `CREATE TABLE IF NOT EXISTS shop_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE, shop_name TEXT, opening_hours TEXT, estimated_pickup_minutes INTEGER DEFAULT 15, pickup_mode TEXT DEFAULT 'estimated', agent_personality TEXT DEFAULT 'friendly', fallback_message TEXT DEFAULT 'We are temporarily unavailable. Please try again shortly.', address TEXT, instagram_url TEXT, facebook_url TEXT, tiktok_url TEXT, website_url TEXT, phone TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS shop_menu_categories (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS shop_menu_items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT, name TEXT NOT NULL, description TEXT, price REAL NOT NULL, currency TEXT DEFAULT 'ALL', photo_url TEXT, photo_filename TEXT, stock_type TEXT DEFAULT 'unlimited', stock_limit INTEGER, stock_used INTEGER DEFAULT 0, stock_last_reset TEXT, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS shop_orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_number INTEGER NOT NULL, order_date TEXT NOT NULL, guest_phone TEXT NOT NULL, pickup_name TEXT, status TEXT DEFAULT 'new', total_price REAL, currency TEXT DEFAULT 'ALL', notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, in_progress_at TEXT, done_at TEXT, picked_up_at TEXT, cancelled_at TEXT)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_orders_unique ON shop_orders(tenant_id, order_date, order_number)`,
      `CREATE TABLE IF NOT EXISTS shop_order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL, item_price REAL NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, subtotal REAL NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS shop_conversations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, guest_phone TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]', cart TEXT NOT NULL DEFAULT '[]', cart_state TEXT DEFAULT 'idle', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, guest_phone))`,
      `CREATE TABLE IF NOT EXISTS shop_faq (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders(tenant_id, status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_orders_date   ON shop_orders(tenant_id, order_date)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_items_tenant  ON shop_menu_items(tenant_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_convs_phone   ON shop_conversations(tenant_id, guest_phone)`,
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
    // One-time data fix: set all active upcoming art_events for WeArt to 2000 ALL
    await pool.query(`
      UPDATE art_events
      SET    price = 2000
      WHERE  is_active = 1
        AND  date >= CURRENT_DATE
        AND  tenant_id = (SELECT id FROM tenants WHERE LOWER(name) LIKE '%weart%' LIMIT 1)
    `).then(r => {
      if (r.rowCount && r.rowCount > 0)
        console.log(`✅ WeArt price fix: updated ${r.rowCount} event(s) to 2000 ALL`);
    }).catch((e: any) => console.warn('WeArt price fix skipped:', e.message));
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
  if (!artEventCols.includes('recurrence_group_id'))
    exec('ALTER TABLE art_events ADD COLUMN recurrence_group_id TEXT');

  const tmplCols = prepare("SELECT name FROM pragma_table_info('event_templates')")
    .all().map((r: any) => r.name as string);
  if (!tmplCols.includes('price'))
    exec('ALTER TABLE event_templates ADD COLUMN price INTEGER NOT NULL DEFAULT 0');

  const specialEventCols = prepare("SELECT name FROM pragma_table_info('art_special_events')")
    .all().map((r: any) => r.name as string);
  if (!specialEventCols.includes('duration_minutes'))
    exec('ALTER TABLE art_special_events ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60');
  if (!specialEventCols.includes('min_capacity'))
    exec('ALTER TABLE art_special_events ADD COLUMN min_capacity INTEGER');
  if (!specialEventCols.includes('teacher_id'))
    exec('ALTER TABLE art_special_events ADD COLUMN teacher_id TEXT');

  for (const [col, def] of [
    ['whatsapp_number', "whatsapp_number TEXT NOT NULL DEFAULT ''"],
    ['plan',            "plan TEXT NOT NULL DEFAULT 'starter'"],
    ['is_active',       'is_active INTEGER NOT NULL DEFAULT 1'],
    ['billing_email',   "billing_email TEXT NOT NULL DEFAULT ''"],
    ['has_analytics',   'has_analytics INTEGER NOT NULL DEFAULT 0'],
    ['owner_whatsapp',   "owner_whatsapp TEXT NOT NULL DEFAULT ''"],
    ['studio_location',  "studio_location TEXT NOT NULL DEFAULT ''"],
    ['studio_emojis',    "studio_emojis TEXT NOT NULL DEFAULT ''"],
    ['studio_greeting',  "studio_greeting TEXT NOT NULL DEFAULT ''"],
    ['studio_farewell',        "studio_farewell TEXT NOT NULL DEFAULT ''"],
    ['provider',               "provider TEXT DEFAULT 'twilio'"],
    ['meta_phone_number_id',   'meta_phone_number_id TEXT'],
    ['meta_access_token',      'meta_access_token TEXT'],
    ['meta_waba_id',           'meta_waba_id TEXT'],
    ['twilio_account_sid',          'twilio_account_sid TEXT'],
    ['twilio_auth_token',           'twilio_auth_token TEXT'],
    ['twilio_dept_template_sid',    'twilio_dept_template_sid TEXT'],
  ] as [string,string][]) {
    if (!cols.includes(col)) exec(`ALTER TABLE tenants ADD COLUMN ${def}`);
  }

  // hotel_guest_stays — survey fields
  const staysCols = prepare("SELECT name FROM pragma_table_info('hotel_guest_stays')")
    .all().map((r: any) => r.name as string);
  if (!staysCols.includes('survey_sent'))
    exec('ALTER TABLE hotel_guest_stays ADD COLUMN survey_sent INTEGER NOT NULL DEFAULT 0');
  if (!staysCols.includes('survey_score'))
    exec('ALTER TABLE hotel_guest_stays ADD COLUMN survey_score INTEGER');
  if (!staysCols.includes('survey_sent_at'))
    exec('ALTER TABLE hotel_guest_stays ADD COLUMN survey_sent_at TEXT');
  if (!staysCols.includes('survey_replied_at'))
    exec('ALTER TABLE hotel_guest_stays ADD COLUMN survey_replied_at TEXT');

  // hotel_config columns added after initial schema
  const hotelConfigCols = prepare("SELECT name FROM pragma_table_info('hotel_config')")
    .all().map((r: any) => r.name as string);
  if (!hotelConfigCols.includes('ask_guest_identity'))
    exec('ALTER TABLE hotel_config ADD COLUMN ask_guest_identity INTEGER NOT NULL DEFAULT 1');
  if (!hotelConfigCols.includes('message_forward'))
    exec('ALTER TABLE hotel_config ADD COLUMN message_forward INTEGER NOT NULL DEFAULT 1');
  if (!hotelConfigCols.includes('review_platform_url'))
    exec('ALTER TABLE hotel_config ADD COLUMN review_platform_url TEXT');
  if (!hotelConfigCols.includes('review_platform_name'))
    exec("ALTER TABLE hotel_config ADD COLUMN review_platform_name TEXT NOT NULL DEFAULT 'Booking.com'");
  if (!hotelConfigCols.includes('survey_positive_threshold'))
    exec('ALTER TABLE hotel_config ADD COLUMN survey_positive_threshold INTEGER NOT NULL DEFAULT 8');
  if (!hotelConfigCols.includes('survey_negative_message'))
    exec("ALTER TABLE hotel_config ADD COLUMN survey_negative_message TEXT NOT NULL DEFAULT 'We are truly sorry your experience did not meet your expectations. Your feedback is very important to us and we will use it to improve. We hope to have the opportunity to welcome you back for a much better stay.'");
  if (!hotelConfigCols.includes('survey_positive_message'))
    exec("ALTER TABLE hotel_config ADD COLUMN survey_positive_message TEXT NOT NULL DEFAULT 'We are so glad you enjoyed your stay! It would mean the world to us if you could share your experience online — it only takes a minute and helps us welcome more wonderful guests like you.'");
  if (!hotelConfigCols.includes('front_office_phone'))
    exec('ALTER TABLE hotel_config ADD COLUMN front_office_phone TEXT');
  if (!hotelConfigCols.includes('fallback_message'))
    exec('ALTER TABLE hotel_config ADD COLUMN fallback_message TEXT');
  if (!hotelConfigCols.includes('ask_maintenance_photo'))
    exec('ALTER TABLE hotel_config ADD COLUMN ask_maintenance_photo INTEGER NOT NULL DEFAULT 1');

  // tenant columns for review routing
  if (!cols.includes('review_email_slug'))
    exec('ALTER TABLE tenants ADD COLUMN review_email_slug TEXT');
  if (!cols.includes('owner_phone'))
    exec('ALTER TABLE tenants ADD COLUMN owner_phone TEXT');
  if (!cols.includes('reviews_enabled'))
    exec('ALTER TABLE tenants ADD COLUMN reviews_enabled INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('review_notification_frequency'))
    exec("ALTER TABLE tenants ADD COLUMN review_notification_frequency TEXT NOT NULL DEFAULT 'immediate'");
  if (!cols.includes('survey_enabled'))
    exec('ALTER TABLE tenants ADD COLUMN survey_enabled INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('menus_enabled'))
    exec('ALTER TABLE tenants ADD COLUMN menus_enabled INTEGER NOT NULL DEFAULT 0');

  const convCols = prepare("SELECT name FROM pragma_table_info('hotel_conversations')")
    .all().map((r: any) => r.name as string);
  if (!convCols.includes('last_guest_message_at'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN last_guest_message_at TEXT');
  if (!convCols.includes('ai_paused_until'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN ai_paused_until TEXT');
  if (!convCols.includes('ai_paused_by'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN ai_paused_by TEXT');

  const reqCols = prepare("SELECT name FROM pragma_table_info('hotel_requests')")
    .all().map((r: any) => r.name as string);
  if (!reqCols.includes('photo_url'))
    exec('ALTER TABLE hotel_requests ADD COLUMN photo_url TEXT');
  if (!reqCols.includes('photo_mime_type'))
    exec('ALTER TABLE hotel_requests ADD COLUMN photo_mime_type TEXT');
  if (!reqCols.includes('in_progress_at'))
    exec('ALTER TABLE hotel_requests ADD COLUMN in_progress_at TEXT');
  if (!reqCols.includes('resolved_by'))
    exec('ALTER TABLE hotel_requests ADD COLUMN resolved_by TEXT');
  if (!reqCols.includes('notes'))
    exec('ALTER TABLE hotel_requests ADD COLUMN notes TEXT');

  const blockedCols = prepare("SELECT name FROM pragma_table_info('hotel_blocked_numbers')")
    .all().map((r: any) => r.name as string);
  if (!blockedCols.includes('staff_name'))
    exec('ALTER TABLE hotel_blocked_numbers ADD COLUMN staff_name TEXT');
  if (!blockedCols.includes('staff_role'))
    exec('ALTER TABLE hotel_blocked_numbers ADD COLUMN staff_role TEXT');
  if (!blockedCols.includes('is_staff'))
    exec('ALTER TABLE hotel_blocked_numbers ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 1');

  const deptCols = prepare("SELECT name FROM pragma_table_info('hotel_departments')")
    .all().map((r: any) => r.name as string);
  if (!deptCols.includes('response_time_minutes'))
    exec('ALTER TABLE hotel_departments ADD COLUMN response_time_minutes INTEGER NOT NULL DEFAULT 30');
  if (!deptCols.includes('language'))
    exec("ALTER TABLE hotel_departments ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
  if (!deptCols.includes('scheduling_enabled'))
    exec('ALTER TABLE hotel_departments ADD COLUMN scheduling_enabled INTEGER NOT NULL DEFAULT 0');
  if (!deptCols.includes('after_hours_message'))
    exec('ALTER TABLE hotel_departments ADD COLUMN after_hours_message TEXT');

  const hotelReviewCols = prepare("SELECT name FROM pragma_table_info('hotel_reviews')")
    .all().map((r: any) => r.name as string);
  if (!hotelReviewCols.includes('owner_notified'))
    exec('ALTER TABLE hotel_reviews ADD COLUMN owner_notified INTEGER NOT NULL DEFAULT 0');

  // users — is_admin flag
  const userCols = prepare("SELECT name FROM pragma_table_info('users')")
    .all().map((r: any) => r.name as string);
  if (!userCols.includes('is_admin'))
    exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');

  console.log('✅ SQLite migrations complete');
}
