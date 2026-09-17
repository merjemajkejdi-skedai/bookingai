// reportActions.ts — no-login-required "Add to FAQ" / "Dismiss" links sent
// in the owner report email. Each link carries a signed, scoped token
// (reportActionTokens.ts) so no dashboard session is needed to act on it.
import { Router, Request, Response } from 'express';
import { isPg } from '../db/database.js';
import { verifyReportActionToken } from '../faqGap/reportActionTokens.js';
import { addQuestionToFaq, dismissQuestion } from '../faqGap/applyAction.js';

export const reportActionsRouter = Router();

function confirmationPage(message: string, ok: boolean): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:420px;margin:80px auto;background:white;border-radius:12px;
              padding:32px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <p style="font-size:40px;margin:0 0 12px;">${ok ? '✅' : '⚠️'}</p>
    <p style="font-size:16px;color:#0f172a;margin:0;">${message}</p>
  </div>
</body>
</html>`;
}

reportActionsRouter.get('/faq/:questionId/add', async (req: Request, res: Response) => {
  try {
    if (!isPg) return res.status(500).send(confirmationPage('Not available in this environment.', false));

    const { questionId } = req.params;
    const payload = verifyReportActionToken(req.query.token as string | undefined);
    if (!payload || payload.questionId !== questionId || payload.action !== 'add') {
      return res.status(400).send(confirmationPage('This link is invalid or has expired.', false));
    }

    const result = await addQuestionToFaq(questionId);
    if (!result.ok) {
      return res.send(confirmationPage(
        result.alreadyReviewed ? 'This question has already been reviewed.' : 'Something went wrong.',
        !!result.alreadyReviewed,
      ));
    }

    res.send(confirmationPage('Added to your FAQ ✅', true));
  } catch (e: any) {
    console.error('[ReportActions] add error:', e.message);
    res.status(500).send(confirmationPage('Something went wrong. Please try again from the dashboard.', false));
  }
});

reportActionsRouter.get('/faq/:questionId/dismiss', async (req: Request, res: Response) => {
  try {
    if (!isPg) return res.status(500).send(confirmationPage('Not available in this environment.', false));

    const { questionId } = req.params;
    const payload = verifyReportActionToken(req.query.token as string | undefined);
    if (!payload || payload.questionId !== questionId || payload.action !== 'dismiss') {
      return res.status(400).send(confirmationPage('This link is invalid or has expired.', false));
    }

    await dismissQuestion(questionId);
    res.send(confirmationPage('Dismissed', true));
  } catch (e: any) {
    console.error('[ReportActions] dismiss error:', e.message);
    res.status(500).send(confirmationPage('Something went wrong.', false));
  }
});
