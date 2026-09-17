// applyAction.ts — shared "add to FAQ" / "dismiss" logic for an
// unanswered_questions row, used by both the no-login email action links
// (routes/reportActions.ts) and the authenticated dashboard review UI
// (routes/unansweredQuestions.ts).
import crypto from 'crypto';
import { query, queryOne, queryRun } from '../db/database.js';
import { getFaqTable } from './faqTables.js';

export async function addQuestionToFaq(
  questionId: string,
  editedAnswer?: string,
): Promise<{ ok: boolean; error?: string; alreadyReviewed?: boolean }> {
  const q = await queryOne('SELECT * FROM unanswered_questions WHERE id = ?', [questionId]) as any;
  if (!q) return { ok: false, error: 'Question not found' };
  if (q.status !== 'new') return { ok: false, error: 'Already reviewed', alreadyReviewed: true };

  const tenant = await queryOne('SELECT type FROM tenants WHERE id = ?', [q.tenant_id]) as any;
  const faqTable = getFaqTable(tenant?.type || 'hotel');
  const answer = (editedAnswer && editedAnswer.trim()) || q.suggested_answer || '[Add an answer]';

  let insertedFaqId: string;
  if (faqTable === 'hotel_faq') {
    insertedFaqId = crypto.randomUUID();
    await queryRun(
      `INSERT INTO hotel_faq (id, tenant_id, question, answer, category, is_active) VALUES (?, ?, ?, ?, 'General', 1)`,
      [insertedFaqId, q.tenant_id, q.guest_question, answer],
    );
  } else if (faqTable === 'shop_faq') {
    insertedFaqId = crypto.randomUUID();
    await queryRun(
      `INSERT INTO shop_faq (id, tenant_id, question, answer) VALUES (?, ?, ?, ?)`,
      [insertedFaqId, q.tenant_id, q.guest_question, answer],
    );
  } else {
    // gb_faqs / art_class_faq — id has a DB-side default (gen_random_uuid()).
    const [row] = await query(
      `INSERT INTO ${faqTable} (tenant_id, question, answer) VALUES (?, ?, ?) RETURNING id`,
      [q.tenant_id, q.guest_question, answer],
    ) as any[];
    insertedFaqId = row.id;
  }

  await queryRun(
    `UPDATE unanswered_questions SET status = 'added_to_faq', added_faq_id = ?, reviewed_at = NOW() WHERE id = ?`,
    [insertedFaqId, questionId],
  );

  return { ok: true };
}

export async function dismissQuestion(questionId: string): Promise<{ ok: boolean }> {
  await queryRun(
    `UPDATE unanswered_questions SET status = 'dismissed', reviewed_at = NOW() WHERE id = ? AND status = 'new'`,
    [questionId],
  );
  return { ok: true };
}
