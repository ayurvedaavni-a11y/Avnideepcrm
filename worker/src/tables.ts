// =====================================================================
// Table definitions shared by the sync + intake handlers.
// Each table lists the writable columns (whitelist — anything else sent
// by the app is dropped) plus optional upsert conflict keys.
// =====================================================================

export interface TableDef {
  /** Column used for upserts when the app doesn't send an id (dedup). */
  dedup?: string;
  /** SQLite INTEGER columns that should surface as booleans to the app. */
  booleans?: string[];
  columns: string[];
}

export const TABLES: Record<string, TableDef> = {
  // ---- shared synced tables (in pull order: parents first) ----
  crm_customers: {
    dedup: 'mobile',
    columns: [
      'mobile', 'name', 'alternate_number', 'address', 'pincode', 'city',
      'district', 'state', 'total_orders', 'delivered', 'rto', 'cancelled',
      'fake_count', 'total_spend', 'last_order_date', 'risk_level',
      'current_status', 'created_at', 'updated_at',
    ],
  },
  crm_leads: {
    columns: [
      'customer_id', 'customer_name', 'mobile', 'product', 'source',
      'expected_amount', 'priority', 'status', 'assigned_agent', 'assigned_to',
      'notes', 'followup_date', 'followup_time', 'created_at', 'updated_at',
    ],
  },
  crm_orders: {
    dedup: 'order_id',
    columns: [
      'order_id', 'lead_id', 'customer_id', 'product', 'qty', 'cod_amount',
      'courier', 'tracking_id', 'status', 'order_date', 'shipment_date',
      'booked_by', 'booked_by_name', 'delivered_at', 'created_at', 'updated_at',
    ],
  },
  crm_spacel_followups: {
    columns: [
      'lead_id', 'customer_id', 'action', 'status', 'scheduled_date',
      'scheduled_time', 'completed_at', 'notes', 'agent_name',
      'next_followup_date', 'next_followup_time', 'created_at',
    ],
  },
  crm_timeline_logs: {
    columns: [
      'customer_id', 'entity_type', 'entity_id', 'action', 'status_from',
      'status_to', 'notes', 'agent_name', 'created_at',
    ],
  },
  crm_notifications: {
    booleans: ['is_read'],
    columns: ['title', 'message', 'type', 'is_read', 'link_to', 'created_at'],
  },
  crm_call_logs: {
    columns: [
      'lead_id', 'customer_id', 'telecaller_id', 'telecaller_name', 'status',
      'notes', 'followup_date', 'followup_time', 'reminder_date',
      'reminder_time', 'reminder_reason', 'duration_sec', 'created_at',
    ],
  },
  // ---- key/value settings (commission rate etc.) ----
  crm_settings: {
    dedup: 'key',
    columns: ['key', 'value', 'updated_at'],
  },
  // ---- admin-only tables (ported for completeness) ----
  crm_logistics: {
    columns: ['order_id', 'status', 'dispatch_date', 'last_update', 'created_at', 'updated_at'],
  },
  crm_ndr_cases: {
    columns: [
      'order_id', 'customer_id', 'reason', 'status', 'attempt_count',
      'agent_name', 'retry_date', 'next_action', 'risk_level', 'notes',
      'attempts', 'created_at', 'updated_at',
    ],
  },
  crm_invoices: {
    dedup: 'invoice_number',
    columns: [
      'invoice_number', 'order_id', 'order_number', 'customer_id',
      'customer_name', 'customer_mobile', 'billing_address', 'shipping_address',
      'customer_gstin', 'product', 'hsn_code', 'qty', 'rate', 'discount',
      'subtotal', 'cgst', 'sgst', 'igst', 'delivery_charge', 'cod_charge',
      'round_off', 'total', 'amount_paid', 'balance_due', 'amount_in_words',
      'payment_status', 'place_of_supply', 'invoice_date', 'status',
      'fulfillment_status', 'notes', 'source', 'created_at', 'updated_at',
    ],
  },
  crm_products: {
    dedup: 'sku',
    booleans: ['is_active'],
    columns: [
      'sku', 'name', 'description', 'hsn_code', 'category', 'purchase_price',
      'selling_price', 'gst_rate', 'stock_qty', 'low_stock_alert', 'unit',
      'is_active', 'created_at', 'updated_at',
    ],
  },
  crm_inventory_logs: {
    columns: [
      'product_id', 'change_type', 'qty_change', 'qty_before', 'qty_after',
      'reference', 'order_id', 'notes', 'agent_name', 'created_at',
    ],
  },
  crm_invoice_items: {
    columns: [
      'invoice_id', 'product_id', 'product_name', 'hsn_code', 'qty', 'rate',
      'discount', 'gst_rate', 'taxable_amount', 'cgst', 'sgst', 'igst', 'total',
    ],
  },
  crm_payments: {
    columns: ['invoice_id', 'customer_id', 'amount', 'method', 'reference', 'payment_date', 'notes', 'created_at'],
  },
  crm_invoice_settings: {
    dedup: 'key',
    columns: ['key', 'value', 'updated_at'],
  },
  crm_shipment_scans: {
    columns: [
      'order_id', 'logistics_id', 'status', 'normalized_status', 'location',
      'remarks', 'scan_date', 'source', 'created_at',
    ],
  },
  // ---- landing-page intake ----
  leads: {
    columns: [
      'name', 'mobile', 'address', 'city', 'state', 'pincode', 'product',
      'amount', 'payment_mode', 'source', 'sync_status', 'sync_error',
      'created_at', 'synced_at',
    ],
  },
};

/** The 7 tables the CRM sync engine actually pushes/pulls. */
export const SYNC_TABLE_NAMES = [
  'crm_customers',
  'crm_leads',
  'crm_orders',
  'crm_spacel_followups',
  'crm_timeline_logs',
  'crm_notifications',
  'crm_call_logs',
];
