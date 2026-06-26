import crypto from 'crypto';
import type { FiscalConfig, FiscalMiddleware, FiscalResult, FiscalOrderItem } from './types.js';

const NEXIA_TEST_URL = 'https://efiskalizimi-app-test.tatime.gov.al';
const NEXIA_PROD_URL = 'https://efiskalizimi-app.tatime.gov.al';

export const nexiaMiddleware: FiscalMiddleware = {
  name:        'nexia',
  displayName: 'Nexia',

  async getToken(config: FiscalConfig): Promise<string> {
    const res = await fetch(`${config.api_url}/api/v1/auth`, {
      method:  'POST',
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
  },

  async registerTCR(config: FiscalConfig): Promise<FiscalResult> {
    const token = await this.getToken(config);
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`${config.api_url}/api/v1/register-tcr`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({
        InternalId: crypto.randomUUID(),
        Header: { UUID: crypto.randomUUID(), SendDateTime: new Date().toISOString(), SubseqDelivType: null },
        TCR: {
          IssuerNUIS:     config.nuis,
          BusinUnitCode:  config.busun_code,
          TcrIntId:       '1',
          SoftCode:       config.soft_code,
          MaintainerCode: config.tcr_code,
          ValidFrom:      today,
          ValidTo:        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          Type:           'REGULAR',
        },
      }),
    });
    const data: any = await res.json();
    return { success: data.Status === true, error: data.Error?.ErrorText, raw: data };
  },

  async registerCashDeposit(
    config:    FiscalConfig,
    amount:    number,
    operation: 'INITIAL' | 'DEPOSIT' | 'WITHDRAW',
  ): Promise<FiscalResult> {
    const token = await this.getToken(config);
    const now   = new Date().toISOString();
    const res = await fetch(`${config.api_url}/api/v1/register-cash-deposit`, {
      method:  'POST',
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
    const data: any = await res.json();
    return { success: data.Status === true, error: data.Error?.ErrorText, raw: data };
  },

  async fiscalizeInvoice(
    config:      FiscalConfig,
    items:       FiscalOrderItem[],
    paymentType: 'BANKNOTE' | 'CARD' | 'OTHER',
    _totalAmount: number,
  ): Promise<FiscalResult> {
    const token = await this.getToken(config);
    const today = new Date().toISOString().split('T')[0];

    const res = await fetch(`${config.api_url}/api/v2/register-invoice`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({
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
        Items: items.map(i => ({
          Name:     i.name,
          Code:     i.code,
          Unit:     i.unit,
          Quantity: i.quantity,
          VatRate:  i.vat_rate,
          Price:    i.price,
        })),
        PayMethods: [{ Type: paymentType }],
      }),
    });
    const data: any = await res.json();

    if (data.Status === true && data.Invoice) {
      return {
        success:    true,
        iic:        data.Invoice.IIC,
        fic:        data.Invoice.FIC,
        inv_num:    data.Invoice.InvNum,
        verify_url: data.VerifyInvoice,
        raw:        data,
      };
    }
    return {
      success: false,
      error:   data.Error?.ErrorText || 'Nexia fiscalization failed',
      raw:     data,
    };
  },

  async correctInvoice(config: FiscalConfig, fic: string): Promise<FiscalResult> {
    const token = await this.getToken(config);
    const res = await fetch(`${config.api_url}/api/v2/correct-invoice`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ FIC: fic }),
    });
    const data: any = await res.json();
    return { success: data.Status === true, error: data.Error?.ErrorText, raw: data };
  },
};

export function getNexiaUrl(environment: 'test' | 'production'): string {
  return environment === 'production' ? NEXIA_PROD_URL : NEXIA_TEST_URL;
}
