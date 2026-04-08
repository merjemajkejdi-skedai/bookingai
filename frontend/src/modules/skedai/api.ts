import { getStoredUser, getAdminTenant } from '../../shared/lib/auth';
import type { SkedAIConfig } from './types';

function base() {
  return import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
}

function headers() {
  const user = getStoredUser();
  const token = user?.token ?? '';
  const at = getAdminTenant();
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (at?.id) h['x-admin-tenant-id'] = at.id;
  return h;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}/api${path}`, { ...init, headers: headers() });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

export const api = {
  getConfig:       () => req<SkedAIConfig>('/skedai/config'),
  saveAdmin:       (d: Pick<SkedAIConfig, 'forwardPhone' | 'calendlyUrl'>) =>
    req('/skedai/config/admin',   { method: 'PUT', body: JSON.stringify(d) }),
  saveSupport:     (d: Pick<SkedAIConfig, 'supportFaq' | 'healthCheckUrls'>) =>
    req('/skedai/config/support', { method: 'PUT', body: JSON.stringify(d) }),
  saveSales:       (d: Pick<SkedAIConfig, 'industries'>) =>
    req('/skedai/config/sales',   { method: 'PUT', body: JSON.stringify(d) }),
};
