/// <reference types="vite/client" />
import type { GuestStay, HotelRequest, FaqEntry, HotelConfig, EmailAccount, EmailConversation, EmailMessage } from './types';

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

  // Email accounts
  getEmailAccounts: () => req<EmailAccount[]>('/hotel/email/accounts'),
  createEmailAccount: (data: Record<string, unknown>) =>
    req<EmailAccount>('/hotel/email/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateEmailAccount: (id: string, data: Record<string, unknown>) =>
    req('/hotel/email/accounts/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmailAccount: (id: string) =>
    req('/hotel/email/accounts/' + id, { method: 'DELETE' }),
  toggleEmailAccount: (id: string, field: 'is_enabled' | 'ai_enabled') =>
    req<EmailAccount>('/hotel/email/accounts/' + id + '/toggle', { method: 'PUT', body: JSON.stringify({ field }) }),
  testEmailConnection: (id: string) =>
    req<{ readAccess: boolean; sendAccess: boolean; folderAccess: boolean; error?: string }>(
      '/hotel/email/accounts/' + id + '/test', { method: 'POST' }),
  listEmailFolders: (id: string) =>
    req<{ name: string; path: string }[]>('/hotel/email/accounts/' + id + '/folders'),
  getEmailConversations: () => req<EmailConversation[]>('/hotel/email/conversations'),
  getEmailMessages: (convId: string) => req<EmailMessage[]>('/hotel/email/conversations/' + convId + '/messages'),
  getOAuthUrl: () => `${BASE}/hotel/email/oauth/microsoft`,
};
