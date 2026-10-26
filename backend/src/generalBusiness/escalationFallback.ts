// General business side of the escalation timeout fallback: files the normal request when staff didn't answer.
// Reuses the create_request tool as-is, so department routing and staff notification behave as they do today.
import { query } from '../db/database.js';
import { executeGbTool } from './tools.js';
import type { FallbackRow } from '../escalation/fallback.js';

export async function createGbFallbackRequest(row: FallbackRow): Promise<void> {
  const [conv] = (await query(
    `SELECT id, guest_phone FROM gb_conversations WHERE id = ? AND tenant_id = ?`,
    [row.conversation_id, row.tenant_id],
  )) as any[];
  if (!conv) throw new Error('conversation not found');

  const out = await executeGbTool(
    'create_request',
    {
      department_id: row.department_id ?? undefined,
      request_type: row.kind === 'request' ? 'request' : 'enquiry',
      description: row.guest_question,
    },
    row.tenant_id,
    conv.guest_phone,
    String(conv.id),
  );

  if (!out.startsWith('Request created successfully')) throw new Error(`create_request did not succeed: ${out.slice(0, 200)}`);
}
