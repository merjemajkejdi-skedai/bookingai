/// <reference types="vite/client" />
import { redirectToLoginOnSessionExpired } from './sessionExpiry.js';

export interface EscalationConfig {
  tenantType: string;
  supported: boolean;
  hasDepartments: boolean;
  enabled: boolean;
  number: string | null;
  timeoutMinutes: number;
}

const BASE = `${import.meta.env.VITE_API_URL || ''}`;

// An explicit tenantId (admin editing a specific tenant) wins; otherwise a
// super_admin impersonating a tenant is scoped the same way the module APIs do it.
function withTenant(path: string, explicitTenantId?: string): string {
  let id = explicitTenantId;
  if (!id) {
    try {
      const raw = localStorage.getItem('bookingai_admin_tenant');
      const user = JSON.parse(localStorage.getItem('bookingai_user') || 'null');
      if (user?.role === 'super_admin' && raw) id = JSON.parse(raw).id;
    } catch { /* ignore */ }
  }
  return id ? `${path}?tenantId=${encodeURIComponent(id)}` : path;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('bookingai_token');
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) {
    redirectToLoginOnSessionExpired();
    throw new Error('Session expired');
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Server error ${res.status}`); }
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

export const escalationApi = {
  get: (tenantId?: string) =>
    req<EscalationConfig>(withTenant('/api/escalation/config', tenantId)),
  save: (data: { enabled?: boolean; number?: string; timeoutMinutes?: number }, tenantId?: string) =>
    req<EscalationConfig>(withTenant('/api/escalation/config', tenantId), { method: 'PUT', body: JSON.stringify(data) }),
};
