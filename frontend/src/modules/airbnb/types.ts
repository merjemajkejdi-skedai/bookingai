export interface AirbnbListingConfig {
  check_in_time?: string;
  check_out_time?: string;
  wifi_network?: string;
  wifi_password?: string;
  door_code?: string;
  house_rules?: string;
  local_recommendations?: string;
}

export type InstructionBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string };

export interface AirbnbListing {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  is_active: boolean;
  config: AirbnbListingConfig;
  confirmation_forward_email?: string | null;
  use_shared_forward_email?: boolean;
  checkin_instructions?: InstructionBlock[];
  backup_owner_number?: string | null;
  checkin_send_time?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AirbnbReservation {
  id: string;
  listing_id: string;
  listing_name: string;
  platform: 'airbnb' | 'booking' | 'manual';
  source?: 'email_forward' | 'manual';
  reservation_code?: string | null;
  guest_name: string;
  guest_count?: number | null;
  guest_phone?: string | null;
  checkin_date: string;
  checkout_date?: string | null;
  status: 'confirmed' | 'cancelled';
  checkin_instructions_sent: boolean;
  do_not_send: boolean;
  created_at: string;
}

export interface AirbnbEmailReview {
  id: string;
  listing_id?: string | null;
  listing_name?: string | null;
  status: 'unparsed' | 'unmatched' | 'error';
  reason?: string | null;
  from_address?: string | null;
  subject?: string | null;
  body_excerpt?: string | null;
  created_at: string;
}

export interface AirbnbFaq {
  id: string;
  listing_id: string;
  category?: string | null;
  question: string;
  answer: string;
  created_at: string;
  updated_at: string;
}

export interface AirbnbRequest {
  id: string;
  listing_id: string;
  listing_name: string;
  conversation_id?: string | null;
  category: string;
  description: string;
  status: 'open' | 'resolved';
  department_id?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface AirbnbDepartment {
  id: string;
  tenant_id: string;
  name: string;
  notification_number: string;
  is_active: boolean;
  created_at: string;
}

export interface AirbnbBlockedNumber {
  id: string;
  tenant_id: string;
  phone_number: string;
  reason?: string | null;
  created_at: string;
}

export interface AirbnbConversation {
  id: string;
  tenant_id: string;
  listing_id: string | null;
  listing_name?: string | null;
  channel: string;
  channel_user_id: string;
  messages?: { role: string; content: string; ts: string }[];
  ai_paused_until?: string | null;
  checked_out_at?: string | null;
  survey_sent_at?: string | null;
  updated_at: string;
  created_at: string;
}
