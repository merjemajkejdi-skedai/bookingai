import { Router, Request, Response } from 'express';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { getEscalationConfig, saveEscalationConfig } from './config.js';

export const escalationRouter = Router();

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

// super_admin must name the tenant explicitly: resolveTenantId() would otherwise
// fall back to 'tenant-demo-001' and silently read/write the wrong tenant.
function tenantFor(req: Request): string | null {
  if (req.user?.role === 'super_admin') {
    const q = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';
    const b = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    return q || b || null;
  }
  return resolveTenantId(req);
}

escalationRouter.get('/escalation/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = tenantFor(req);
  if (!tenantId) return err(res, 'tenantId is required');
  try {
    const config = await getEscalationConfig(tenantId);
    if (!config) return err(res, 'Tenant not found', 404);
    ok(res, config);
  } catch (e: any) { err(res, e.message, 500); }
});

escalationRouter.put('/escalation/config', requireAuth, async (req: Request, res: Response) => {
  const tenantId = tenantFor(req);
  if (!tenantId) return err(res, 'tenantId is required');
  try {
    const { enabled, number, timeoutMinutes } = req.body ?? {};
    const result = await saveEscalationConfig(tenantId, { enabled, number, timeoutMinutes });
    if (!result.ok) return err(res, result.error, result.status);
    ok(res, result.config);
  } catch (e: any) { err(res, e.message, 500); }
});
