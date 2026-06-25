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
  manual_orders_enabled?: boolean | number;
  qr_ordering_enabled?: boolean | number;
  qr_collect_name?: boolean | number;
  qr_collect_table?: boolean | number;
  qr_slug?: string;
  shop_logo_url?: string;
  shop_logo_filename?: string;
  qr_welcome_message?: string;
  fiscal_enabled?: boolean | number;
  fiscal_api_url?: string;
  fiscal_username?: string;
  fiscal_password?: string;
  fiscal_nuis?: string;
  fiscal_tcr_code?: string;
  fiscal_busun_code?: string;
  fiscal_soft_code?: string;
  fiscal_initial_cash?: number;
  fiscal_default_client?: string;
  fiscal_environment?: 'test' | 'production';
  inventory_enabled?: boolean | number;
  inventory_alert_mode?: 'immediate' | 'daily';
  inventory_alert_time?: string;
  inventory_alert_whatsapp?: boolean | number;
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
  vat_rate?: string;
  item_code?: string;
  unit?: string;
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
  source?: 'whatsapp' | 'manual' | 'qr';
  table_name?: string;
  qr_session?: string;
  payment_type?: string;
  is_paid?: boolean | number;
  paid_at?: string;
  fiscal_status?: 'not_fiscalized' | 'fiscalized' | 'failed' | 'corrected' | 'pending';
  fiscal_iic?: string;
  fiscal_fic?: string;
  fiscal_inv_num?: string;
  fiscal_verify_url?: string;
  fiscal_error?: string;
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
