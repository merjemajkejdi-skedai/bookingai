// logUnansweredQuestion.ts — shared handler for the log_unanswered_question
// tool, called from all four agents (hotel/tools.ts, shop/tools.ts,
// generalBusiness/tools.ts, modules/art_class/agent.ts). Fire-and-forget from
// the caller's perspective: never throws, never blocks or changes the
// guest-facing reply — the deferral response itself is untouched, this only
// adds logging alongside it.
import crypto from 'crypto';
import { isPg, query, queryRun } from '../db/database.js';
import { draftSuggestedAnswer } from './draftSuggestedAnswer.js';

export async function logUnansweredQuestion(
  tenantId: string,
  tenantType: string,
  guestQuestion: string,
  topicHint: string,
  conversationId?: string,
): Promise<void> {
  if (!isPg) return; // Postgres-only, mirrors reports/ and conversations/archiveCron.ts

  try {
    // Dedup: an obvious repeat of the same topic within the last 14 days that
    // hasn't been reviewed yet shouldn't spam the report with near-duplicates
    // (v1 simplification — exact topic_hint match, not semantic similarity).
    const recent = await query(
      `SELECT id FROM unanswered_questions
       WHERE tenant_id = ? AND status = 'new' AND lower(topic_hint) = lower(?)
         AND created_at > NOW() - INTERVAL '14 days'`,
      [tenantId, topicHint],
    ) as any[];
    if (recent.length > 0) return;

    const id = crypto.randomUUID();
    await queryRun(
      `INSERT INTO unanswered_questions (id, tenant_id, conversation_id, guest_question, topic_hint)
       VALUES (?, ?, ?, ?, ?)`,
      [id, tenantId, conversationId ?? null, guestQuestion, topicHint],
    );

    // Draft generation happens after the row exists and after this function
    // has already returned control to the tool call — never let a slow or
    // failed Claude call delay the guest-facing turn.
    draftSuggestedAnswer(tenantType, guestQuestion)
      .then(draft => queryRun(`UPDATE unanswered_questions SET suggested_answer = ? WHERE id = ?`, [draft, id]))
      .catch((e: any) => console.error('[FaqGap] Draft generation failed:', e.message));
  } catch (e: any) {
    console.error('[FaqGap] logUnansweredQuestion failed:', e.message);
  }
}
