/// <reference types="vite/client" />
import type { Specialist, ArtEvent, EventRegistration, EventTemplate } from './types';

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
  // Teachers (specialists)
  getSpecialists: () => req<Specialist[]>('/specialists'),
  createSpecialist: (data: Omit<Specialist, 'id'|'createdAt'|'workingHours'>) =>
    req<Specialist>('/specialists', { method: 'POST', body: JSON.stringify(data) }),
  updateSpecialist: (id: string, data: Partial<Specialist>) =>
    req<Specialist>(`/specialists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateWorkingHours: (id: string, hours: Specialist['workingHours']) =>
    req(`/specialists/${id}/working-hours`, { method: 'PUT', body: JSON.stringify(hours) }),

  // Classes (events)
  getEvents: (params: { start?: string; end?: string; teacherId?: string }) => {
    const q = new URLSearchParams(params as Record<string,string>).toString();
    return req<ArtEvent[]>(`/events${q ? '?' + q : ''}`);
  },
  createEvent: (data: Omit<ArtEvent, 'id'|'tenantId'|'isActive'|'createdAt'|'teacherName'|'teacherColor'|'registrationCount'>) =>
    req<ArtEvent>('/events', { method: 'POST', body: JSON.stringify(data) }),
  updateEvent: (id: string, data: Partial<ArtEvent>) =>
    req<ArtEvent>(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEvent: (id: string) =>
    req(`/events/${id}`, { method: 'DELETE' }),

  // Registrations
  getRegistrations: (eventId: string) =>
    req<EventRegistration[]>(`/events/${eventId}/registrations`),
  createRegistration: (eventId: string, data: { participantName: string; parentPhone?: string; parentName?: string; notes?: string }) =>
    req<EventRegistration>(`/events/${eventId}/registrations`, { method: 'POST', body: JSON.stringify(data) }),
  deleteRegistration: (eventId: string, regId: string) =>
    req(`/events/${eventId}/registrations/${regId}`, { method: 'DELETE' }),

  // Templates
  getTemplates: () => req<EventTemplate[]>('/event-templates'),
  createTemplate: (data: Omit<EventTemplate, 'id'|'tenantId'|'createdAt'|'teacherName'|'teacherColor'|'ageMin'|'ageMax'>) =>
    req<EventTemplate>('/event-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: Partial<EventTemplate>) =>
    req<EventTemplate>(`/event-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) =>
    req(`/event-templates/${id}`, { method: 'DELETE' }),
};
