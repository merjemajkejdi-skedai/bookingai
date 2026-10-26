// Airbnb side of the escalation timeout fallback: files the normal request when the host didn't answer.
// Reuses the create_request tool as-is, so department matching and the host notification behave as they do today.
import { query } from '../db/database.js';
import { executeAirbnbTool } from './tools.js';
import type { FallbackRow } from '../escalation/fallback.js';

export async function createAirbnbFallbackRequest(row: FallbackRow): Promise<void> {
  const [conv] = (await query(
    `SELECT id, listing_id FROM airbnb_conversations WHERE id = ? AND tenant_id = ?`,
    [row.conversation_id, row.tenant_id],
  )) as any[];
  if (!conv) throw new Error('conversation not found');
  if (!conv.listing_id) throw new Error('conversation has no identified listing');

  const out = await executeAirbnbTool(
    'create_request',
    { listing_id: String(conv.listing_id), category: 'general', description: row.guest_question },
    row.tenant_id,
    String(conv.id),
  );

  let parsed: any = null;
  try { parsed = JSON.parse(out); } catch { /* not JSON */ }
  if (!parsed?.logged) throw new Error(`create_request did not succeed: ${out.slice(0, 200)}`);
}
