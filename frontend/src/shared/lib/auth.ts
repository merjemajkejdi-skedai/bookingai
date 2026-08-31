/// <reference types="vite/client" />
const TOKEN_KEY        = 'bookingai_token';
const USER_KEY         = 'bookingai_user';
const ADMIN_TENANT_KEY = 'bookingai_admin_tenant';

// --------------------------------------------------------------------------
// Admin "viewing as tenant" — stored so it survives page reload
// --------------------------------------------------------------------------
export interface AdminTenant { id: string; name: string; type: string; }

export function getAdminTenant(): AdminTenant | null {
  const raw = localStorage.getItem(ADMIN_TENANT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setAdminTenant(t: AdminTenant | null): void {
  if (t) localStorage.setItem(ADMIN_TENANT_KEY, JSON.stringify(t));
  else   localStorage.removeItem(ADMIN_TENANT_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'super_admin' | 'shop_owner';
  tenantId: string | null;
  tenant?: { name: string; type: string; plan: string; hasAnalytics?: boolean } | null;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ADMIN_TENANT_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function isAdmin(): boolean {
  return getStoredUser()?.role === 'super_admin';
}

const API_BASE = import.meta.env.VITE_API_URL || '';

async function authFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const { headers: extraHeaders, ...restOpts } = opts ?? {};

  // Super-admin viewing a specific shop → inject tenantId as query param so
  // the backend's resolveTenantId() picks it up for all HTTP methods.
  let url = `${API_BASE}${path}`;
  if (getStoredUser()?.role === 'super_admin') {
    const at = getAdminTenant();
    if (at) url += (url.includes('?') ? '&' : '?') + `tenantId=${encodeURIComponent(at.id)}`;
  }

  const res = await fetch(url, {
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
  catch { throw new Error(`Server error: ${res.status}`); }
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

/** Like authFetch but never appends tenantId — for platform-wide admin endpoints */
async function adminFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const { headers: extraHeaders, ...restOpts } = opts ?? {};
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
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
  catch { throw new Error(`Server error: ${res.status}`); }
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

export const authApi = {
  login: (email: string, password: string) =>
    authFetch<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => authFetch<AuthUser>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    authFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const analyticsApi = {
  getMessages: (period: string) =>
    adminFetch<any[]>(`/admin/analytics/messages?period=${period}`),
  getSummary: (period: string) =>
    adminFetch<any>(`/admin/analytics/summary?period=${period}`),
  getTimeline: (period: string) =>
    adminFetch<any[]>(`/admin/analytics/timeline?period=${period}`),
};

export const adminApi = {
  getTenants: () => authFetch<any[]>('/admin/tenants'),
  getTenant:  (id: string) => authFetch<any>(`/admin/tenants/${id}`),
  getStats:   () => authFetch<any>('/admin/stats'),
  createTenant: (data: {
    name: string; type: string; timezone: string;
    ownerEmail: string; ownerPassword: string;
    whatsappNumber: string; plan: string; billingEmail: string;
  }) => authFetch('/admin/tenants', { method: 'POST', body: JSON.stringify(data) }),
  updateTenant: (id: string, data: Record<string, any>) =>
    authFetch(`/admin/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetPassword: (tenantId: string, newPassword: string) =>
    authFetch(`/admin/tenants/${tenantId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  toggleChannelAI: (tenantId: string, channel: string, ai_enabled: boolean) =>
    authFetch(`/admin/tenants/${tenantId}/channels/${channel}/ai-toggle`, {
      method: 'PUT',
      body: JSON.stringify({ ai_enabled }),
    }),
  connectInstagram: (tenantId: string, data: { access_token: string; instagram_account_id: string }) =>
    authFetch(`/admin/tenants/${tenantId}/channels/instagram/connect`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  disconnectInstagram: (tenantId: string) =>
    authFetch(`/admin/tenants/${tenantId}/channels/instagram/disconnect`, { method: 'DELETE' }),
  connectMessenger: (tenantId: string, data: { page_id: string; page_name: string; access_token: string }) =>
    authFetch(`/admin/tenants/${tenantId}/channels/facebook/connect`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  disconnectMessenger: (tenantId: string) =>
    authFetch(`/admin/tenants/${tenantId}/channels/facebook/disconnect`, { method: 'DELETE' }),
  getEmailAccounts: (tenantId: string) =>
    adminFetch<any[]>(`/hotel/email/accounts?tenantId=${encodeURIComponent(tenantId)}`),
  createEmailAccount: (tenantId: string, data: Record<string, any>) =>
    adminFetch<any>(`/hotel/email/accounts?tenantId=${encodeURIComponent(tenantId)}`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteEmailAccount: (tenantId: string, accountId: string) =>
    adminFetch<any>(`/hotel/email/accounts/${accountId}?tenantId=${encodeURIComponent(tenantId)}`, {
      method: 'DELETE',
    }),
  toggleEmailAccount: (tenantId: string, accountId: string, field: 'is_enabled' | 'ai_enabled') =>
    adminFetch<any>(`/hotel/email/accounts/${accountId}/toggle?tenantId=${encodeURIComponent(tenantId)}`, {
      method: 'PUT', body: JSON.stringify({ field }),
    }),
  patchEmailSendMode: (tenantId: string, accountId: string, sendMode: 'resend' | 'graph') =>
    adminFetch<any>(`/hotel/email/accounts/${accountId}/send-mode?tenantId=${encodeURIComponent(tenantId)}`, {
      method: 'PATCH', body: JSON.stringify({ send_mode: sendMode }),
    }),
  getWhatsAppLeads: () => authFetch<any[]>('/api/whatsapp/signup-leads'),
  updateWhatsAppLead: (leadId: string, data: { status?: string; notes?: string; tenant_id?: string }) =>
    authFetch<any>(`/api/whatsapp/signup-leads/${leadId}`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
};
