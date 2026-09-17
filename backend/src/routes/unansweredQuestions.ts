// unansweredQuestions.ts — dashboard review UI API for the FAQ gap detection
// feature: list questions the AI couldn't answer, and add-to-FAQ / dismiss
// each one (with an editable answer), same underlying logic as the no-login
// email action links in reportActions.ts.
import { Router, Request, Response } from 'express';
import { isPg, query, queryOne } from '../db/database.js';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { addQuestionToFaq, dismissQuestion } from '../faqGap/applyAction.js';

export const unansweredQuestionsRouter = Router();
unansweredQuestionsRouter.use(requireAuth);

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) => res.status(status).json({ success: false, error: msg });

unansweredQuestionsRouter.get('/unanswered-questions', async (req: Request, res: Response) => {
  try {
    if (!isPg) return ok(res, []);
    const tenantId = resolveTenantId(req);
    const status = (req.query.status as string) || 'new';
    const rows = await query(
      `SELECT * FROM unanswered_questions WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC`,
      [tenantId, status],
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

unansweredQuestionsRouter.patch('/unanswered-questions/:id', async (req: Request, res: Response) => {
  try {
    if (!isPg) return err(res, 'Not available in this environment', 500);
    const tenantId = resolveTenantId(req);
    const { action, editedAnswer } = req.body as { action?: string; editedAnswer?: string };

    if (action !== 'add_to_faq' && action !== 'dismiss')
      return err(res, "action must be 'add_to_faq' or 'dismiss'");

    // Scope check — a question belongs to exactly one tenant; don't act on
    // (or reveal the existence of) another tenant's row.
    const question = await queryOne('SELECT tenant_id FROM unanswered_questions WHERE id = ?', [req.params.id]) as any;
    if (!question || question.tenant_id !== tenantId) return err(res, 'Question not found', 404);

    const result = action === 'add_to_faq'
      ? await addQuestionToFaq(req.params.id, editedAnswer)
      : await dismissQuestion(req.params.id);

    if ('ok' in result && !result.ok) return err(res, (result as any).error || 'Failed', 400);

    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});
