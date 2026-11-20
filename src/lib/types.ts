export type UserRole = "EMPLOYEE" | "OB" | "ADMIN";

export type SessionSlot = "SIANG" | "SORE";
export type SessionStatus = "OPEN" | "SHOPPING" | "COMPLETED";

export type BatchStatus = "COLLECTING" | "CLAIMED" | "QRIS_UPLOADED" | "COMPLETED";

export type PaymentMethod = "QRIS" | "CASH";
export type PaymentStatus =
  | "UNPAID"
  | "WAITING_PAYMENT"
  | "PROOF_UPLOADED"
  | "PAID"
  | "CANCELLED";

export type DeliveryStatus = "PENDING" | "BOUGHT" | "DELIVERED" | "UNAVAILABLE";

export type ObLocationStatus = "ON_THE_WAY" | "AT_MERCHANT" | "RETURNING" | "OFFLINE";

export interface ObLocationInfo {
  ob_id: number;
  ob_name: string;
  ob_username: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  current_merchant_name: string;
  status_label: ObLocationStatus;
  is_sharing: number;
  updated_at: string | null;
  active_merchants: string[];
}

export interface PhoneChangeRequest {
  id: number;
  user_id: number;
  user_name?: string;
  user_username?: string;
  user_role?: UserRole;
  old_whatsapp: string;
  new_whatsapp: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface UserProfile {
  id: number;
  name: string;
  username: string;
  division: string;
  whatsapp: string;
  role: UserRole;
  created_at?: string;
  latest_phone_request?: PhoneChangeRequest | null;
}

export interface OrderSession {
  id: number;
  session_date: string;
  slot: SessionSlot;
  label: string;
  open_time: string;
  close_time: string;
  status: SessionStatus;
  manual_override: number;
  is_within_schedule?: boolean;
  can_order?: boolean;
  order_count?: number;
  batch_count?: number;
}

export interface MenuItem {
  id: number;
  merchant_id: number;
  name: string;
  estimated_price: number;
  is_active: number;
}

export interface Merchant {
  id: number;
  name: string;
  category: string;
  location_note: string;
  default_qris_image: string | null;
  is_active: number;
  menu_items: MenuItem[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number | null;
  item_name: string;
  qty: number;
  unit_price: number;
  actual_unit_price: number | null;
  item_note: string;
  is_unavailable: number;
}

export interface OrderRecord {
  id: number;
  session_id: number;
  batch_id: number;
  user_id: number;
  user_name?: string;
  user_division?: string;
  user_whatsapp?: string;
  merchant_name?: string;
  batch_status?: BatchStatus;
  batch_qris_image_url?: string | null;
  batch_receipt_image_url?: string | null;
  batch_ob_note?: string;
  assigned_ob_id?: number | null;
  assigned_ob_name?: string | null;
  session_label?: string;
  session_slot?: SessionSlot;
  payment_method: PaymentMethod;
  estimated_total: number;
  actual_total: number | null;
  max_budget: number | null;
  effective_total: number;
  payment_status: PaymentStatus;
  delivery_status: DeliveryStatus;
  payment_proof_url: string | null;
  payment_reject_reason: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

export interface MerchantBatch {
  id: number;
  session_id: number;
  merchant_id: number | null;
  merchant_name: string;
  merchant_default_qris?: string | null;
  assigned_ob_id: number | null;
  assigned_ob_name: string | null;
  qris_image_url: string | null;
  receipt_image_url: string | null;
  ob_note: string;
  status: BatchStatus;
  updated_at: string;
  orders: OrderRecord[];
  summary: {
    order_count: number;
    qris_total: number;
    qris_paid: number;
    cash_total: number;
    cash_paid: number;
    grand_total: number;
    pending_verification_count: number;
    unpaid_count: number;
  };
}
