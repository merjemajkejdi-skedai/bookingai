/// <reference types="vite/client" />
import type { Zone, RestaurantTable, Reservation, ZoneAvailability } from './types';

const BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

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
  // Zones
  getZones: () => req<Zone[]>('/restaurant/zones'),
  createZone: (data: Partial<Zone>) => req<Zone>('/restaurant/zones', { method: 'POST', body: JSON.stringify(data) }),
  updateZone: (id: string, data: Partial<Zone>) => req<Zone>(`/restaurant/zones/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteZone: (id: string) => req(`/restaurant/zones/${id}`, { method: 'DELETE' }),

  // Tables
  getTables: (zoneId: string) => req<RestaurantTable[]>(`/restaurant/zones/${zoneId}/tables`),
  createTable: (zoneId: string, data: { name: string; seats: number }) =>
    req<RestaurantTable>(`/restaurant/zones/${zoneId}/tables`, { method: 'POST', body: JSON.stringify(data) }),
  updateTable: (id: string, data: Partial<RestaurantTable>) =>
    req<RestaurantTable>(`/restaurant/tables/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTable: (id: string) => req(`/restaurant/tables/${id}`, { method: 'DELETE' }),

  // Reservations
  getReservations: (params: { date?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return req<Reservation[]>(`/restaurant/reservations${q ? '?' + q : ''}`);
  },
  createReservation: (data: Partial<Reservation>) =>
    req<Reservation>('/restaurant/reservations', { method: 'POST', body: JSON.stringify(data) }),
  updateReservation: (id: string, data: Partial<Reservation>) =>
    req<Reservation>(`/restaurant/reservations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  cancelReservation: (id: string) => req(`/restaurant/reservations/${id}`, { method: 'DELETE' }),

  // Availability
  getAvailability: (date: string, time: string, durationMins?: number) => {
    const q = new URLSearchParams({ date, time, ...(durationMins ? { durationMins: String(durationMins) } : {}) }).toString();
    return req<ZoneAvailability[]>(`/restaurant/availability?${q}`);
  },
};
