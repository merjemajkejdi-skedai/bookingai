// getReportQuestions.ts — fetches the unanswered questions to feature in a
// tenant's owner report for a given period. Kept separate from
// reports/computeReportStats.ts since it's a distinct concern (FAQ gaps,
// not conversation/request stats) with its own table.
import { isPg, query } from '../db/database.js';

export interface ReportQuestion {
  id: string;
  guest_question: string;
  suggested_answer: string | null;
}

export async function getUnansweredQuestionsForReport(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportQuestion[]> {
  if (!isPg) return [];

  return query(
    `SELECT id, guest_question, suggested_answer FROM unanswered_questions
     WHERE tenant_id = ? AND status = 'new' AND created_at >= ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 10`,
    [tenantId, periodStart.toISOString(), periodEnd.toISOString()],
  ) as unknown as Promise<ReportQuestion[]>;
}
