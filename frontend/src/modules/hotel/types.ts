// All fields match the raw snake_case column names returned by the backend

export interface GuestStay {
  id: string;
  tenant_id: string;
  room_number: string;
  guest_name: string;
  guest_phone: string;
  check_in: string;
  check_out: string;
  status: 'checked_in' | 'checked_out';
  created_at: string;
}

export interface HotelRequest {
  id: string;
  tenant_id: string;
  stay_id: string | null;
  room_number: string;
  guest_phone: string;
  request_type: 'room_service' | 'housekeeping' | 'maintenance' | 'concierge_question' | 'complaint' | 'other';
  description: string;
  status: 'pending' | 'in_progress' | 'resolved';
  department: 'food_beverage' | 'housekeeping' | 'maintenance' | 'reception' | 'management';
  priority: 'high' | 'normal' | 'low';
  created_at: string;
  resolved_at: string | null;
}

export interface FaqEntry {
  id: string;
  tenant_id: string;
  question: string;
  answer: string;
  category: string;
  is_active: boolean;
}

export interface HotelConfig {
  tenant_id: string;
  hotel_name: string;
  check_in_time: string;
  check_out_time: string;
  wifi_password: string | null;
  breakfast_hours: string | null;
  pool_hours: string | null;
  restaurant_hours: string | null;
  reception_phone: string | null;
  emergency_phone: string | null;
  timezone: string;
}

export interface EmailAccount {
  id: string;
  tenant_id: string;
  provider: 'imap' | 'graph';
  email_address: string;
  display_name: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: number;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: number;
  username?: string;
  oauth_email?: string;
  watch_folder: string;
  answered_folder: string;
  failed_folder: string;
  is_enabled: number;
  ai_enabled: number;
  consecutive_failures: number;
  last_error?: string;
  last_checked_at?: string;
  created_at: string;
}

export interface EmailConversation {
  id: string;
  channel: string;
  channel_user_id: string;
  subject: string | null;
  updated_at: string;
  from_name: string | null;
  from_address: string | null;
  last_body: string | null;
}

export interface EmailMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string;
  body_text: string | null;
  created_at: string;
}
