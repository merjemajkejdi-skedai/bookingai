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
  survey_sent: boolean;
  survey_score: number | null;
  survey_sent_at: string | null;
  survey_replied_at: string | null;
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
  photo_url: string | null;
  photo_mime_type: string | null;
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
  response_time_minutes: number;
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
  // Survey / stay fields (populated from most-recent guest stay JOIN)
  stay_id: string | null;
  guest_status: 'checked_in' | 'checked_out' | null;
  survey_sent: boolean;
  survey_score: number | null;
  // Timestamp of the last inbound guest message (used for 24h survey window)
  last_guest_message_at: string | null;
}

export interface BlockedNumber {
  tenant_id: string;
  phone: string;
  label: string | null;
  created_at: string;
}

export interface HotelReview {
  id: string;
  tenant_id: string;
  source: 'booking' | 'tripadvisor' | 'google' | 'manual' | 'unknown';
  reviewer_name: string | null;
  score: number | null;
  score_max: number;
  review_date: string | null;
  positive_text: string | null;
  negative_text: string | null;
  full_review_text: string | null;
  language: string;
  suggested_response: string | null;
  final_response: string | null;
  status: 'pending' | 'approved' | 'replied' | 'ignored';
  is_flagged: number; // 0 | 1
  sentiment_score: number | null;
  flag_reason: string | null;
  created_at: string;
  replied_at: string | null;
}

export interface ReviewStats {
  total: number;
  flagged: number;
  pending: number;
  replied: number;
  avg_score: number | null;
  avg_sentiment: number | null;
}

export type NotificationFrequency = 'immediate' | 'daily' | 'twice_daily' | 'weekly' | 'mon_thu' | 'never';

export interface ReviewConfig {
  slug: string | null;
  email: string | null;
  owner_phone: string | null;
  notification_frequency: NotificationFrequency;
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
  location_url: string | null;
  menu_url: string | null;
  ask_guest_identity: number; // 1 = ask, 0 = skip
  message_forward: number;    // 1 = forward requests to depts, 0 = FAQ-only + reception link
  // Feature flags (from tenants row, merged into config response)
  reviews_enabled: number;
  survey_enabled:  number;
  menus_enabled:   number;
  // Survey config
  review_platform_url: string | null;
  review_platform_name: string | null;
  survey_positive_threshold: number;
  survey_positive_message: string | null;
  survey_negative_message: string | null;
}
