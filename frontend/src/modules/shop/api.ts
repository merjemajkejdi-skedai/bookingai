import type { ShopConfig, ShopCategory, ShopItem, ShopOrder, ShopFaq, ShopConversation } from './types';

const BASE = (import.meta.env.VITE_API_URL as string) || '';

// When a super_admin views a specific shop, set this so all requests carry ?tenantId=X
let _viewTenantId: string | null = null;
export function setViewTenantId(id: string | null) { _viewTenantId = id; }

// Prefer shopUserToken (sub-user JWT) over the main tenant token.
function token() {
  const shopToken = localStorage.getItem('shopUserToken');
  if (shopToken) {
    try {
      const payload = JSON.parse(atob(shopToken.split('.')[1]));
      if (payload.type === 'shop_user') return shopToken;
    } catch { /* fall through */ }
  }
  return localStorage.getItem('bookingai_token') || '';
}

async function rawReq(path: string, opts: RequestInit = {}): Promise<any> {
  const isForm = opts.body instanceof FormData;
  let url = `${BASE}${path}`;
  if (_viewTenantId) {
    url += (url.includes('?') ? '&' : '?') + `tenantId=${encodeURIComponent(_viewTenantId)}`;
  }
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(!isForm ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token()}`,
      ...(opts.headers as object ?? {}),
    },
  });
  try { return await res.json(); } catch { return { success: false, error: `Server error ${res.status}` }; }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  let url = `${BASE}${path}`;
  if (_viewTenantId) {
    url += (url.includes('?') ? '&' : '?') + `tenantId=${encodeURIComponent(_viewTenantId)}`;
  }
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(!isForm ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token()}`,
      ...(opts.headers as object ?? {}),
    },
  });

  let json: any;
  try { json = JSON.parse(await res.text()); } catch { throw new Error(`Server error ${res.status}`); }
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data as T;
}

export const shopApi = {
  getConfig:    ()             => req<ShopConfig>('/shop/config'),
  putConfig:    (d: Partial<ShopConfig>) => req<void>('/shop/config', { method: 'PUT', body: JSON.stringify(d) }),

  getCategories:    ()                              => req<ShopCategory[]>('/shop/categories'),
  createCategory:   (d: Partial<ShopCategory>)     => req<{ id: string }>('/shop/categories', { method: 'POST', body: JSON.stringify(d) }),
  updateCategory:   (id: string, d: Partial<ShopCategory>) => req<void>(`/shop/categories/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteCategory:   (id: string)                   => req<void>(`/shop/categories/${id}`, { method: 'DELETE' }),

  getItems:       (catId?: string) => req<ShopItem[]>(`/shop/items${catId ? `?category_id=${catId}` : ''}`),
  createItem:     (form: FormData) => req<{ id: string; photo_url?: string }>('/shop/items', { method: 'POST', body: form }),
  updateItem:     (id: string, form: FormData) => req<{ photo_url?: string }>(`/shop/items/${id}`, { method: 'PUT', body: form }),
  deleteItem:     (id: string)     => req<void>(`/shop/items/${id}`, { method: 'DELETE' }),

  getOrders:          (status?: string, date?: string) => {
    const qs = new URLSearchParams();
    if (status && status !== 'all') qs.set('status', status);
    if (date) qs.set('date', date);
    const q = qs.toString();
    return req<ShopOrder[]>(`/shop/orders${q ? `?${q}` : ''}`);
  },
  updateOrderStatus:  (id: string, status: string) => req<void>(`/shop/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateOrderPaid:    (id: string, isPaid: boolean) => req<void>(`/shop/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ is_paid: isPaid }) }),
  createManualOrder:  (data: { items: { item_id: string; quantity: number }[]; pickup_name?: string; guest_phone?: string; table_name?: string; notes?: string }) =>
    req<{ order_id: string; order_number: number; total: number }>('/shop/orders/manual', { method: 'POST', body: JSON.stringify(data) }),

  getFaq:       ()                        => req<ShopFaq[]>('/shop/faq'),
  createFaq:    (d: Partial<ShopFaq>)    => req<{ id: string }>('/shop/faq', { method: 'POST', body: JSON.stringify(d) }),
  updateFaq:    (id: string, d: Partial<ShopFaq>) => req<void>(`/shop/faq/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteFaq:    (id: string)             => req<void>(`/shop/faq/${id}`, { method: 'DELETE' }),

  getConversations:   ()             => req<ShopConversation[]>('/shop/conversations'),
  getConversation:    (phone: string) => req<ShopConversation>(`/shop/conversations/${encodeURIComponent(phone)}`),
  clearConversation:  (phone: string) => req<void>(`/shop/conversations/${encodeURIComponent(phone)}`, { method: 'DELETE' }),

  getReportsSummary:   (period: string) => req<any>(`/shop/reports/summary?period=${period}`),
  getReportsBreakdown: (period: string) => req<any>(`/shop/reports/breakdown?period=${period}`),

  // Auth
  shopLogin: (username: string, password: string, tenantId: string) =>
    req<{ token: string; user: { id: string; username: string; name: string; surname: string; role: string; operator_id?: string } }>(
      '/shop/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password, tenant_id: tenantId }) },
    ),
  getShopMe: () => req<any>('/shop/auth/me'),

  // User management (admin only)
  getUsers:   ()                    => req<any[]>('/shop/users'),
  createUser: (data: any)           => req<any>('/shop/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => req<void>(`/shop/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id: string)          => req<void>(`/shop/users/${id}`, { method: 'DELETE' }),

  // Audit log (admin only)
  getAuditLog: () => req<any[]>('/shop/audit-log'),

  // Tables CRUD (admin only)
  getTables:        ()                        => req<any[]>('/shop/tables'),
  createTable:      (data: any)               => req<any>('/shop/tables', { method: 'POST', body: JSON.stringify(data) }),
  bulkCreateTables: (count: number, prefix: string) =>
    req<any[]>('/shop/tables/bulk', { method: 'POST', body: JSON.stringify({ count, prefix }) }),
  updateTable:      (id: string, data: any)   => req<void>(`/shop/tables/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTable:      (id: string)              => req<void>(`/shop/tables/${id}`, { method: 'DELETE' }),

  // Fiscalization (rawReq — returns full JSON including success flag)
  payOrder:            (orderId: string, paymentType: 'BANKNOTE' | 'CARD') =>
    rawReq(`/shop/orders/${orderId}/pay`, { method: 'POST', body: JSON.stringify({ payment_type: paymentType }) }),
  retryFiscal:         (orderId: string) =>
    rawReq(`/shop/orders/${orderId}/retry-fiscal`, { method: 'POST' }),
  correctInvoice:      (orderId: string) =>
    rawReq(`/shop/orders/${orderId}/correct`, { method: 'POST' }),
  registerCashDeposit: (amount?: number) =>
    rawReq('/shop/fiscal/cash-deposit', { method: 'POST', body: JSON.stringify({ amount }) }),
  getReceipt:          (orderId: string) =>
    req<any>(`/shop/orders/${orderId}/receipt`),

  // Inventory (admin only)
  getInvCategories:    ()                       => req<any[]>('/shop/inventory/categories'),
  createInvCategory:   (d: any)                 => req<any>('/shop/inventory/categories', { method: 'POST', body: JSON.stringify(d) }),
  updateInvCategory:   (id: string, d: any)     => req<void>(`/shop/inventory/categories/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteInvCategory:   (id: string)             => req<void>(`/shop/inventory/categories/${id}`, { method: 'DELETE' }),

  getInvSuppliers:     ()                       => req<any[]>('/shop/inventory/suppliers'),
  createInvSupplier:   (d: any)                 => req<any>('/shop/inventory/suppliers', { method: 'POST', body: JSON.stringify(d) }),
  updateInvSupplier:   (id: string, d: any)     => req<void>(`/shop/inventory/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteInvSupplier:   (id: string)             => req<void>(`/shop/inventory/suppliers/${id}`, { method: 'DELETE' }),

  getIngredients:      ()                       => req<any[]>('/shop/inventory/ingredients'),
  createIngredient:    (d: any)                 => req<any>('/shop/inventory/ingredients', { method: 'POST', body: JSON.stringify(d) }),
  updateIngredient:    (id: string, d: any)     => req<void>(`/shop/inventory/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteIngredient:    (id: string)             => req<void>(`/shop/inventory/ingredients/${id}`, { method: 'DELETE' }),

  getRecipes:          ()                       => req<any[]>('/shop/inventory/recipes'),
  getRecipe:           (menuItemId: string)     => req<any>(`/shop/inventory/recipes/${menuItemId}`),
  saveRecipe:          (menuItemId: string, d: any) => req<any>(`/shop/inventory/recipes/${menuItemId}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteRecipe:        (menuItemId: string)     => req<void>(`/shop/inventory/recipes/${menuItemId}`, { method: 'DELETE' }),

  getDeliveries:       ()                       => req<any[]>('/shop/inventory/deliveries'),
  createDelivery:      (d: any)                 => req<any>('/shop/inventory/deliveries', { method: 'POST', body: JSON.stringify(d) }),
  deleteDelivery:      (id: string)             => req<void>(`/shop/inventory/deliveries/${id}`, { method: 'DELETE' }),

  getWaste:            ()                       => req<any[]>('/shop/inventory/waste'),
  logWaste:            (d: any)                 => req<any>('/shop/inventory/waste', { method: 'POST', body: JSON.stringify(d) }),

  getStockLevels:      ()                       => req<any[]>('/shop/inventory/reports/stock-levels'),
  getConsumption:      (days?: number)          => req<any[]>(`/shop/inventory/reports/consumption?days=${days ?? 30}`),
  getWasteReport:      (days?: number)          => req<any[]>(`/shop/inventory/reports/waste?days=${days ?? 30}`),
  getStockValue:       ()                       => req<any>('/shop/inventory/reports/stock-value'),

  // Logo upload (admin only)
  uploadLogo: (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    return req<{ logo_url: string }>('/shop/config/logo', { method: 'POST', body: fd });
  },
  deleteLogo: () => req<void>('/shop/config/logo', { method: 'DELETE' }),
};

// Public QR ordering endpoints — no auth, direct fetch
const API_BASE = (import.meta.env.VITE_API_URL as string) || '';
export const shopPublicApi = {
  getShop:    (slug: string) =>
    fetch(`${API_BASE}/shop/public/${slug}`).then(r => r.json()),
  getTable:   (slug: string, tableId: string) =>
    fetch(`${API_BASE}/shop/public/${slug}/table/${tableId}`).then(r => r.json()),
  placeOrder: (slug: string, data: any) =>
    fetch(`${API_BASE}/shop/public/${slug}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => r.json()),
};
