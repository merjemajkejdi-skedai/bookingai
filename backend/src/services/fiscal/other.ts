import type { FiscalConfig, FiscalMiddleware, FiscalResult, FiscalOrderItem } from './types.js';

const NOT_IMPLEMENTED: FiscalResult = { success: false, error: 'Other middleware not yet implemented. Specs pending.' };

export const otherMiddleware: FiscalMiddleware = {
  name:        'other',
  displayName: 'Other',

  async getToken(_config: FiscalConfig): Promise<string> {
    throw new Error('Other middleware not yet implemented. Specs pending.');
  },

  async registerTCR(_config: FiscalConfig): Promise<FiscalResult> {
    return NOT_IMPLEMENTED;
  },

  async registerCashDeposit(_config: FiscalConfig, _amount: number, _operation: 'INITIAL' | 'DEPOSIT' | 'WITHDRAW'): Promise<FiscalResult> {
    return NOT_IMPLEMENTED;
  },

  async fiscalizeInvoice(_config: FiscalConfig, _items: FiscalOrderItem[], _paymentType: 'BANKNOTE' | 'CARD' | 'OTHER', _totalAmount: number): Promise<FiscalResult> {
    return NOT_IMPLEMENTED;
  },

  async correctInvoice(_config: FiscalConfig, _fic: string): Promise<FiscalResult> {
    return NOT_IMPLEMENTED;
  },
};

export function getOtherUrl(environment: 'test' | 'production'): string {
  return environment === 'production'
    ? 'https://api.other-fiscal.al'
    : 'https://test.other-fiscal.al';
}
