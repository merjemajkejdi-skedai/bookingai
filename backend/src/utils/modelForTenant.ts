// Resolves which Claude model a tenant's agent should call. Shared
// infrastructure used by all per-tenant conversational agents — not business
// logic, so it doesn't break the "no shared code between tenant-type agents"
// rule those agents otherwise follow.
import { isPg, prepare, queryOne } from '../db/database.js';

// The fixed, known-good list a tenant's claude_model can be set to — also
// what the admin dropdown offers. A freeform field would let a typo silently
// break every message for that tenant at the Claude API call.
// Keep in sync with frontend/src/pages/AdminPage.tsx's CLAUDE_MODEL_OPTIONS,
// and with COST_PER_MESSAGE_BY_MODEL in CostAnalyticsPage.tsx.
export const CLAUDE_MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fastest, cheapest)' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet (default — balanced)' },
  { value: 'claude-opus-5',             label: 'Opus 5 (most capable)' },
] as const;

export const VALID_CLAUDE_MODELS = new Set(CLAUDE_MODEL_OPTIONS.map(o => o.value));

// Matches every agent's existing hardcoded fallback, so a tenant with no
// claude_model set (i.e. every tenant today) keeps behaving exactly as before.
const DEFAULT_MODEL = process.env.DEFAULT_CLAUDE_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function getModelForTenant(tenantId: string): Promise<string> {
  try {
    const row = isPg
      ? await queryOne('SELECT claude_model FROM tenants WHERE id = ?', [tenantId])
      : prepare('SELECT claude_model FROM tenants WHERE id = ?').get(tenantId);
    return (row as any)?.claude_model || DEFAULT_MODEL;
  } catch (e: any) {
    console.warn('[getModelForTenant] lookup failed, using default:', e.message);
    return DEFAULT_MODEL;
  }
}
