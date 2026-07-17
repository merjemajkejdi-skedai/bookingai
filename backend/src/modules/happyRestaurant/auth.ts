import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getJwtSecret } from '../../lib/jwt.js';
import { dbGet, dbAll, ok, err } from './shared.js';

export const happyAuthRouter = Router();

// POST /restaurant/auth/login
// Body: { tenant_code, email?, pin }
// - tenant_code resolves the venue (happy_settings.tenant_code)
// - if email is given, look up that exact staff row and verify pin against it
// - otherwise scan the tenant's active staff for a pin_hash match (PIN-pad login,
//   no username needed — normal for a shared POS terminal)
happyAuthRouter.post('/restaurant/auth/login', async (req: Request, res: Response) => {
  try {
    const { tenant_code, email, pin } = req.body ?? {};
    if (!tenant_code?.trim()) return err(res, 'tenant_code is required');
    if (!pin?.trim() && !email?.trim()) return err(res, 'pin (and/or email) is required');

    const settings = await dbGet(
      `SELECT tenant_id, venue_type, venue_name, waiter_login_method FROM happy_settings WHERE tenant_code = ?`,
      String(tenant_code).trim().toLowerCase(),
    );
    if (!settings) return err(res, 'Venue not found', 401);

    let staff: any = null;

    if (email?.trim()) {
      const row = await dbGet(
        `SELECT * FROM happy_staff WHERE tenant_id = ? AND email = ? AND is_active = 1`,
        settings.tenant_id, String(email).trim().toLowerCase(),
      );
      if (row && pin?.trim() && row.pin_hash && await bcrypt.compare(String(pin), row.pin_hash)) {
        staff = row;
      } else if (row && !row.pin_hash && !pin?.trim()) {
        // email-only login only allowed if the account has no PIN configured
        staff = row;
      }
    } else if (pin?.trim()) {
      const candidates = await dbAll(
        `SELECT * FROM happy_staff WHERE tenant_id = ? AND is_active = 1 AND pin_hash IS NOT NULL`,
        settings.tenant_id,
      );
      for (const row of candidates) {
        if (await bcrypt.compare(String(pin), row.pin_hash)) { staff = row; break; }
      }
    }

    if (!staff) return err(res, 'Invalid credentials', 401);

    const token = jwt.sign(
      {
        staffId:   staff.id,
        tenantId:  staff.tenant_id,
        venueType: settings.venue_type,
        type:      'happy_staff',
      },
      getJwtSecret(),
      { expiresIn: '16h' },
    );

    ok(res, {
      token,
      staff: { id: staff.id, name: staff.name, role: staff.role },
      settings: {
        tenant_id:   settings.tenant_id,
        venue_type:  settings.venue_type,
        venue_name:  settings.venue_name,
      },
    });
  } catch (e: any) { err(res, e.message, 500); }
});

// Stateless JWT — nothing to invalidate server-side in Phase 1.
happyAuthRouter.post('/restaurant/auth/logout', async (_req: Request, res: Response) => {
  ok(res, { loggedOut: true });
});
