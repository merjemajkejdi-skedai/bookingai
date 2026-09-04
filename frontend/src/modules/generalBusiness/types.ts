export interface GbConfig {
  id?: string;
  tenant_id?: string;
  business_name: string;
  business_description?: string;
  phone?: string;
  website?: string;
  email?: string;
  opening_hours: Record<string, { open: string; close: string } | null>;
  notification_whatsapp?: string;
  fallback_message?: string;
  ai_enabled: boolean;
}

export interface GbLocation {
  id: string;
  name: string;
  address: string;
  phone?: string;
  sort_order: number;
  is_active: boolean;
}

export interface GbDepartment {
  id: string;
  name: string;
  whatsapp_number?: string;
  request_types: string[];
  response_time_minutes: number;
  is_active: boolean;
}

export interface GbFaq {
  id: string;
  question: string;
  answer: string;
  is_active: boolean;
  sort_order: number;
}

export interface GbDocument {
  id: string;
  name: string;
  file_type: string;
  r2_key: string;
  file_size_bytes?: number;
  extracted_text?: string;
  is_active: boolean;
  created_at: string;
}

export interface GbMenuItem {
  id: string;
  name: string;
  description?: string;
  price?: number;
  currency: string;
  category?: string;
  is_available: boolean;
  sort_order: number;
}

export interface GbOrder {
  id: string;
  order_number: string;
  guest_phone?: string;
  guest_name?: string;
  guest_instagram?: string;
  guest_email?: string;
  items: { item_id: string; name: string; price: number; quantity: number }[];
  total_price?: number;
  currency: string;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface GbRequest {
  id: string;
  department_id?: string;
  department_name?: string;
  guest_phone?: string;
  guest_name?: string;
  request_type?: string;
  description: string;
  status: string;
  staff_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface GbConversation {
  id: string;
  guest_phone?: string;
  guest_name?: string;
  guest_username?: string;
  guest_email?: string;
  messages?: { role: string; content: string; ts: string }[];
  last_message?: string;
  channel: string;
  channel_user_id?: string;
  ai_paused_until?: string;
  ai_paused_by?: string;
  updated_at?: string;
  last_guest_message_at?: string;
}
