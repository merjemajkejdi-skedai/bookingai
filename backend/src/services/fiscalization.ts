import { isPg, query, queryOne, queryRun, prepare } from '../db/database.js';
import crypto from 'crypto';

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const PROD_URL = 'https://efiskalizimi-app.tatime.gov.al';
const TEST_URL = 'https://efiskalizimi-app-test.tatime.gov.al';

interface FiscalConfig {
  api_url:        string;
  username:       string;
  password:       string;
  nuis:           string;
  tcr_code:       string;
  busun_code:     string;
  soft_code:      string;
  operator_code:  string;
  default_client: string;
}

// ── AUTHENTICATION ─────────────────────────────────────────────────────────────

async function getFiscalToken(config: FiscalConfig): Promise<string> {
  const res = await fetch(`${config.api_url}/api/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.username,
      nuis:     config.nuis,
      password: config.password,
    }),
  });
  if (!res.ok) throw new Error(`Fiscal auth failed: ${res.status}`);
  const data: any = await res.json();
  if (!data.authorization) throw new Error('No auth token received from fiscal API');
  return data.authorization;
}

// ── LOAD FISCAL CONFIG ─────────────────────────────────────────────────────────

async function loadFiscalConfig(tenantId: string, operatorCode: string): Promise<FiscalConfig> {
  const cfg = await dbGet(
    `SELECT fiscal_api_url, fiscal_username, fiscal_password,
            fiscal_nuis, fiscal_tcr_code, fiscal_busun_code,
            fiscal_soft_code, fiscal_default_client, fiscal_environment
     FROM shop_config WHERE tenant_id = ?`,
    tenantId,
  );
  if (!cfg) throw new Error('Shop fiscal config not found');
  if (!cfg.fiscal_username || !cfg.fiscal_nuis) throw new Error('Fiscal credentials not configured');

  const baseUrl = cfg.fiscal_environment === 'production' ? PROD_URL : TEST_URL;

  return {
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
}

// ── REGISTER TCR ───────────────────────────────────────────────────────────────

export async function registerTCR(tenantId: string): Promise<any> {
  const config = await loadFiscalConfig(tenantId, 'admin');
  const token  = await getFiscalToken(config);
  const today  = new Date().toISOString().split('T')[0];

  const res = await fetch(`${config.api_url}/api/v1/register-tcr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      InternalId: crypto.randomUUID(),
      Header: { UUID: crypto.randomUUID(), SendDateTime: new Date().toISOString(), SubseqDelivType: null },
      TCR: {
        IssuerNUIS:      config.nuis,
        BusinUnitCode:   config.busun_code,
        TcrIntId:        '1',
        SoftCode:        config.soft_code,
        MaintainerCode:  config.tcr_code,
        ValidFrom:       today,
        ValidTo:         new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        Type:            'REGULAR',
      },
    }),
  });
  return await res.json() as any;
}

// ── REGISTER CASH DEPOSIT ──────────────────────────────────────────────────────

export async function registerCashDeposit(
  tenantId:  string,
  amount:    number,
  operation: 'INITIAL' | 'DEPOSIT' | 'WITHDRAW' = 'INITIAL',
): Promise<any> {
  const config = await loadFiscalConfig(tenantId, 'admin');
  const token  = await getFiscalToken(config);
  const now    = new Date().toISOString();

  const res = await fetch(`${config.api_url}/api/v1/register-cash-deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      InternalId: crypto.randomUUID(),
      Header: { UUID: crypto.randomUUID(), SendDateTime: now, SubseqDelivType: null },
      CashDeposit: {
        ChangeDateTime: now,
        Operation:      operation,
        CashAmt:        amount.toFixed(2),
        TCRCode:        config.tcr_code,
        IssuerNUIS:     config.nuis,
      },
    }),
  });
  return await res.json() as any;
}

// ── FISCALIZE INVOICE ──────────────────────────────────────────────────────────

export async function fiscalizeOrder(
  orderId:      string,
  tenantId:     string,
  operatorCode: string,
  paymentType:  'BANKNOTE' | 'CARD' | 'OTHER' = 'BANKNOTE',
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const config = await loadFiscalConfig(tenantId, operatorCode);
    const token  = await getFiscalToken(config);

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

    const today = new Date().toISOString().split('T')[0];

    const invoiceItems = items.map((item: any) => {
      const menu = menuMap.get(item.item_id) || {};
      return {
        Name:     item.item_name,
        Code:     menu.item_code || '000000',
        Unit:     menu.unit || 'XPP',
        Quantity: parseFloat(item.quantity),
        VatRate:  menu.vat_rate || 'VAT_20',
        Price:    parseFloat(item.item_price),
      };
    });

    const invoiceBody = {
      InternalId: crypto.randomUUID(),
      TypeOfInv:  'CASH',
      SupplyDateOrPeriod: { Start: today, End: today },
      Customer: {
        IDType:  'NUIS',
        IDNum:   '0000000000',
        Name:    config.default_client,
        Address: 'Tirane',
        Town:    'Tirane',
        Country: 'ALB',
      },
      Items:      invoiceItems,
      PayMethods: [{ Type: paymentType }],
    };

    const res = await fetch(`${config.api_url}/api/v2/register-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify(invoiceBody),
    });
    const result: any = await res.json();

    if (result.Status === true && result.Invoice) {
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
        result.Invoice.IIC, result.Invoice.FIC, result.Invoice.InvNum,
        result.VerifyInvoice, paymentType, orderId,
      );
      console.log(`[Fiscal] ✅ Order ${orderId} fiscalized: ${result.Invoice.InvNum}`);
      return { success: true, data: result };
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
        result.Error?.ErrorText || 'Unknown fiscal error', paymentType, orderId,
      );
      console.error(`[Fiscal] ❌ Order ${orderId} fiscal failed:`, result.Error);
      return { success: false, error: result.Error?.ErrorText || 'Fiscalization failed', data: result };
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

// ── CORRECT INVOICE ────────────────────────────────────────────────────────────

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

    const config = await loadFiscalConfig(tenantId, operatorCode);
    const token  = await getFiscalToken(config);

    const res = await fetch(`${config.api_url}/api/v2/correct-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ FIC: order.fiscal_fic }),
    });
    const result: any = await res.json();

    if (result.Status === true) {
      await dbRun(
        `UPDATE shop_orders SET fiscal_status = 'corrected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        orderId,
      );
      return { success: true, data: result };
    } else {
      return { success: false, error: result.Error?.ErrorText || 'Correction failed' };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
