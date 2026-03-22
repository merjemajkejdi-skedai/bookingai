/// <reference types="vite/client" />
import type { Specialist, Service, Booking, TimeSlot } from '../types';

const BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem('bookingai_token');
  const { headers: extraHeaders, ...restOpts } = opts ?? {};
  const res = await fetch(`${BASE}${path}`, {
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
  // Specialists
  getSpecialists: () => req<Specialist[]>('/specialists'),
  createSpecialist: (data: Omit<Specialist, 'id'|'createdAt'|'workingHours'>) =>
    req<Specialist>('/specialists', { method: 'POST', body: JSON.stringify(data) }),
  updateSpecialist: (id: string, data: Partial<Specialist>) =>
    req<Specialist>(`/specialists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateWorkingHours: (id: string, hours: Specialist['workingHours']) =>
    req(`/specialists/${id}/working-hours`, { method: 'PUT', body: JSON.stringify(hours) }),

  // Services
  getServices: () => req<Service[]>('/services'),
  createService: (data: Omit<Service, 'id'|'tenantId'>) =>
    req<Service>('/services', { method: 'POST', body: JSON.stringify(data) }),
  updateService: (id: string, data: Partial<Service>) =>
    req<Service>(`/services/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteService: (id: string) =>
    req(`/services/${id}`, { method: 'DELETE' }),

  // Bookings
  getBookings: (params: { start?: string; end?: string; specialistId?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return req<Booking[]>(`/bookings${q ? '?' + q : ''}`);
  },
  createBooking: (data: {
    specialistId: string; serviceId: string; customerName: string;
    customerPhone: string; startsAt: string; notes: string;
  }) => req<Booking>('/bookings', { method: 'POST', body: JSON.stringify(data) }),
  updateBooking: (id: string, data: Partial<Booking>) =>
    req<Booking>(`/bookings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  cancelBooking: (id: string) =>
    req(`/bookings/${id}`, { method: 'DELETE' }),

  // Availability
  getAvailability: (specialistId: string, date: string, durationMins: number) =>
    req<{ date: string; specialistId: string; slots: TimeSlot[] }>(
      `/availability?specialistId=${specialistId}&date=${date}&durationMins=${durationMins}`
    ),
  suggestSlots: (specialistId: string, fromDate: string, durationMins: number) =>
    req<TimeSlot[]>(
      `/availability/suggest?specialistId=${specialistId}&fromDate=${fromDate}&durationMins=${durationMins}`
    ),
};
