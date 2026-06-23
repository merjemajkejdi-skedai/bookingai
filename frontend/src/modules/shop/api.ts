import type { ShopConfig, ShopCategory, ShopItem, ShopOrder, ShopFaq, ShopConversation } from './types';

const BASE = (import.meta.env.VITE_API_URL as string) || '';

function token() { return localStorage.getItem('bookingai_token') || ''; }

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
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

  getFaq:       ()                        => req<ShopFaq[]>('/shop/faq'),
  createFaq:    (d: Partial<ShopFaq>)    => req<{ id: string }>('/shop/faq', { method: 'POST', body: JSON.stringify(d) }),
  updateFaq:    (id: string, d: Partial<ShopFaq>) => req<void>(`/shop/faq/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteFaq:    (id: string)             => req<void>(`/shop/faq/${id}`, { method: 'DELETE' }),

  getConversations: ()             => req<ShopConversation[]>('/shop/conversations'),
  getConversation:  (phone: string) => req<ShopConversation>(`/shop/conversations/${encodeURIComponent(phone)}`),
};
