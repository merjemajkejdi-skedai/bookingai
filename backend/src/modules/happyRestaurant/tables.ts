import { Router, Request, Response } from 'express';
import { requireHappyAuth, requireHappyRole, HappyUser } from '../../middleware/happyAuth.js';
import { dbAll, dbGet, dbRun, ok, err } from './shared.js';

export const happyTablesRouter = Router();

const STATUSES = ['available', 'occupied', 'bill_requested', 'reserved', 'closed'];

function serialize(row: any) {
  return {
    id: row.id, number: row.number != null ? Number(row.number) : null, name: row.name,
    section: row.section, capacity: Number(row.capacity), status: row.status,
    current_order_id: row.current_order_id,
    is_active: row.is_active === 1 || row.is_active === true,
    sort_order: Number(row.sort_order),
  };
}

happyTablesRouter.get('/restaurant/tables', requireHappyAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const rows = await dbAll(
      `SELECT * FROM happy_tables WHERE tenant_id=? AND is_active=1 ORDER BY sort_order ASC, number ASC`,
      tenantId,
    );
    ok(res, rows.map(serialize));
  } catch (e: any) { err(res, e.message, 500); }
});

happyTablesRouter.post('/restaurant/tables', requireHappyAuth, requireHappyRole(['manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { number, name, section, capacity = 4, sort_order = 0 } = req.body ?? {};
  if (number == null && !name?.trim()) return err(res, 'number or name is required');
  try {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO happy_tables (id, tenant_id, number, name, section, capacity, sort_order) VALUES (?,?,?,?,?,?,?)`,
      id, tenantId, number ?? null, name?.trim() || null, section?.trim() || null, Number(capacity), Number(sort_order),
    );
    const row = await dbGet(`SELECT * FROM happy_tables WHERE id=?`, id);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyTablesRouter.put('/restaurant/tables/:id', requireHappyAuth, requireHappyRole(['manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const { number, name, section, capacity, sort_order } = req.body ?? {};
  try {
    const existing = await dbGet(`SELECT id FROM happy_tables WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Table not found', 404);
    await dbRun(
      `UPDATE happy_tables SET
        number=COALESCE(?,number), name=COALESCE(?,name), section=COALESCE(?,section),
        capacity=COALESCE(?,capacity), sort_order=COALESCE(?,sort_order), updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      number ?? null, name?.trim() ?? null, section?.trim() ?? null,
      capacity != null ? Number(capacity) : null, sort_order != null ? Number(sort_order) : null,
      id,
    );
    const row = await dbGet(`SELECT * FROM happy_tables WHERE id=?`, id);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyTablesRouter.put('/restaurant/tables/:id/status', requireHappyAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!STATUSES.includes(status)) return err(res, `status must be one of: ${STATUSES.join(', ')}`);
  try {
    const existing = await dbGet(`SELECT id FROM happy_tables WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Table not found', 404);
    await dbRun(`UPDATE happy_tables SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, status, id);
    const row = await dbGet(`SELECT * FROM happy_tables WHERE id=?`, id);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyTablesRouter.delete('/restaurant/tables/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT id FROM happy_tables WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Table not found', 404);
    await dbRun(`UPDATE happy_tables SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});
