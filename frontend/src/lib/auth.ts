/// <reference types="vite/client" />
const TOKEN_KEY = 'bookingai_token';
const USER_KEY  = 'bookingai_user';

export interface AuthUser {
  id: string;
  email: string;
  role: 'super_admin' | 'shop_owner';
  tenantId: string | null;
  tenant?: { name: string; type: string; plan: string } | null;
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Auth API calls
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_URL || '';

async function authFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const { headers: extraHeaders, ...restOpts } = opts ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
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

export const adminApi = {
  getTenants: () => authFetch<any[]>('/admin/tenants'),
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
};
