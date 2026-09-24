/// <reference types="vite/client" />
import type { AirbnbListing, AirbnbFaq, AirbnbRequest, AirbnbConversation, AirbnbDepartment, AirbnbBlockedNumber } from './types';
import { redirectToLoginOnSessionExpired } from '../../shared/lib/sessionExpiry.js';

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
  if (res.status === 401) {
    redirectToLoginOnSessionExpired();
    throw new Error('Session expired');
  }
  const text = await res.text();
  if (!text) throw new Error('Empty response from server');
  let json: any;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 100)}`); }
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data as T;
}

export const airbnbApi = {
  getListings: () => req<AirbnbListing[]>('/airbnb/listings'),
  createListing: (data: Partial<AirbnbListing>) =>
    req<AirbnbListing>('/airbnb/listings', { method: 'POST', body: JSON.stringify(data) }),
  updateListing: (id: string, data: Partial<AirbnbListing>) =>
    req<AirbnbListing>('/airbnb/listings/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteListing: (id: string) =>
    req<any>('/airbnb/listings/' + id, { method: 'DELETE' }),

  getFaqs: (listingId: string) => req<AirbnbFaq[]>(`/airbnb/faqs?listingId=${encodeURIComponent(listingId)}`),
  createFaq: (data: { listing_id: string; question: string; answer: string; category?: string }) =>
    req<AirbnbFaq>('/airbnb/faqs', { method: 'POST', body: JSON.stringify(data) }),
  updateFaq: (id: string, data: Partial<AirbnbFaq>) =>
    req<AirbnbFaq>('/airbnb/faqs/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFaq: (id: string) =>
    req<any>('/airbnb/faqs/' + id, { method: 'DELETE' }),

  getRequests: (status = 'open', opts?: { listingId?: string; resolvedAfter?: string; resolvedBefore?: string }) => {
    const p = new URLSearchParams({ status });
    if (opts?.listingId)      p.set('listingId', opts.listingId);
    if (opts?.resolvedAfter)  p.set('resolvedAfter', opts.resolvedAfter);
    if (opts?.resolvedBefore) p.set('resolvedBefore', opts.resolvedBefore);
    return req<AirbnbRequest[]>(`/airbnb/requests?${p.toString()}`);
  },
  updateRequestStatus: (id: string, status: 'open' | 'resolved') =>
    req<AirbnbRequest>('/airbnb/requests/' + id, { method: 'PATCH', body: JSON.stringify({ status }) }),

  getConversations: () => req<AirbnbConversation[]>('/airbnb/conversations'),
  getConversation: (id: string) => req<AirbnbConversation>('/airbnb/conversations/' + id),
  sendReply: (id: string, message: string) =>
    req<any>('/airbnb/conversations/' + id + '/reply', { method: 'POST', body: JSON.stringify({ message }) }),
  takeoverConversation: (id: string, minutes = 60) =>
    req<any>('/airbnb/conversations/' + id + '/takeover', { method: 'POST', body: JSON.stringify({ minutes }) }),
  resumeConversation: (id: string) =>
    req<any>('/airbnb/conversations/' + id + '/resume', { method: 'POST' }),
  checkoutConversation: (id: string) =>
    req<{ checked_out: boolean; survey_sent: boolean; reason?: string }>('/airbnb/conversations/' + id + '/checkout', { method: 'POST' }),

  getDepartments: () => req<AirbnbDepartment[]>('/airbnb/departments'),
  createDepartment: (data: { name: string; notification_number: string }) =>
    req<AirbnbDepartment>('/airbnb/departments', { method: 'POST', body: JSON.stringify(data) }),
  updateDepartment: (id: string, data: Partial<AirbnbDepartment>) =>
    req<AirbnbDepartment>('/airbnb/departments/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id: string) =>
    req<any>('/airbnb/departments/' + id, { method: 'DELETE' }),

  getBlockedNumbers: () => req<AirbnbBlockedNumber[]>('/airbnb/blocked'),
  addBlockedNumber: (data: { phone_number: string; reason?: string }) =>
    req<AirbnbBlockedNumber>('/airbnb/blocked', { method: 'POST', body: JSON.stringify(data) }),
  removeBlockedNumber: (id: string) =>
    req<any>('/airbnb/blocked/' + id, { method: 'DELETE' }),
};
