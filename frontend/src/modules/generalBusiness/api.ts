/// <reference types="vite/client" />
import type { GbConfig, GbLocation, GbDepartment, GbFaq, GbDocument, GbMenuItem, GbOrder, GbRequest, GbConversation } from './types';

const BASE = `${import.meta.env.VITE_API_URL || ''}`;

function injectTenantId(path: string): string {
  const raw = localStorage.getItem('bookingai_admin_tenant');
  const user = JSON.parse(localStorage.getItem('bookingai_user') || 'null');
  if (user?.role === 'super_admin' && raw) {
    const { id } = JSON.parse(raw);
    return path + (path.includes('?') ? '&' : '?') + `tenantId=${encodeURIComponent(id)}`;
  }
  return path;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('bookingai_token');
  const { headers: extraHeaders, ...restOpts } = opts ?? {};
  const res = await fetch(`${BASE}${injectTenantId(path)}`, {
    ...restOpts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders ?? {}),
    },
  });
  const text = await res.text();
  if (!text) throw new Error('Empty response from server');
  let json: any;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 100)}`); }
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data as T;
}

export const gbApi = {
  getConfig: () => req<GbConfig | null>('/gb/config'),
  updateConfig: (data: Partial<GbConfig> & { menu_enabled?: boolean }) =>
    req<GbConfig>('/gb/config', { method: 'PUT', body: JSON.stringify(data) }),

  getLocations: () => req<GbLocation[]>('/gb/locations'),
  createLocation: (data: Partial<GbLocation>) =>
    req<GbLocation>('/gb/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: Partial<GbLocation>) =>
    req<GbLocation>('/gb/locations/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id: string) =>
    req<any>('/gb/locations/' + id, { method: 'DELETE' }),

  getDepartments: () => req<GbDepartment[]>('/gb/departments'),
  createDepartment: (data: Partial<GbDepartment>) =>
    req<GbDepartment>('/gb/departments', { method: 'POST', body: JSON.stringify(data) }),
  updateDepartment: (id: string, data: Partial<GbDepartment>) =>
    req<GbDepartment>('/gb/departments/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id: string) =>
    req<any>('/gb/departments/' + id, { method: 'DELETE' }),

  getFaqs: () => req<GbFaq[]>('/gb/faqs'),
  createFaq: (data: { question: string; answer: string }) =>
    req<GbFaq>('/gb/faqs', { method: 'POST', body: JSON.stringify(data) }),
  updateFaq: (id: string, data: Partial<GbFaq>) =>
    req<GbFaq>('/gb/faqs/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFaq: (id: string) =>
    req<any>('/gb/faqs/' + id, { method: 'DELETE' }),

  getDocuments: () => req<GbDocument[]>('/gb/documents'),
  createDocument: (data: { name: string; file_type: string; r2_key: string; file_size_bytes?: number; extracted_text?: string }) =>
    req<GbDocument>('/gb/documents', { method: 'POST', body: JSON.stringify(data) }),
  toggleDocument: (id: string, is_active: boolean) =>
    req<GbDocument>('/gb/documents/' + id, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  deleteDocument: (id: string) =>
    req<any>('/gb/documents/' + id, { method: 'DELETE' }),

  getMenu: () => req<GbMenuItem[]>('/gb/menu'),
  createMenuItem: (data: Partial<GbMenuItem>) =>
    req<GbMenuItem>('/gb/menu', { method: 'POST', body: JSON.stringify(data) }),
  updateMenuItem: (id: string, data: Partial<GbMenuItem>) =>
    req<GbMenuItem>('/gb/menu/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMenuItem: (id: string) =>
    req<any>('/gb/menu/' + id, { method: 'DELETE' }),

  getOrders: () => req<GbOrder[]>('/gb/orders'),
  updateOrder: (id: string, data: { status?: string; notes?: string }) =>
    req<GbOrder>('/gb/orders/' + id, { method: 'PATCH', body: JSON.stringify(data) }),

  getRequests: (status = 'all') => req<GbRequest[]>(`/gb/requests?status=${status}`),
  updateRequest: (id: string, data: { status?: string; staff_notes?: string }) =>
    req<GbRequest>('/gb/requests/' + id, { method: 'PATCH', body: JSON.stringify(data) }),

  getConversations: () => req<GbConversation[]>('/gb/conversations'),
  getConversation: (id: string) => req<GbConversation>('/gb/conversations/' + id),
  sendReply: (id: string, message: string) =>
    req<any>('/gb/conversations/' + id + '/reply', { method: 'POST', body: JSON.stringify({ message }) }),
  takeoverConversation: (id: string, minutes = 60) =>
    req<any>('/gb/conversations/' + id + '/takeover', { method: 'POST', body: JSON.stringify({ minutes }) }),
  resumeConversation: (id: string) =>
    req<any>('/gb/conversations/' + id + '/resume', { method: 'POST' }),
};
