import { Router, Request, Response } from 'express';
import { requireHappyAuth, requireHappyRole, HappyUser } from '../../middleware/happyAuth.js';
import { dbGet, dbRun, ok, err, boolOut } from './shared.js';

export const happySettingsRouter = Router();

const BOOL_FIELDS = [
  'counter_service_enabled', 'send_by_course', 'allow_item_void_after_send',
  'void_requires_manager_approval', 'void_requires_reason', 'allow_split_bill',
  'allow_merge_tables', 'kitchen_display_enabled', 'bar_display_enabled',
  'printer_enabled', 'kitchen_course_alert', 'kitchen_void_alert',
  'fiscal_receipt_on_payment', 'fiscal_receipt_on_bill_print',
  'allow_manual_offline_payment', 'allow_room_charge', 'menu_time_based',
  'loyalty_enabled', 'loyalty_earn_and_redeem_same_tx', 'pms_enabled',
  'pms_verify_room_on_charge', 'shift_report_enabled', 'whatsapp_enabled',
  'ai_enabled',
];

function serialize(row: any) {
  const out: Record<string, unknown> = { ...row };
  for (const f of BOOL_FIELDS) if (f in out) out[f] = boolOut(out[f]);
  return out;
}

happySettingsRouter.get('/restaurant/settings', requireHappyAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const row = await dbGet(`SELECT * FROM happy_settings WHERE tenant_id = ?`, tenantId);
    if (!row) return err(res, 'Settings not found', 404);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});

happySettingsRouter.put('/restaurant/settings', requireHappyAuth, requireHappyRole('admin'), async (req: Request, res: Response) => {
  const { tenantId } = req.happyUser as HappyUser;
  try {
    const existing = await dbGet(`SELECT * FROM happy_settings WHERE tenant_id = ?`, tenantId);
    if (!existing) return err(res, 'Settings not found', 404);

    const b = req.body ?? {};
    // happy_bar: send_by_course and kitchen_display_enabled are hard-pinned off,
    // regardless of what's in the request body.
    const isBar = existing.venue_type === 'happy_bar';

    const next = {
      venue_name:                     b.venue_name ?? existing.venue_name,
      currency:                       b.currency ?? existing.currency,
      timezone:                       b.timezone ?? existing.timezone,
      table_numbering_type:           b.table_numbering_type ?? existing.table_numbering_type,
      max_tables:                     b.max_tables ?? existing.max_tables,
      counter_service_enabled:        b.counter_service_enabled ?? boolOut(existing.counter_service_enabled),
      counter_ticket_reset:           b.counter_ticket_reset ?? existing.counter_ticket_reset,
      send_by_course:                 isBar ? false : (b.send_by_course ?? boolOut(existing.send_by_course)),
      allow_item_void_after_send:     b.allow_item_void_after_send ?? boolOut(existing.allow_item_void_after_send),
      void_requires_manager_approval: b.void_requires_manager_approval ?? boolOut(existing.void_requires_manager_approval),
      void_requires_reason:           b.void_requires_reason ?? boolOut(existing.void_requires_reason),
      allow_split_bill:               b.allow_split_bill ?? boolOut(existing.allow_split_bill),
      split_mode:                     b.split_mode ?? existing.split_mode,
      allow_merge_tables:             b.allow_merge_tables ?? boolOut(existing.allow_merge_tables),
      kitchen_display_enabled:        isBar ? false : (b.kitchen_display_enabled ?? boolOut(existing.kitchen_display_enabled)),
      bar_display_enabled:            b.bar_display_enabled ?? boolOut(existing.bar_display_enabled),
      default_item_destination:       b.default_item_destination ?? existing.default_item_destination,
      printer_enabled:                b.printer_enabled ?? boolOut(existing.printer_enabled),
      printer_type:                   b.printer_type ?? existing.printer_type,
      printer_ip:                     b.printer_ip ?? existing.printer_ip,
      kitchen_course_alert:           b.kitchen_course_alert ?? boolOut(existing.kitchen_course_alert),
      kitchen_void_alert:             b.kitchen_void_alert ?? boolOut(existing.kitchen_void_alert),
      waiter_login_method:            b.waiter_login_method ?? existing.waiter_login_method,
      menu_time_based:                b.menu_time_based ?? boolOut(existing.menu_time_based),
      whatsapp_enabled:               b.whatsapp_enabled ?? boolOut(existing.whatsapp_enabled),
      ai_enabled:                     b.ai_enabled ?? boolOut(existing.ai_enabled),
    };

    await dbRun(
      `UPDATE happy_settings SET
        venue_name=?, currency=?, timezone=?, table_numbering_type=?, max_tables=?,
        counter_service_enabled=?, counter_ticket_reset=?, send_by_course=?,
        allow_item_void_after_send=?, void_requires_manager_approval=?, void_requires_reason=?,
        allow_split_bill=?, split_mode=?, allow_merge_tables=?,
        kitchen_display_enabled=?, bar_display_enabled=?, default_item_destination=?,
        printer_enabled=?, printer_type=?, printer_ip=?,
        kitchen_course_alert=?, kitchen_void_alert=?, waiter_login_method=?,
        menu_time_based=?, whatsapp_enabled=?, ai_enabled=?, updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=?`,
      next.venue_name, next.currency, next.timezone, next.table_numbering_type, next.max_tables,
      next.counter_service_enabled ? 1 : 0, next.counter_ticket_reset, next.send_by_course ? 1 : 0,
      next.allow_item_void_after_send ? 1 : 0, next.void_requires_manager_approval ? 1 : 0, next.void_requires_reason ? 1 : 0,
      next.allow_split_bill ? 1 : 0, next.split_mode, next.allow_merge_tables ? 1 : 0,
      next.kitchen_display_enabled ? 1 : 0, next.bar_display_enabled ? 1 : 0, next.default_item_destination,
      next.printer_enabled ? 1 : 0, next.printer_type, next.printer_ip,
      next.kitchen_course_alert ? 1 : 0, next.kitchen_void_alert ? 1 : 0, next.waiter_login_method,
      next.menu_time_based ? 1 : 0, next.whatsapp_enabled ? 1 : 0, next.ai_enabled ? 1 : 0,
      tenantId,
    );

    const row = await dbGet(`SELECT * FROM happy_settings WHERE tenant_id = ?`, tenantId);
    ok(res, serialize(row));
  } catch (e: any) { err(res, e.message, 500); }
});
