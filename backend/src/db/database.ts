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
    fallback_backup_number TEXT,
    fallback_after_attempts INTEGER DEFAULT 1,
    manual_orders_enabled INTEGER DEFAULT 0,
    address TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    tiktok_url TEXT,
    website_url TEXT,
    phone TEXT,
    qr_ordering_enabled INTEGER DEFAULT 0,
    qr_collect_name INTEGER DEFAULT 1,
    qr_collect_table INTEGER DEFAULT 0,
    qr_slug TEXT UNIQUE,
    shop_logo_url TEXT,
    shop_logo_filename TEXT,
    qr_welcome_message TEXT DEFAULT 'Welcome! Please enter your name to start ordering.',
    fiscal_enabled INTEGER DEFAULT 0,
    fiscal_api_url TEXT DEFAULT 'https://efiskalizimi-app-test.tatime.gov.al',
    fiscal_username TEXT,
    fiscal_password TEXT,
    fiscal_nuis TEXT,
    fiscal_tcr_code TEXT,
    fiscal_busun_code TEXT,
    fiscal_soft_code TEXT,
    fiscal_initial_cash REAL DEFAULT 0,
    fiscal_default_client TEXT DEFAULT 'Klient i Pergjithshem',
    fiscal_environment TEXT DEFAULT 'test',
    qr_name_position TEXT DEFAULT 'welcome',
    staff_notify_number TEXT,
    staff_notify_enabled INTEGER DEFAULT 0,
    staff_notify_keepalive_time TEXT DEFAULT '08:00',
    notify_sound TEXT DEFAULT 'chime',
    notify_sound_enabled INTEGER DEFAULT 1,
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
    vat_rate TEXT DEFAULT 'VAT_20',
    item_code TEXT,
    unit TEXT DEFAULT 'XPP',
    pricing_type TEXT DEFAULT 'fixed',
    price_2h REAL DEFAULT NULL,
    price_3h REAL DEFAULT NULL,
    price_4h REAL DEFAULT NULL,
    price_day REAL DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS shop_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_number INTEGER NOT NULL,
    order_date TEXT NOT NULL,
    guest_phone TEXT,
    pickup_name TEXT,
    status TEXT DEFAULT 'new',
    total_price REAL,
    currency TEXT DEFAULT 'ALL',
    notes TEXT,
    source TEXT DEFAULT 'whatsapp',
    is_paid INTEGER DEFAULT 0,
    paid_at TEXT,
    table_name TEXT,
    qr_session TEXT,
    payment_type TEXT DEFAULT 'BANKNOTE',
    fiscal_status TEXT DEFAULT 'not_fiscalized',
    fiscal_iic TEXT,
    fiscal_fic TEXT,
    fiscal_inv_num TEXT,
    fiscal_verify_url TEXT,
    fiscal_error TEXT,
    fiscal_token TEXT,
    fiscal_token_exp TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    in_progress_at TEXT,
    done_at TEXT,
    picked_up_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT DEFAULT NULL
  );
  CREATE TABLE IF NOT EXISTS shop_tables (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_shop_tables_tenant ON shop_tables(tenant_id, is_active, sort_order);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_orders_unique ON shop_orders(tenant_id, order_date, order_number);
  CREATE TABLE IF NOT EXISTS shop_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal REAL NOT NULL,
    rental_hours INTEGER,
    rental_tier TEXT DEFAULT NULL
  );
  CREATE TABLE IF NOT EXISTS shop_conversations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    cart TEXT NOT NULL DEFAULT '[]',
    cart_state TEXT DEFAULT 'idle',
    consecutive_errors INTEGER DEFAULT 0,
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
  CREATE TABLE IF NOT EXISTS shop_users (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    username       TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    name           TEXT NOT NULL,
    surname        TEXT NOT NULL,
    tax_id         TEXT,
    operator_id    TEXT,
    role           TEXT NOT NULL DEFAULT 'operator',
    is_active      INTEGER DEFAULT 1,
    session_version INTEGER DEFAULT 1,
    fiscal_operator_code TEXT,
    created_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at     TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, username)
  );
  CREATE INDEX IF NOT EXISTS idx_shop_users_tenant ON shop_users(tenant_id, is_active);
  CREATE TABLE IF NOT EXISTS shop_audit_log (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    user_id     TEXT,
    user_name   TEXT,
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    details     TEXT,
    created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_shop_audit_tenant ON shop_audit_log(tenant_id, created_at);
  CREATE TABLE IF NOT EXISTS inventory_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, name)
  );
  CREATE TABLE IF NOT EXISTS inventory_ingredients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    category_id TEXT,
    supplier_id TEXT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'pieces',
    current_stock REAL DEFAULT 0,
    reorder_threshold REAL DEFAULT 0,
    cost_per_unit REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, name)
  );
  CREATE TABLE IF NOT EXISTS inventory_suppliers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    contact TEXT,
    phone TEXT,
    email TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS inventory_recipes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, menu_item_id)
  );
  CREATE TABLE IF NOT EXISTS inventory_recipe_lines (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    ingredient_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS inventory_deliveries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    supplier_id TEXT,
    supplier_name TEXT,
    invoice_ref TEXT,
    notes TEXT,
    total_cost REAL,
    delivered_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS inventory_delivery_lines (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    ingredient_id TEXT NOT NULL,
    ingredient_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    cost_per_unit REAL,
    line_total REAL
  );
  CREATE TABLE IF NOT EXISTS inventory_waste (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    ingredient_id TEXT NOT NULL,
    ingredient_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'spillage',
    notes TEXT,
    recorded_by TEXT,
    recorded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS inventory_consumption (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT,
    ingredient_id TEXT NOT NULL,
    ingredient_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    consumed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_inv_ingredients_tenant   ON inventory_ingredients(tenant_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_inv_recipe_lines_recipe  ON inventory_recipe_lines(recipe_id);
  CREATE INDEX IF NOT EXISTS idx_inv_delivery_lines       ON inventory_delivery_lines(delivery_id);
  CREATE INDEX IF NOT EXISTS idx_inv_waste_tenant         ON inventory_waste(tenant_id, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_inv_consumption_tenant   ON inventory_consumption(tenant_id, consumed_at);

  -- Happy Restaurant POS (happy_restaurant / happy_bar / happy_hybrid)
  -- Uses happy_* prefix (not restaurant_*) to avoid colliding with the
  -- existing restaurant_zones/restaurant_tables/restaurant_reservations
  -- WhatsApp reservation feature (tenant type 'restaurant'), which this
  -- module must never touch.
  CREATE TABLE IF NOT EXISTS happy_settings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL UNIQUE,
    venue_type TEXT NOT NULL,
    venue_name TEXT NOT NULL,
    tenant_code TEXT UNIQUE,
    currency TEXT NOT NULL DEFAULT 'ALL',
    timezone TEXT NOT NULL DEFAULT 'Europe/Tirane',
    table_numbering_type TEXT NOT NULL DEFAULT 'both',
    max_tables INTEGER NOT NULL DEFAULT 50,
    counter_service_enabled INTEGER NOT NULL DEFAULT 0,
    counter_ticket_reset TEXT NOT NULL DEFAULT 'daily',
    send_by_course INTEGER NOT NULL DEFAULT 0,
    allow_item_void_after_send INTEGER NOT NULL DEFAULT 1,
    void_requires_manager_approval INTEGER NOT NULL DEFAULT 0,
    void_requires_reason INTEGER NOT NULL DEFAULT 1,
    allow_split_bill INTEGER NOT NULL DEFAULT 1,
    split_mode TEXT NOT NULL DEFAULT 'both',
    allow_merge_tables INTEGER NOT NULL DEFAULT 1,
    kitchen_display_enabled INTEGER NOT NULL DEFAULT 1,
    bar_display_enabled INTEGER NOT NULL DEFAULT 0,
    default_item_destination TEXT NOT NULL DEFAULT 'kitchen',
    printer_enabled INTEGER NOT NULL DEFAULT 0,
    printer_type TEXT,
    printer_ip TEXT,
    kitchen_course_alert INTEGER NOT NULL DEFAULT 1,
    kitchen_void_alert INTEGER NOT NULL DEFAULT 1,
    fiscal_receipt_on_payment INTEGER NOT NULL DEFAULT 1,
    fiscal_receipt_on_bill_print INTEGER NOT NULL DEFAULT 0,
    allow_manual_offline_payment INTEGER NOT NULL DEFAULT 1,
    allow_room_charge INTEGER NOT NULL DEFAULT 0,
    waiter_login_method TEXT NOT NULL DEFAULT 'both',
    menu_time_based INTEGER NOT NULL DEFAULT 0,
    loyalty_enabled INTEGER NOT NULL DEFAULT 0,
    loyalty_identifier TEXT NOT NULL DEFAULT 'both',
    loyalty_earn_and_redeem_same_tx INTEGER NOT NULL DEFAULT 1,
    pms_enabled INTEGER NOT NULL DEFAULT 0,
    pms_provider TEXT,
    pms_api_url TEXT,
    pms_api_key TEXT,
    pms_verify_room_on_charge INTEGER NOT NULL DEFAULT 1,
    shift_report_enabled INTEGER NOT NULL DEFAULT 1,
    whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
    ai_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_happy_settings_code ON happy_settings(tenant_code) WHERE tenant_code IS NOT NULL;

  CREATE TABLE IF NOT EXISTS happy_staff (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    pin_hash TEXT,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_happy_staff_email ON happy_staff(tenant_id, email) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_happy_staff_pin   ON happy_staff(tenant_id, pin_hash) WHERE pin_hash IS NOT NULL;

  CREATE TABLE IF NOT EXISTS happy_tables (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    number INTEGER,
    name TEXT,
    section TEXT,
    capacity INTEGER NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'available',
    current_order_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_tables_tenant ON happy_tables(tenant_id, is_active);

  CREATE TABLE IF NOT EXISTS happy_menu_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    destination TEXT NOT NULL DEFAULT 'kitchen',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    available_from TEXT,
    available_until TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_menu_cat_tenant ON happy_menu_categories(tenant_id, is_active);

  CREATE TABLE IF NOT EXISTS happy_menu_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    destination_override TEXT,
    course TEXT,
    is_available INTEGER NOT NULL DEFAULT 1,
    stock_quantity INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_menu_items_tenant ON happy_menu_items(tenant_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_happy_menu_items_cat    ON happy_menu_items(category_id);

  CREATE TABLE IF NOT EXISTS happy_modifier_groups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    min_selections INTEGER NOT NULL DEFAULT 0,
    max_selections INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE IF NOT EXISTS happy_item_modifier_groups (
    item_id TEXT NOT NULL,
    modifier_group_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, modifier_group_id)
  );
  CREATE TABLE IF NOT EXISTS happy_modifiers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_adjustment REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_modifiers_group ON happy_modifiers(group_id);

  CREATE TABLE IF NOT EXISTS happy_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    table_id TEXT,
    waiter_id TEXT NOT NULL,
    order_number INTEGER NOT NULL,
    ticket_number INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_method TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT,
    fiscal_status TEXT NOT NULL DEFAULT 'not_fiscalized',
    fiscal_iic TEXT,
    fiscal_fic TEXT,
    fiscal_inv_num TEXT,
    fiscal_verify_url TEXT,
    fiscal_error TEXT,
    fiscal_at TEXT,
    pms_room_number TEXT,
    pms_guest_name TEXT,
    pms_reservation_id TEXT,
    pms_folio_number TEXT,
    pms_charge_posted INTEGER,
    pms_charge_posted_at TEXT,
    pms_charge_error TEXT,
    loyalty_customer_id TEXT,
    loyalty_phone TEXT,
    loyalty_card TEXT,
    loyalty_points_earned INTEGER,
    loyalty_points_redeemed INTEGER,
    loyalty_discount REAL,
    parent_order_id TEXT,
    is_split INTEGER NOT NULL DEFAULT 0,
    merged_into_order_id TEXT,
    opened_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    bill_requested_at TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_orders_tenant ON happy_orders(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_happy_orders_table  ON happy_orders(table_id);
  CREATE INDEX IF NOT EXISTS idx_happy_orders_waiter ON happy_orders(waiter_id);

  CREATE TABLE IF NOT EXISTS happy_order_sequences (
    tenant_id TEXT NOT NULL,
    date TEXT NOT NULL,
    last_order_number INTEGER NOT NULL DEFAULT 0,
    last_ticket_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, date)
  );

  CREATE TABLE IF NOT EXISTS happy_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    modifiers_price REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    course TEXT,
    destination TEXT NOT NULL DEFAULT 'kitchen',
    status TEXT NOT NULL DEFAULT 'pending',
    sent_at TEXT,
    voided_at TEXT,
    voided_by TEXT,
    void_approved_by TEXT,
    void_reason TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_order_items_order  ON happy_order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_happy_order_items_tenant ON happy_order_items(tenant_id);

  CREATE TABLE IF NOT EXISTS happy_order_item_modifiers (
    id TEXT PRIMARY KEY,
    order_item_id TEXT NOT NULL,
    modifier_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_adjustment REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_oim_item ON happy_order_item_modifiers(order_item_id);

  CREATE TABLE IF NOT EXISTS happy_void_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    order_item_id TEXT NOT NULL,
    voided_by TEXT NOT NULL,
    approved_by TEXT,
    reason TEXT,
    item_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    total_value REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_void_log_tenant ON happy_void_log(tenant_id);

  CREATE TABLE IF NOT EXISTS happy_kitchen_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    table_id TEXT,
    table_display TEXT,
    event_type TEXT NOT NULL,
    destination TEXT NOT NULL DEFAULT 'kitchen',
    course TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    is_acknowledged INTEGER NOT NULL DEFAULT 0,
    acknowledged_at TEXT,
    acknowledged_by TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_kitchen_events_dest ON happy_kitchen_events(tenant_id, destination, is_acknowledged);

  CREATE TABLE IF NOT EXISTS happy_pms_charge_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    guest_name TEXT,
    reservation_id TEXT,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    error TEXT,
    posted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_pms_queue_tenant ON happy_pms_charge_queue(tenant_id, status);

  CREATE TABLE IF NOT EXISTS happy_shift_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    shift_start TEXT NOT NULL,
    shift_end TEXT NOT NULL,
    total_revenue REAL NOT NULL DEFAULT 0,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_covers INTEGER NOT NULL DEFAULT 0,
    voided_items_count INTEGER NOT NULL DEFAULT 0,
    voided_items_value REAL NOT NULL DEFAULT 0,
    payment_breakdown TEXT NOT NULL DEFAULT '{}',
    per_waiter_breakdown TEXT NOT NULL DEFAULT '[]',
    top_items TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE INDEX IF NOT EXISTS idx_happy_shift_reports_tenant ON happy_shift_reports(tenant_id);
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
      `ALTER TABLE hotel_departments ADD COLUMN IF NOT EXISTS confirmation_mode TEXT NOT NULL DEFAULT 'with_estimate'`,
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
      `CREATE TABLE IF NOT EXISTS shop_conversations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, guest_phone TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]', cart TEXT NOT NULL DEFAULT '[]', cart_state TEXT DEFAULT 'idle', consecutive_errors INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, guest_phone))`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fallback_backup_number TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fallback_after_attempts INTEGER DEFAULT 1`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS manual_orders_enabled INTEGER DEFAULT 0`,
      `ALTER TABLE shop_orders ALTER COLUMN guest_phone DROP NOT NULL`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'whatsapp'`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS is_paid INTEGER DEFAULT 0`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS paid_at TEXT`,
      `ALTER TABLE shop_conversations ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS shop_faq (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders(tenant_id, status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_orders_date   ON shop_orders(tenant_id, order_date)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_items_tenant  ON shop_menu_items(tenant_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_convs_phone   ON shop_conversations(tenant_id, guest_phone)`,
      // shop_qr_001 — QR self-ordering fields
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS qr_ordering_enabled INTEGER DEFAULT 0`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS qr_collect_name INTEGER DEFAULT 1`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS qr_collect_table INTEGER DEFAULT 0`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS qr_slug TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS shop_logo_url TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS shop_logo_filename TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS qr_welcome_message TEXT DEFAULT 'Welcome! Please enter your name to start ordering.'`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_config_slug ON shop_config(qr_slug) WHERE qr_slug IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS shop_tables (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, name))`,
      `CREATE INDEX IF NOT EXISTS idx_shop_tables_tenant ON shop_tables(tenant_id, is_active, sort_order)`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS table_name TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS qr_session TEXT`,
      // shop_users_001 — staff sub-user accounts with role-based access
      `CREATE TABLE IF NOT EXISTS shop_users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, surname TEXT NOT NULL, tax_id TEXT, operator_id TEXT, role TEXT NOT NULL DEFAULT 'operator', is_active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id, username))`,
      `CREATE INDEX IF NOT EXISTS idx_shop_users_tenant ON shop_users(tenant_id, is_active)`,
      // shop_audit_001 — audit trail for order and user actions
      `CREATE TABLE IF NOT EXISTS shop_audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_audit_tenant ON shop_audit_log(tenant_id, created_at)`,
      // shop_fiscal_001 — Albanian e-Fiskalizimi integration fields
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_enabled INTEGER DEFAULT 0`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_api_url TEXT DEFAULT 'https://efiskalizimi-app-test.tatime.gov.al'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_username TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_password TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_nuis TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_tcr_code TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_busun_code TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_soft_code TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_initial_cash REAL DEFAULT 0`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_default_client TEXT DEFAULT 'Klient i Pergjithshem'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_environment TEXT DEFAULT 'test'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS fiscal_middleware TEXT DEFAULT 'nexia'`,
      // shop_delivery_001 — dynamic delivery time tiers
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS delivery_threshold_1 INTEGER DEFAULT 5`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS delivery_threshold_2 INTEGER DEFAULT 15`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS delivery_time_1 INTEGER DEFAULT 15`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS delivery_time_2 INTEGER DEFAULT 30`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS delivery_time_3 INTEGER DEFAULT 45`,
      // shop_photos_001 — per-tenant photo upload toggle for shop module
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shop_photos_enabled INTEGER NOT NULL DEFAULT 0`,
      // email_fallback_001 — hotel staff email fallback when WhatsApp delivery fails
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_email TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_fallback_enabled INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS vat_rate TEXT DEFAULT 'VAT_20'`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS item_code TEXT`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'XPP'`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'BANKNOTE'`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_status TEXT DEFAULT 'not_fiscalized'`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_iic TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_fic TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_inv_num TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_verify_url TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_error TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_token TEXT`,
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fiscal_token_exp TEXT`,
      `ALTER TABLE shop_users ADD COLUMN IF NOT EXISTS fiscal_operator_code TEXT`,
      // shop_rental_001 — per-item hourly/rental pricing
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS pricing_type TEXT DEFAULT 'fixed'`,
      `ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS rental_hours INTEGER`,
      // shop_rental_002 — multi-tier pricing per rental item
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS price_2h REAL DEFAULT NULL`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS price_3h REAL DEFAULT NULL`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS price_4h REAL DEFAULT NULL`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS price_day REAL DEFAULT NULL`,
      `ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS rental_tier TEXT DEFAULT NULL`,
      // shop_menu_docs_001 — PDF/URL menu documents for the shop agent
      `CREATE TABLE IF NOT EXISTS shop_menu_documents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, label TEXT NOT NULL, doc_type TEXT NOT NULL CHECK (doc_type IN ('pdf', 'url')), file_url TEXT, external_url TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_menu_docs_tenant ON shop_menu_documents(tenant_id, sort_order)`,
      // shop_inventory_001 — Inventory & Recipe Module
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS inventory_enabled INTEGER DEFAULT 0`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS inventory_alert_mode TEXT DEFAULT 'daily'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS inventory_alert_time TEXT DEFAULT '09:00'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS inventory_alert_whatsapp INTEGER DEFAULT 0`,
      // shop_qr_pos_001 — configurable name/table position in QR ordering
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS qr_name_position TEXT DEFAULT 'welcome'`,
      // shop_notify_001 — staff WhatsApp notifications + browser sound
      `ALTER TABLE shop_config DROP CONSTRAINT IF EXISTS shop_config_notify_sound_check`,
      `ALTER TABLE shop_config ADD CONSTRAINT shop_config_notify_sound_check CHECK (notify_sound IN ('chime', 'bell', 'ping', 'ding', 'alarm', 'none'))`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS staff_notify_number TEXT`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS staff_notify_enabled INTEGER DEFAULT 0`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS staff_notify_keepalive_time TEXT DEFAULT '08:00'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS notify_sound TEXT DEFAULT 'chime'`,
      `ALTER TABLE shop_config ADD COLUMN IF NOT EXISTS notify_sound_enabled INTEGER DEFAULT 1`,
      `ALTER TABLE shop_menu_items ADD COLUMN IF NOT EXISTS stock_mode TEXT DEFAULT 'simple'`,
      `CREATE TABLE IF NOT EXISTS inventory_categories (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), UNIQUE(tenant_id, name))`,
      `CREATE TABLE IF NOT EXISTS inventory_suppliers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, notes TEXT, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE TABLE IF NOT EXISTS inventory_ingredients (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT, supplier_id TEXT, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pieces', current_stock REAL DEFAULT 0, reorder_threshold REAL DEFAULT 0, cost_per_unit REAL DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), UNIQUE(tenant_id, name))`,
      `CREATE TABLE IF NOT EXISTS inventory_recipes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, name TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), UNIQUE(tenant_id, menu_item_id))`,
      `CREATE TABLE IF NOT EXISTS inventory_recipe_lines (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, tenant_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, quantity REAL NOT NULL, sort_order INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS inventory_deliveries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, supplier_id TEXT, supplier_name TEXT, invoice_ref TEXT, notes TEXT, total_cost REAL, delivered_at TEXT DEFAULT (CURRENT_TIMESTAMP), created_by TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE TABLE IF NOT EXISTS inventory_delivery_lines (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, tenant_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, ingredient_name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, cost_per_unit REAL, line_total REAL)`,
      `CREATE TABLE IF NOT EXISTS inventory_waste (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ingredient_id TEXT NOT NULL, ingredient_name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'spillage', notes TEXT, recorded_by TEXT, recorded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE TABLE IF NOT EXISTS inventory_consumption (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT, ingredient_id TEXT NOT NULL, ingredient_name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, consumed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`,
      `CREATE INDEX IF NOT EXISTS idx_inv_ingredients_tenant ON inventory_ingredients(tenant_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_inv_recipe_lines_recipe ON inventory_recipe_lines(recipe_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inv_delivery_lines ON inventory_delivery_lines(delivery_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inv_waste_tenant ON inventory_waste(tenant_id, recorded_at)`,
      `CREATE INDEX IF NOT EXISTS idx_inv_consumption_tenant ON inventory_consumption(tenant_id, consumed_at)`,
      // shop_cancel_reason_001 — staff cancel reason on orders
      `ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT`,
      // instagram_001 — channel tracking on hotel_conversations
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'`,
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS channel_user_id TEXT DEFAULT NULL`,
      // instagram_002 — Instagram account ID on tenants
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS instagram_account_id TEXT`,
      // instagram_004 — sender profile on hotel_conversations
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS guest_name VARCHAR(255) DEFAULT NULL`,
      `ALTER TABLE hotel_conversations ADD COLUMN IF NOT EXISTS guest_username VARCHAR(255) DEFAULT NULL`,
      // messages_jsonb_001 — fix any null/empty/non-array messages before column conversion
      `UPDATE hotel_conversations SET messages = '[]' WHERE messages IS NULL OR messages::text = '' OR messages::text NOT LIKE '[%'`,
      // messages_jsonb_002 — convert messages from text to jsonb so || does array merge, not string concat
      `ALTER TABLE hotel_conversations ALTER COLUMN messages TYPE jsonb USING messages::jsonb`,
      // instagram_003 — per-channel AI + connection settings
      `CREATE TABLE IF NOT EXISTS hotel_channel_settings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        ai_enabled BOOLEAN NOT NULL DEFAULT true,
        connected BOOLEAN NOT NULL DEFAULT false,
        access_token TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, channel)
      )`,
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
        AND  date::date >= CURRENT_DATE
        AND  tenant_id = (SELECT id FROM tenants WHERE LOWER(name) LIKE '%weart%' LIMIT 1)
    `).then(r => {
      if (r.rowCount && r.rowCount > 0)
        console.log(`✅ WeArt price fix: updated ${r.rowCount} event(s) to 2000 ALL`);
    }).catch((e: any) => console.warn('WeArt price fix skipped:', e.message));
    // instagram_004 — seed WhatsApp channel rows for protected production tenants
    // (La Favorita Instagram is managed via admin UI, not seeded here)
    await pool.query(
      `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
       VALUES (gen_random_uuid(), '41b10744-891e-439a-a976-3aff28c51afe', 'whatsapp', true, true, NULL)
       ON CONFLICT (tenant_id, channel) DO NOTHING`,
    ).catch((e: any) => console.warn('PG seed skip (La Favorita WA):', e.message));
    // Bloom Matcha / Bar-1: whatsapp channel only
    await pool.query(
      `INSERT INTO hotel_channel_settings (id, tenant_id, channel, ai_enabled, connected, access_token)
       VALUES (gen_random_uuid(), '1a7ef18c-394b-441e-8376-fc57238b7dcc', 'whatsapp', true, true, NULL)
       ON CONFLICT (tenant_id, channel) DO NOTHING`,
    ).catch((e: any) => console.warn('PG seed skip (Bloom WA):', e.message));

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
  if (!cols.includes('shop_photos_enabled'))
    exec('ALTER TABLE tenants ADD COLUMN shop_photos_enabled INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('notification_email'))
    exec('ALTER TABLE tenants ADD COLUMN notification_email TEXT');
  if (!cols.includes('email_fallback_enabled'))
    exec('ALTER TABLE tenants ADD COLUMN email_fallback_enabled INTEGER NOT NULL DEFAULT 0');

  const convCols = prepare("SELECT name FROM pragma_table_info('hotel_conversations')")
    .all().map((r: any) => r.name as string);
  if (!convCols.includes('last_guest_message_at'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN last_guest_message_at TEXT');
  if (!convCols.includes('ai_paused_until'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN ai_paused_until TEXT');
  if (!convCols.includes('ai_paused_by'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN ai_paused_by TEXT');
  // instagram_001 — channel tracking
  if (!convCols.includes('channel'))
    exec("ALTER TABLE hotel_conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'");
  if (!convCols.includes('channel_user_id'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN channel_user_id TEXT');
  // instagram_004 — sender profile
  if (!convCols.includes('guest_name'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN guest_name TEXT');
  if (!convCols.includes('guest_username'))
    exec('ALTER TABLE hotel_conversations ADD COLUMN guest_username TEXT');

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
  if (!deptCols.includes('confirmation_mode'))
    exec("ALTER TABLE hotel_departments ADD COLUMN confirmation_mode TEXT NOT NULL DEFAULT 'with_estimate'");

  const hotelReviewCols = prepare("SELECT name FROM pragma_table_info('hotel_reviews')")
    .all().map((r: any) => r.name as string);
  if (!hotelReviewCols.includes('owner_notified'))
    exec('ALTER TABLE hotel_reviews ADD COLUMN owner_notified INTEGER NOT NULL DEFAULT 0');

  // users — is_admin flag
  const userCols = prepare("SELECT name FROM pragma_table_info('users')")
    .all().map((r: any) => r.name as string);
  if (!userCols.includes('is_admin'))
    exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');

  // shop_config — columns added after initial schema
  const shopConfigCols = prepare("SELECT name FROM pragma_table_info('shop_config')")
    .all().map((r: any) => r.name as string);
  if (!shopConfigCols.includes('fallback_backup_number'))
    exec('ALTER TABLE shop_config ADD COLUMN fallback_backup_number TEXT');
  if (!shopConfigCols.includes('fallback_after_attempts'))
    exec('ALTER TABLE shop_config ADD COLUMN fallback_after_attempts INTEGER DEFAULT 1');
  if (!shopConfigCols.includes('manual_orders_enabled'))
    exec('ALTER TABLE shop_config ADD COLUMN manual_orders_enabled INTEGER DEFAULT 0');

  // shop_orders — source / payment columns added after initial schema
  const shopOrderCols = prepare("SELECT name FROM pragma_table_info('shop_orders')")
    .all().map((r: any) => r.name as string);
  if (!shopOrderCols.includes('source'))
    exec("ALTER TABLE shop_orders ADD COLUMN source TEXT DEFAULT 'whatsapp'");
  if (!shopOrderCols.includes('is_paid'))
    exec('ALTER TABLE shop_orders ADD COLUMN is_paid INTEGER DEFAULT 0');
  if (!shopOrderCols.includes('paid_at'))
    exec('ALTER TABLE shop_orders ADD COLUMN paid_at TEXT');

  // shop_config — QR ordering columns
  const shopConfigColsQr = prepare("SELECT name FROM pragma_table_info('shop_config')")
    .all().map((r: any) => r.name as string);
  if (!shopConfigColsQr.includes('qr_ordering_enabled'))
    exec('ALTER TABLE shop_config ADD COLUMN qr_ordering_enabled INTEGER DEFAULT 0');
  if (!shopConfigColsQr.includes('qr_collect_name'))
    exec('ALTER TABLE shop_config ADD COLUMN qr_collect_name INTEGER DEFAULT 1');
  if (!shopConfigColsQr.includes('qr_collect_table'))
    exec('ALTER TABLE shop_config ADD COLUMN qr_collect_table INTEGER DEFAULT 0');
  if (!shopConfigColsQr.includes('qr_slug'))
    exec('ALTER TABLE shop_config ADD COLUMN qr_slug TEXT');
  if (!shopConfigColsQr.includes('shop_logo_url'))
    exec('ALTER TABLE shop_config ADD COLUMN shop_logo_url TEXT');
  if (!shopConfigColsQr.includes('shop_logo_filename'))
    exec('ALTER TABLE shop_config ADD COLUMN shop_logo_filename TEXT');
  if (!shopConfigColsQr.includes('qr_welcome_message'))
    exec("ALTER TABLE shop_config ADD COLUMN qr_welcome_message TEXT DEFAULT 'Welcome! Please enter your name to start ordering.'");

  // shop_orders — QR ordering columns
  const shopOrderColsQr = prepare("SELECT name FROM pragma_table_info('shop_orders')")
    .all().map((r: any) => r.name as string);
  if (!shopOrderColsQr.includes('table_name'))
    exec('ALTER TABLE shop_orders ADD COLUMN table_name TEXT');
  if (!shopOrderColsQr.includes('qr_session'))
    exec('ALTER TABLE shop_orders ADD COLUMN qr_session TEXT');

  // shop_tables — new table for table-specific QR codes (SCHEMA CREATE IF NOT EXISTS handles it)

  // shop_conversations — consecutive error tracking
  const shopConvCols = prepare("SELECT name FROM pragma_table_info('shop_conversations')")
    .all().map((r: any) => r.name as string);
  if (!shopConvCols.includes('consecutive_errors'))
    exec('ALTER TABLE shop_conversations ADD COLUMN consecutive_errors INTEGER DEFAULT 0');

  // shop_fiscal_001 — fiscal columns on shop tables
  const shopConfigFiscalCols = prepare("SELECT name FROM pragma_table_info('shop_config')")
    .all().map((r: any) => r.name as string);
  if (!shopConfigFiscalCols.includes('fiscal_enabled'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_enabled INTEGER DEFAULT 0');
  if (!shopConfigFiscalCols.includes('fiscal_api_url'))
    exec("ALTER TABLE shop_config ADD COLUMN fiscal_api_url TEXT DEFAULT 'https://efiskalizimi-app-test.tatime.gov.al'");
  if (!shopConfigFiscalCols.includes('fiscal_username'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_username TEXT');
  if (!shopConfigFiscalCols.includes('fiscal_password'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_password TEXT');
  if (!shopConfigFiscalCols.includes('fiscal_nuis'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_nuis TEXT');
  if (!shopConfigFiscalCols.includes('fiscal_tcr_code'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_tcr_code TEXT');
  if (!shopConfigFiscalCols.includes('fiscal_busun_code'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_busun_code TEXT');
  if (!shopConfigFiscalCols.includes('fiscal_soft_code'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_soft_code TEXT');
  if (!shopConfigFiscalCols.includes('fiscal_initial_cash'))
    exec('ALTER TABLE shop_config ADD COLUMN fiscal_initial_cash REAL DEFAULT 0');
  if (!shopConfigFiscalCols.includes('fiscal_default_client'))
    exec("ALTER TABLE shop_config ADD COLUMN fiscal_default_client TEXT DEFAULT 'Klient i Pergjithshem'");
  if (!shopConfigFiscalCols.includes('fiscal_environment'))
    exec("ALTER TABLE shop_config ADD COLUMN fiscal_environment TEXT DEFAULT 'test'");
  if (!shopConfigFiscalCols.includes('fiscal_middleware'))
    exec("ALTER TABLE shop_config ADD COLUMN fiscal_middleware TEXT DEFAULT 'nexia'");
  if (!shopConfigFiscalCols.includes('delivery_threshold_1'))
    exec('ALTER TABLE shop_config ADD COLUMN delivery_threshold_1 INTEGER DEFAULT 5');
  if (!shopConfigFiscalCols.includes('delivery_threshold_2'))
    exec('ALTER TABLE shop_config ADD COLUMN delivery_threshold_2 INTEGER DEFAULT 15');
  if (!shopConfigFiscalCols.includes('delivery_time_1'))
    exec('ALTER TABLE shop_config ADD COLUMN delivery_time_1 INTEGER DEFAULT 15');
  if (!shopConfigFiscalCols.includes('delivery_time_2'))
    exec('ALTER TABLE shop_config ADD COLUMN delivery_time_2 INTEGER DEFAULT 30');
  if (!shopConfigFiscalCols.includes('delivery_time_3'))
    exec('ALTER TABLE shop_config ADD COLUMN delivery_time_3 INTEGER DEFAULT 45');

  const shopItemFiscalCols = prepare("SELECT name FROM pragma_table_info('shop_menu_items')")
    .all().map((r: any) => r.name as string);
  if (!shopItemFiscalCols.includes('vat_rate'))
    exec("ALTER TABLE shop_menu_items ADD COLUMN vat_rate TEXT DEFAULT 'VAT_20'");
  if (!shopItemFiscalCols.includes('item_code'))
    exec('ALTER TABLE shop_menu_items ADD COLUMN item_code TEXT');
  if (!shopItemFiscalCols.includes('unit'))
    exec("ALTER TABLE shop_menu_items ADD COLUMN unit TEXT DEFAULT 'XPP'");

  const shopOrderFiscalCols = prepare("SELECT name FROM pragma_table_info('shop_orders')")
    .all().map((r: any) => r.name as string);
  if (!shopOrderFiscalCols.includes('payment_type'))
    exec("ALTER TABLE shop_orders ADD COLUMN payment_type TEXT DEFAULT 'BANKNOTE'");
  if (!shopOrderFiscalCols.includes('fiscal_status'))
    exec("ALTER TABLE shop_orders ADD COLUMN fiscal_status TEXT DEFAULT 'not_fiscalized'");
  if (!shopOrderFiscalCols.includes('fiscal_iic'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_iic TEXT');
  if (!shopOrderFiscalCols.includes('fiscal_fic'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_fic TEXT');
  if (!shopOrderFiscalCols.includes('fiscal_inv_num'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_inv_num TEXT');
  if (!shopOrderFiscalCols.includes('fiscal_verify_url'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_verify_url TEXT');
  if (!shopOrderFiscalCols.includes('fiscal_error'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_error TEXT');
  if (!shopOrderFiscalCols.includes('fiscal_token'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_token TEXT');
  if (!shopOrderFiscalCols.includes('fiscal_token_exp'))
    exec('ALTER TABLE shop_orders ADD COLUMN fiscal_token_exp TEXT');

  const shopUserFiscalCols = prepare("SELECT name FROM pragma_table_info('shop_users')")
    .all().map((r: any) => r.name as string);
  if (!shopUserFiscalCols.includes('fiscal_operator_code'))
    exec('ALTER TABLE shop_users ADD COLUMN fiscal_operator_code TEXT');

  // shop_inventory_001 — Inventory & Recipe Module
  const shopConfigInvCols = prepare("SELECT name FROM pragma_table_info('shop_config')")
    .all().map((r: any) => r.name as string);
  if (!shopConfigInvCols.includes('inventory_enabled'))
    exec('ALTER TABLE shop_config ADD COLUMN inventory_enabled INTEGER DEFAULT 0');
  if (!shopConfigInvCols.includes('inventory_alert_mode'))
    exec("ALTER TABLE shop_config ADD COLUMN inventory_alert_mode TEXT DEFAULT 'daily'");
  if (!shopConfigInvCols.includes('inventory_alert_time'))
    exec("ALTER TABLE shop_config ADD COLUMN inventory_alert_time TEXT DEFAULT '09:00'");
  if (!shopConfigInvCols.includes('inventory_alert_whatsapp'))
    exec('ALTER TABLE shop_config ADD COLUMN inventory_alert_whatsapp INTEGER DEFAULT 0');

  const shopItemInvCols = prepare("SELECT name FROM pragma_table_info('shop_menu_items')")
    .all().map((r: any) => r.name as string);
  if (!shopItemInvCols.includes('stock_mode'))
    exec("ALTER TABLE shop_menu_items ADD COLUMN stock_mode TEXT DEFAULT 'simple'");

  // shop_rental_001 — per-item hourly/rental pricing
  const shopItemRentalCols = prepare("SELECT name FROM pragma_table_info('shop_menu_items')")
    .all().map((r: any) => r.name as string);
  if (!shopItemRentalCols.includes('pricing_type'))
    exec("ALTER TABLE shop_menu_items ADD COLUMN pricing_type TEXT DEFAULT 'fixed'");

  const shopOrderItemRentalCols = prepare("SELECT name FROM pragma_table_info('shop_order_items')")
    .all().map((r: any) => r.name as string);
  if (!shopOrderItemRentalCols.includes('rental_hours'))
    exec('ALTER TABLE shop_order_items ADD COLUMN rental_hours INTEGER');

  // shop_rental_002 — multi-tier pricing
  const shopMenuItemTierCols = prepare("SELECT name FROM pragma_table_info('shop_menu_items')")
    .all().map((r: any) => r.name as string);
  if (!shopMenuItemTierCols.includes('price_2h'))  exec('ALTER TABLE shop_menu_items ADD COLUMN price_2h REAL DEFAULT NULL');
  if (!shopMenuItemTierCols.includes('price_3h'))  exec('ALTER TABLE shop_menu_items ADD COLUMN price_3h REAL DEFAULT NULL');
  if (!shopMenuItemTierCols.includes('price_4h'))  exec('ALTER TABLE shop_menu_items ADD COLUMN price_4h REAL DEFAULT NULL');
  if (!shopMenuItemTierCols.includes('price_day')) exec('ALTER TABLE shop_menu_items ADD COLUMN price_day REAL DEFAULT NULL');

  const shopOrderItemTierCols = prepare("SELECT name FROM pragma_table_info('shop_order_items')")
    .all().map((r: any) => r.name as string);
  if (!shopOrderItemTierCols.includes('rental_tier')) exec('ALTER TABLE shop_order_items ADD COLUMN rental_tier TEXT DEFAULT NULL');

  // shop_menu_docs_001 — PDF/URL menu documents
  exec(`CREATE TABLE IF NOT EXISTS shop_menu_documents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, label TEXT NOT NULL, doc_type TEXT NOT NULL CHECK (doc_type IN ('pdf', 'url')), file_url TEXT, external_url TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  exec(`CREATE INDEX IF NOT EXISTS idx_shop_menu_docs_tenant ON shop_menu_documents(tenant_id, sort_order)`);

  // shop_qr_pos_001 — configurable name/table position in QR ordering
  const shopQrPosCols = prepare("SELECT name FROM pragma_table_info('shop_config')")
    .all().map((r: any) => r.name as string);
  if (!shopQrPosCols.includes('qr_name_position'))
    exec("ALTER TABLE shop_config ADD COLUMN qr_name_position TEXT DEFAULT 'welcome'");

  // shop_notify_001 — staff WhatsApp notifications + browser sound
  const shopNotifyCols = prepare("SELECT name FROM pragma_table_info('shop_config')")
    .all().map((r: any) => r.name as string);
  if (!shopNotifyCols.includes('staff_notify_number'))
    exec('ALTER TABLE shop_config ADD COLUMN staff_notify_number TEXT');
  if (!shopNotifyCols.includes('staff_notify_enabled'))
    exec('ALTER TABLE shop_config ADD COLUMN staff_notify_enabled INTEGER DEFAULT 0');
  if (!shopNotifyCols.includes('staff_notify_keepalive_time'))
    exec("ALTER TABLE shop_config ADD COLUMN staff_notify_keepalive_time TEXT DEFAULT '08:00'");
  if (!shopNotifyCols.includes('notify_sound'))
    exec("ALTER TABLE shop_config ADD COLUMN notify_sound TEXT DEFAULT 'chime'");
  if (!shopNotifyCols.includes('notify_sound_enabled'))
    exec('ALTER TABLE shop_config ADD COLUMN notify_sound_enabled INTEGER DEFAULT 1');

  // shop_cancel_reason_001 — staff cancel reason
  const shopOrderCancelCols = prepare("SELECT name FROM pragma_table_info('shop_orders')")
    .all().map((r: any) => r.name as string);
  if (!shopOrderCancelCols.includes('cancel_reason'))
    exec('ALTER TABLE shop_orders ADD COLUMN cancel_reason TEXT');

  // instagram_002 — Instagram account ID on tenants
  if (!cols.includes('instagram_account_id'))
    exec('ALTER TABLE tenants ADD COLUMN instagram_account_id TEXT');

  // instagram_003 — per-channel AI + connection settings (SQLite-compatible)
  exec(`CREATE TABLE IF NOT EXISTS hotel_channel_settings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    ai_enabled INTEGER NOT NULL DEFAULT 1,
    connected INTEGER NOT NULL DEFAULT 0,
    access_token TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, channel)
  )`);

  console.log('✅ SQLite migrations complete');
}
