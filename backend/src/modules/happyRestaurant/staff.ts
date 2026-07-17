import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requireHappyAuth, requireHappyRole, HappyUser, HappyRole } from '../../middleware/happyAuth.js';
import { dbAll, dbGet, dbRun, ok, err, HAPPY_ROLES } from './shared.js';

export const happyStaffRouter = Router();

function serialize(row: any) {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    is_active: row.is_active === 1 || row.is_active === true,
    has_pin: !!row.pin_hash,
    created_at: row.created_at,
  };
}

happyStaffRouter.get('/restaurant/staff', requireHappyAuth, requireHappyRole(['manager', 'admin']), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const rows = await dbAll(`SELECT * FROM happy_staff WHERE tenant_id = ? ORDER BY created_at ASC`, tenantId);
    ok(res, rows.map(serialize));
  } catch (e: any) { err(res, e.message, 500); }
});

happyStaffRouter.post('/restaurant/staff', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { name, email, pin, role } = req.body ?? {};
  if (!name?.trim()) return err(res, 'name is required');
  if (!role || !HAPPY_ROLES.includes(role as HappyRole)) return err(res, `role must be one of: ${HAPPY_ROLES.join(', ')}`);
  if (!email?.trim() && !pin?.trim()) return err(res, 'at least one of email or pin is required');
  if (pin && !/^\d{4,8}$/.test(String(pin))) return err(res, 'pin must be 4-8 digits');

  try {
    if (email?.trim()) {
      const dupe = await dbGet(`SELECT id FROM happy_staff WHERE tenant_id=? AND email=?`, tenantId, String(email).trim().toLowerCase());
      if (dupe) return err(res, 'A staff member with this email already exists');
    }
    const pinHash = pin?.trim() ? await bcrypt.hash(String(pin), 10) : null;
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO happy_staff (id, tenant_id, name, email, pin_hash, role) VALUES (?,?,?,?,?,?)`,
      id, tenantId, name.trim(), email?.trim()?.toLowerCase() || null, pinHash, role,
    );
    const row = await dbGet(`SELECT * FROM happy_staff WHERE id=?`, id);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyStaffRouter.put('/restaurant/staff/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  const { name, email, pin, role, is_active } = req.body ?? {};
  if (role && !HAPPY_ROLES.includes(role as HappyRole)) return err(res, `role must be one of: ${HAPPY_ROLES.join(', ')}`);
  if (pin && !/^\d{4,8}$/.test(String(pin))) return err(res, 'pin must be 4-8 digits');

  try {
    const existing = await dbGet(`SELECT * FROM happy_staff WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Staff member not found', 404);

    const pinHash = pin?.trim() ? await bcrypt.hash(String(pin), 10) : existing.pin_hash;
    await dbRun(
      `UPDATE happy_staff SET
        name=COALESCE(?,name), email=?, pin_hash=?, role=COALESCE(?,role),
        is_active=COALESCE(?,is_active), updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      name?.trim() ?? null,
      email !== undefined ? (email?.trim()?.toLowerCase() || null) : existing.email,
      pinHash,
      role ?? null,
      is_active != null ? (is_active ? 1 : 0) : null,
      id,
    );
    const row = await dbGet(`SELECT * FROM happy_staff WHERE id=?`, id);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happyStaffRouter.delete('/restaurant/staff/:id', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  const { id } = req.params;
  try {
    const existing = await dbGet(`SELECT id FROM happy_staff WHERE id=? AND tenant_id=?`, id, tenantId);
    if (!existing) return err(res, 'Staff member not found', 404);
    await dbRun(`UPDATE happy_staff SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id);
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});
