export interface ShopConfig {
  id: string;
  tenant_id: string;
  shop_name?: string;
  opening_hours?: string;
  estimated_pickup_minutes: number;
  pickup_mode: 'estimated' | 'exact' | 'asap';
  agent_personality: 'friendly' | 'professional' | 'playful';
  fallback_message?: string;
  fallback_backup_number?: string;
  fallback_after_attempts?: number;
  address?: string;
  instagram_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  website_url?: string;
  phone?: string;
}

export interface ShopCategory {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export interface ShopItem {
  id: string;
  tenant_id: string;
  category_id?: string;
  category_name?: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  photo_url?: string;
  photo_filename?: string;
  stock_type: 'unlimited' | 'daily' | 'fixed';
  stock_limit?: number;
  stock_used: number;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ShopOrderItem {
  id: string;
  order_id: string;
  item_id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  subtotal: number;
}

export interface ShopOrder {
  id: string;
  tenant_id: string;
  order_number: number;
  order_date: string;
  guest_phone: string;
  pickup_name?: string;
  status: 'new' | 'in_progress' | 'done' | 'picked_up' | 'cancelled';
  total_price: number;
  currency: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  in_progress_at?: string;
  done_at?: string;
  picked_up_at?: string;
  cancelled_at?: string;
  items: ShopOrderItem[];
}

export interface ShopFaq {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_at: string;
}

export interface ShopConversation {
  id: string;
  guest_phone: string;
  cart_state: string;
  updated_at: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}
