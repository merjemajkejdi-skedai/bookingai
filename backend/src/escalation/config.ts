// Human-in-the-loop escalation — tenant configuration (stage 1: settings only).
// Off by default for every tenant; nothing here changes agent or webhook behavior.
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbAll(sql: string, ...p: unknown[]) {
  return (isPg ? query(sql, p) : prepare(sql).all(...p)) as Promise<any[]> | any[];
}
async function dbRun(sql: string, ...p: unknown[]) {
  if (isPg) return queryRun(sql, p);
  prepare(sql).run(...p);
}

export const ESCALATION_TENANT_TYPES = ['hotel', 'shop', 'general_business', 'art_class', 'airbnb', 'skedai'] as const;

// Tenant types that have a departments table, and what that table calls its "active" check.
const DEPARTMENT_TABLES: Record<string, { table: string; activePg: string; activeLite: string }> = {
  hotel:            { table: 'hotel_departments', activePg: 'is_active = 1',    activeLite: 'is_active = 1' },
  general_business: { table: 'gb_departments',    activePg: 'is_active = true', activeLite: 'is_active = 1' },
  airbnb:           { table: 'airbnb_departments', activePg: 'is_active = true', activeLite: 'is_active = 1' },
};

export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 1440;

export function departmentTableForType(type: string): string | null {
  return DEPARTMENT_TABLES[type]?.table ?? null;
}

/** Strips "whatsapp:", spaces, dashes, dots and brackets; returns "+<digits>" or null if not E.164. */
export function normalizeEscalationNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^whatsapp:/i, '').replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{6,14}$/.test(cleaned) ? cleaned : null;
}

export const INVALID_NUMBER_MESSAGE = 'Enter the number in international format, e.g. +355691234567';

export type ParsedNumber = { ok: true; value: string | null } | { ok: false; error: string };

/** undefined/''/null -> clear (null). Otherwise must be valid E.164. */
export function parseEscalationNumberInput(raw: unknown): ParsedNumber {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: true, value: null };
  }
  const n = normalizeEscalationNumber(raw);
  return n ? { ok: true, value: n } : { ok: false, error: INVALID_NUMBER_MESSAGE };
}

export async function setDepartmentEscalationNumber(
  tenantType: string, departmentId: string, tenantId: string, value: string | null,
): Promise<void> {
  const table = departmentTableForType(tenantType);
  if (!table) return;
  await dbRun(`UPDATE ${table} SET escalation_number = ? WHERE id = ? AND tenant_id = ?`, value, departmentId, tenantId);
}

async function anyDepartmentHasNumber(tenantId: string, type: string): Promise<boolean> {
  const d = DEPARTMENT_TABLES[type];
  if (!d) return false;
  const row = await dbGet(
    `SELECT 1 AS found FROM ${d.table}
     WHERE tenant_id = ? AND escalation_number IS NOT NULL AND escalation_number <> ''
       AND ${isPg ? d.activePg : d.activeLite} LIMIT 1`,
    tenantId,
  );
  return !!row;
}

/** Every number that can answer escalations for this tenant: the default plus active departments' own. */
export async function listEscalationNumbers(tenantId: string, type: string, defaultNumber: unknown): Promise<string[]> {
  const out = new Set<string>();
  const def = normalizeEscalationNumber(defaultNumber);
  if (def) out.add(def);
  const d = DEPARTMENT_TABLES[type];
  if (d) {
    const rows = await dbAll(
      `SELECT escalation_number FROM ${d.table}
       WHERE tenant_id = ? AND escalation_number IS NOT NULL AND escalation_number <> ''
         AND ${isPg ? d.activePg : d.activeLite}`,
      tenantId,
    );
    for (const r of rows) {
      const n = normalizeEscalationNumber(r.escalation_number);
      if (n) out.add(n);
    }
  }
  return [...out];
}

export interface EscalationConfig {
  tenantType: string;
  supported: boolean;
  hasDepartments: boolean;
  enabled: boolean;
  number: string | null;
  timeoutMinutes: number;
}

export async function getEscalationConfig(tenantId: string): Promise<EscalationConfig | null> {
  if (!isPg) return null;
  const t = await dbGet(
    `SELECT type, human_escalation_enabled, human_escalation_number, human_escalation_timeout_minutes
     FROM tenants WHERE id = ? AND deleted_at IS NULL`,
    tenantId,
  ) as any;
  if (!t) return null;
  return {
    tenantType: t.type,
    supported: (ESCALATION_TENANT_TYPES as readonly string[]).includes(t.type),
    hasDepartments: !!DEPARTMENT_TABLES[t.type],
    enabled: !!t.human_escalation_enabled,
    number: t.human_escalation_number ?? null,
    timeoutMinutes: Number(t.human_escalation_timeout_minutes) || 15,
  };
}

export interface EscalationConfigInput {
  enabled?: unknown;
  number?: unknown;
  timeoutMinutes?: unknown;
}

export async function saveEscalationConfig(
  tenantId: string, input: EscalationConfigInput,
): Promise<{ ok: true; config: EscalationConfig } | { ok: false; error: string; status: number }> {
  if (!isPg) return { ok: false, error: 'Human escalation requires the Postgres database', status: 400 };

  const current = await getEscalationConfig(tenantId);
  if (!current) return { ok: false, error: 'Tenant not found', status: 404 };

  let enabled = current.enabled;
  let number = current.number;
  let timeoutMinutes = current.timeoutMinutes;

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false', status: 400 };
    enabled = input.enabled;
  }
  if (input.number !== undefined) {
    const parsed = parseEscalationNumberInput(input.number);
    if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
    number = parsed.value;
  }
  if (input.timeoutMinutes !== undefined) {
    const n = Number(input.timeoutMinutes);
    if (!Number.isInteger(n) || n < MIN_TIMEOUT_MINUTES || n > MAX_TIMEOUT_MINUTES) {
      return { ok: false, error: `Timeout must be a whole number of minutes between ${MIN_TIMEOUT_MINUTES} and ${MAX_TIMEOUT_MINUTES}`, status: 400 };
    }
    timeoutMinutes = n;
  }

  if (enabled && !current.supported) {
    return { ok: false, error: `Human escalation is not available for ${current.tenantType} tenants`, status: 400 };
  }
  if (enabled && !number && !(await anyDepartmentHasNumber(tenantId, current.tenantType))) {
    return { ok: false, error: 'Set a default staff number (or an escalation number on a department) before turning this on', status: 400 };
  }

  await dbRun(
    `UPDATE tenants SET human_escalation_enabled = ?, human_escalation_number = ?, human_escalation_timeout_minutes = ? WHERE id = ?`,
    enabled, number, timeoutMinutes, tenantId,
  );
  return { ok: true, config: { ...current, enabled, number, timeoutMinutes } };
}
