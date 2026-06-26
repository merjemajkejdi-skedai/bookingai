import { isPg, query, queryOne, queryRun, prepare } from '../db/database.js';
import { getMiddleware, getMiddlewareUrl } from './fiscal/registry.js';
import type { FiscalConfig, FiscalOrderItem } from './fiscal/types.js';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

// ── LOAD CONFIG ────────────────────────────────────────────────────────────────

async function loadFiscalConfig(
  tenantId:     string,
  operatorCode: string,
): Promise<{ config: FiscalConfig; middleware: string }> {
  const cfg = await dbGet(
    `SELECT fiscal_middleware, fiscal_environment,
            fiscal_api_url, fiscal_username, fiscal_password, fiscal_nuis,
            fiscal_tcr_code, fiscal_busun_code, fiscal_soft_code, fiscal_default_client
     FROM shop_config WHERE tenant_id = ?`,
    tenantId,
  );
  if (!cfg) throw new Error('Shop fiscal config not found');
  if (!cfg.fiscal_username || !cfg.fiscal_nuis) throw new Error('Fiscal credentials not configured');

  const middleware = cfg.fiscal_middleware || 'nexia';
  const baseUrl    = getMiddlewareUrl(middleware, cfg.fiscal_environment || 'test');

  const config: FiscalConfig = {
    api_url:        cfg.fiscal_api_url || baseUrl,
    username:       cfg.fiscal_username,
    password:       cfg.fiscal_password,
    nuis:           cfg.fiscal_nuis,
    tcr_code:       cfg.fiscal_tcr_code,
    busun_code:     cfg.fiscal_busun_code,
    soft_code:      cfg.fiscal_soft_code,
    operator_code:  operatorCode,
    default_client: cfg.fiscal_default_client || 'Klient i Pergjithshem',
  };

  return { config, middleware };
}

// ── PUBLIC FUNCTIONS ───────────────────────────────────────────────────────────

export async function registerTCR(tenantId: string): Promise<any> {
  const { config, middleware } = await loadFiscalConfig(tenantId, 'admin');
  const mw = getMiddleware(middleware);
  return await mw.registerTCR(config);
}

export async function registerCashDeposit(
  tenantId:  string,
  amount:    number,
  operation: 'INITIAL' | 'DEPOSIT' | 'WITHDRAW' = 'INITIAL',
): Promise<any> {
  const { config, middleware } = await loadFiscalConfig(tenantId, 'admin');
  const mw = getMiddleware(middleware);
  return await mw.registerCashDeposit(config, amount, operation);
}

export async function fiscalizeOrder(
  orderId:      string,
  tenantId:     string,
  operatorCode: string,
  paymentType:  'BANKNOTE' | 'CARD' | 'OTHER' = 'BANKNOTE',
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { config, middleware } = await loadFiscalConfig(tenantId, operatorCode);
    const mw = getMiddleware(middleware);

    const order = await dbGet(
      `SELECT * FROM shop_orders WHERE id = ? AND tenant_id = ?`,
      orderId, tenantId,
    );
    if (!order) throw new Error('Order not found');

    const items = await dbAll(
      `SELECT * FROM shop_order_items WHERE order_id = ? AND tenant_id = ?`,
      orderId, tenantId,
    );

    const itemIds = items.map((i: any) => i.item_id).filter(Boolean);
    let menuMap = new Map<string, any>();
    if (itemIds.length > 0) {
      const ph = itemIds.map(() => '?').join(',');
      const menuItems = await dbAll(
        `SELECT id, vat_rate, item_code, unit FROM shop_menu_items WHERE id IN (${ph})`,
        ...itemIds,
      );
      menuMap = new Map(menuItems.map((i: any) => [i.id, i]));
    }

    const fiscalItems: FiscalOrderItem[] = items.map((item: any) => {
      const menu = menuMap.get(item.item_id) || {};
      return {
        name:      item.item_name,
        code:      menu.item_code || '000000',
        unit:      menu.unit      || 'XPP',
        quantity:  parseFloat(item.quantity),
        vat_rate:  menu.vat_rate  || 'VAT_20',
        price:     parseFloat(item.item_price),
      };
    });

    const result = await mw.fiscalizeInvoice(config, fiscalItems, paymentType, parseFloat(order.total_price));

    if (result.success) {
      await dbRun(
        `UPDATE shop_orders SET
           fiscal_status = 'fiscalized',
           fiscal_iic = ?,
           fiscal_fic = ?,
           fiscal_inv_num = ?,
           fiscal_verify_url = ?,
           fiscal_error = NULL,
           payment_type = ?,
           is_paid = 1,
           paid_at = CURRENT_TIMESTAMP,
           status = 'done',
           done_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        result.iic, result.fic, result.inv_num, result.verify_url, paymentType, orderId,
      );
      console.log(`[Fiscal:${middleware}] ✅ Order ${orderId} fiscalized: ${result.inv_num}`);
      return { success: true, data: result.raw };
    } else {
      await dbRun(
        `UPDATE shop_orders SET
           fiscal_status = 'failed',
           fiscal_error = ?,
           payment_type = ?,
           is_paid = 1,
           paid_at = CURRENT_TIMESTAMP,
           status = 'done',
           done_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        result.error || 'Unknown fiscal error', paymentType, orderId,
      );
      console.error(`[Fiscal:${middleware}] ❌ Order ${orderId} failed:`, result.error);
      return { success: false, error: result.error, data: result.raw };
    }
  } catch (err: any) {
    await dbRun(
      `UPDATE shop_orders SET
         fiscal_status = 'failed',
         fiscal_error = ?,
         is_paid = 1,
         paid_at = CURRENT_TIMESTAMP,
         status = 'done',
         done_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      err.message, orderId,
    );
    console.error('[Fiscal] ❌ Exception:', err.message);
    return { success: false, error: err.message };
  }
}

export async function correctInvoice(
  orderId:      string,
  tenantId:     string,
  operatorCode: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const order = await dbGet(
      `SELECT fiscal_fic, fiscal_status FROM shop_orders WHERE id = ? AND tenant_id = ?`,
      orderId, tenantId,
    );
    if (!order?.fiscal_fic) return { success: false, error: 'No FIC found — order was not fiscalized' };
    if (order.fiscal_status === 'corrected') return { success: false, error: 'Invoice already corrected' };

    const { config, middleware } = await loadFiscalConfig(tenantId, operatorCode);
    const mw = getMiddleware(middleware);

    const result = await mw.correctInvoice(config, order.fiscal_fic);

    if (result.success) {
      await dbRun(
        `UPDATE shop_orders SET fiscal_status = 'corrected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        orderId,
      );
      return { success: true, data: result.raw };
    } else {
      return { success: false, error: result.error || 'Correction failed' };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
