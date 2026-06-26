export interface FiscalConfig {
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

export interface FiscalResult {
  success:     boolean;
  iic?:        string;
  fic?:        string;
  inv_num?:    string;
  verify_url?: string;
  error?:      string;
  raw?:        any;
}

export interface FiscalOrderItem {
  name:      string;
  code:      string;
  unit:      string;
  quantity:  number;
  vat_rate:  string;
  price:     number;
}

export interface FiscalMiddleware {
  name:        string;
  displayName: string;

  getToken(config: FiscalConfig): Promise<string>;

  registerTCR(config: FiscalConfig): Promise<FiscalResult>;

  registerCashDeposit(
    config:    FiscalConfig,
    amount:    number,
    operation: 'INITIAL' | 'DEPOSIT' | 'WITHDRAW',
  ): Promise<FiscalResult>;

  fiscalizeInvoice(
    config:      FiscalConfig,
    items:       FiscalOrderItem[],
    paymentType: 'BANKNOTE' | 'CARD' | 'OTHER',
    totalAmount: number,
  ): Promise<FiscalResult>;

  correctInvoice(
    config: FiscalConfig,
    fic:    string,
  ): Promise<FiscalResult>;
}
