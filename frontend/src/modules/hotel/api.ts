/// <reference types="vite/client" />
import type { GuestStay, HotelRequest, FaqEntry, HotelConfig, Department, Conversation, BlockedNumber } from './types';

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

export const api = {
  // Requests
  getRequests: (status = 'pending') =>
    req<HotelRequest[]>(`/hotel/requests?status=${status}`),
  updateRequestStatus: (id: string, status: string) =>
    req(`/hotel/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // Guests
  getGuests: () => req<GuestStay[]>('/hotel/guests'),
  checkIn: (data: { room_number: string; guest_name: string; guest_phone: string; check_in: string; check_out: string }) =>
    req<GuestStay>('/hotel/guests/checkin', { method: 'POST', body: JSON.stringify(data) }),
  checkOut: (id: string) =>
    req(`/hotel/guests/${id}/checkout`, { method: 'PATCH' }),

  // Config
  getConfig: () => req<HotelConfig>('/hotel/config'),
  updateConfig: (data: Partial<HotelConfig>) =>
    req('/hotel/config', { method: 'PUT', body: JSON.stringify(data) }),

  // FAQ
  getFaq: () => req<FaqEntry[]>('/hotel/faq'),
  createFaq: (data: { question: string; answer: string; category: string }) =>
    req<FaqEntry>('/hotel/faq', { method: 'POST', body: JSON.stringify(data) }),
  deleteFaq: (id: string) =>
    req(`/hotel/faq/${id}`, { method: 'DELETE' }),

  // Departments
  getDepartments: () => req<Department[]>('/hotel/departments'),
  createDepartment: (data: { name: string; whatsapp: string; request_types: string[] }) =>
    req<Department>('/hotel/departments', { method: 'POST', body: JSON.stringify(data) }),
  updateDepartment: (id: string, data: { name: string; whatsapp: string; request_types: string[]; is_active?: boolean }) =>
    req(`/hotel/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id: string) =>
    req(`/hotel/departments/${id}`, { method: 'DELETE' }),

  // Conversations
  getConversations: () => req<Conversation[]>('/hotel/conversations'),
  getConversation: (phone: string) =>
    req<Conversation>(`/hotel/conversations/${encodeURIComponent(phone)}`),
  replyToGuest: (phone: string, message: string) =>
    req(`/hotel/conversations/${encodeURIComponent(phone)}/reply`, {
      method: 'POST', body: JSON.stringify({ message }),
    }),

  // Blocked numbers
  getBlocked: () => req<BlockedNumber[]>('/hotel/blocked'),
  addBlocked: (data: { phone: string; label?: string }) =>
    req('/hotel/blocked', { method: 'POST', body: JSON.stringify(data) }),
  removeBlocked: (phone: string) =>
    req(`/hotel/blocked/${encodeURIComponent(phone)}`, { method: 'DELETE' }),
};
