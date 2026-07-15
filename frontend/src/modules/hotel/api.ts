/// <reference types="vite/client" />
import type { GuestStay, HotelRequest, FaqEntry, HotelConfig, Department, DepartmentSchedule, Conversation, BlockedNumber, HotelReview, ReviewStats, ReviewConfig, ChannelSetting } from './types';

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

  // Requests analytics
  getRequestsAnalyticsSummary: (days: number) =>
    req<any>(`/hotel/requests/analytics/summary?days=${days}`),
  getRequestsAnalyticsBreakdown: (days: number) =>
    req<any>(`/hotel/requests/analytics/breakdown?days=${days}`),
  getRequestsAnalyticsResolution: (days: number) =>
    req<any>(`/hotel/requests/analytics/resolution?days=${days}`),

  // Guests
  getGuests: () => req<GuestStay[]>('/hotel/guests'),
  checkIn: (data: { room_number: string; guest_name: string; guest_phone: string; check_in: string; check_out: string }) =>
    req<GuestStay>('/hotel/guests/checkin', { method: 'POST', body: JSON.stringify(data) }),
  checkOut: (id: string) =>
    req(`/hotel/guests/${id}/checkout`, { method: 'PATCH' }),
  checkoutAndSurvey: (guestId: string) =>
    req(`/hotel/guests/${guestId}/checkout-survey`, { method: 'POST' }),
  importGuests: async (file: File): Promise<{ imported: number }> => {
    const fileBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result is "data:<mime>;base64,<data>" — strip the prefix
        resolve(result.split(',')[1] ?? result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return req<{ imported: number }>('/hotel/guests/import', {
      method: 'POST',
      body: JSON.stringify({ fileBase64 }),
    });
  },

  // Config
  getConfig: () => req<HotelConfig>('/hotel/config'),
  updateConfig: (data: Partial<HotelConfig>) =>
    req('/hotel/config', { method: 'PUT', body: JSON.stringify(data) }),

  // FAQ
  getFaq: () => req<FaqEntry[]>('/hotel/faq'),
  createFaq: (data: { question: string; answer: string; category: string }) =>
    req<FaqEntry>('/hotel/faq', { method: 'POST', body: JSON.stringify(data) }),
  updateFaq: (id: string, data: { question: string; answer: string; category: string }) =>
    req<FaqEntry>(`/hotel/faq/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFaq: (id: string) =>
    req(`/hotel/faq/${id}`, { method: 'DELETE' }),

  // Departments
  getDepartments: () => req<Department[]>('/hotel/departments'),
  createDepartment: (data: {
    name: string; whatsapp: string; request_types: string[];
    response_time_minutes?: number; language?: string;
    scheduling_enabled?: number; after_hours_message?: string | null;
    confirmation_mode?: string;
  }) => req<Department>('/hotel/departments', { method: 'POST', body: JSON.stringify(data) }),
  updateDepartment: (id: string, data: {
    name: string; whatsapp: string; request_types: string[];
    is_active?: boolean; response_time_minutes?: number; language?: string;
    scheduling_enabled?: number; after_hours_message?: string | null;
    confirmation_mode?: string;
  }) => req(`/hotel/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDepartment: (id: string) =>
    req(`/hotel/departments/${id}`, { method: 'DELETE' }),
  getDeptSchedules: (deptId: string) =>
    req<DepartmentSchedule[]>(`/hotel/departments/${deptId}/schedules`),
  saveDeptSchedules: (deptId: string, schedules: Array<{
    id?: string;
    day_type: string;
    start_time: string;
    end_time: string;
    response_time_minutes: number;
    display_order?: number;
  }>) => req(`/hotel/departments/${deptId}/schedules`, { method: 'PUT', body: JSON.stringify({ schedules }) }),

  // Conversations
  getConversations: () => req<Conversation[]>('/hotel/conversations'),
  getConversation: (phone: string) =>
    req<Conversation>(`/hotel/conversations/${encodeURIComponent(phone)}`),
  replyToGuest: (id: string, message: string) => {
    console.log('[replyToGuest] conversation id used in URL:', id);
    return req(`/hotel/conversations/${id}/reply`, {
      method: 'POST', body: JSON.stringify({ message }),
    });
  },
  pauseAI: (phone: string, minutes = 15) =>
    req<{ paused: boolean; paused_until: string; minutes_remaining: number }>(
      `/hotel/conversations/${encodeURIComponent(phone)}/pause`,
      { method: 'POST', body: JSON.stringify({ minutes }) },
    ),
  resumeAI: (phone: string) =>
    req<{ paused: boolean }>(
      `/hotel/conversations/${encodeURIComponent(phone)}/resume`,
      { method: 'POST' },
    ),
  getPauseStatus: (phone: string) =>
    req<{ paused: boolean; paused_until: string | null; minutes_remaining: number; paused_by: string | null }>(
      `/hotel/conversations/${encodeURIComponent(phone)}/pause-status`,
    ),

  // Blocked numbers / staff
  getBlocked: () => req<BlockedNumber[]>('/hotel/blocked'),
  addBlocked: (data: {
    phone: string; label?: string;
    staff_name?: string; staff_role?: string; is_staff?: boolean;
  }) => req('/hotel/blocked', { method: 'POST', body: JSON.stringify(data) }),
  removeBlocked: (phone: string) =>
    req(`/hotel/blocked/${encodeURIComponent(phone)}`, { method: 'DELETE' }),

  // Reviews
  getReviews: (params?: { status?: string; flagged?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.status)  qs.set('status', params.status);
    if (params?.flagged) qs.set('flagged', 'true');
    const q = qs.toString();
    return req<HotelReview[]>(`/hotel/reviews${q ? `?${q}` : ''}`);
  },
  getReviewStats: () => req<ReviewStats>('/hotel/reviews/stats'),
  updateReview: (id: string, data: { status?: string; final_response?: string }) =>
    req(`/hotel/reviews/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createManualReview: (data: {
    source: string;
    reviewer_name?: string;
    score?: number;
    positive_text?: string;
    negative_text?: string;
    full_review_text?: string;
  }) => req<HotelReview>('/hotel/reviews/manual', { method: 'POST', body: JSON.stringify(data) }),
  regenerateResponse: (id: string) =>
    req<{ suggested_response: string }>(`/hotel/reviews/${id}/regenerate`, { method: 'POST' }),
  getReviewConfig: () => req<ReviewConfig>('/hotel/reviews/config'),
  updateReviewConfig: (data: { slug: string; owner_phone: string; notification_frequency?: string }) =>
    req<ReviewConfig>('/hotel/reviews/config', { method: 'PUT', body: JSON.stringify(data) }),

  // Channels
  getChannelSettings: () => req<ChannelSetting[]>('/hotel/channels'),
  toggleChannelAI: (channel: string, ai_enabled: boolean) =>
    req(`/hotel/channels/${channel}/ai-toggle`, {
      method: 'PUT',
      body: JSON.stringify({ ai_enabled }),
    }),

  // Menus
  getMenus: () => req<any[]>('/hotel/menus'),
  getMenu: (id: string) => req<any>(`/hotel/menus/${id}`),
  createMenu: (data: { name: string; menu_type: string; description?: string; keywords?: string[]; display_order?: number }) =>
    req<any>('/hotel/menus', { method: 'POST', body: JSON.stringify(data) }),
  updateMenu: (id: string, data: any) =>
    req<any>(`/hotel/menus/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMenu: (id: string) =>
    req(`/hotel/menus/${id}`, { method: 'DELETE' }),
  uploadMenuFile: async (id: string, file: File): Promise<{ file_url: string; file_type: string }> => {
    const token = localStorage.getItem('bookingai_token');
    const raw = localStorage.getItem('bookingai_admin_tenant');
    const user = JSON.parse(localStorage.getItem('bookingai_user') || 'null');
    let url = `${import.meta.env.VITE_API_URL || ''}/hotel/menus/${id}/upload`;
    if (user?.role === 'super_admin' && raw) {
      const { id: tenantId } = JSON.parse(raw);
      url += `?tenantId=${encodeURIComponent(tenantId)}`;
    }
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await res.text();
    const json = JSON.parse(text);
    if (!json.success) throw new Error(json.error || 'Upload failed');
    return json.data;
  },
  removeMenuFile: (id: string) =>
    req(`/hotel/menus/${id}/upload`, { method: 'DELETE' }),
  getMenuItems: (menuId: string) => req<any[]>(`/hotel/menus/${menuId}/items`),
  addMenuItem: (menuId: string, data: { name: string; description?: string; price?: number; currency?: string; category?: string }) =>
    req<any>(`/hotel/menus/${menuId}/items`, { method: 'POST', body: JSON.stringify(data) }),
  updateMenuItem: (menuId: string, itemId: string, data: any) =>
    req(`/hotel/menus/${menuId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMenuItem: (menuId: string, itemId: string) =>
    req(`/hotel/menus/${menuId}/items/${itemId}`, { method: 'DELETE' }),
};
