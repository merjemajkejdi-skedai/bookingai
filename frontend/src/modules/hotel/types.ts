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
  guest_name: string | null;
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

export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  whatsapp: string;
  request_types: string[];
  is_active: boolean;
  created_at: string;
}

export interface HotelMessage {
  role: 'user' | 'assistant' | 'staff';
  content: string;
  ts: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  guest_phone: string;
  room_number: string | null;
  messages: HotelMessage[];
  last_message_preview: HotelMessage | null;
  message_count: number;
  last_message: string;
  updated_at: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
}

export interface BlockedNumber {
  tenant_id: string;
  phone: string;
  label: string | null;
  created_at: string;
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
