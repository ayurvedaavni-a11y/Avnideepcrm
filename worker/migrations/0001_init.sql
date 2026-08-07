-- =====================================================================
-- AVNIDEEP CRM PRO — Cloudflare D1 schema (SQLite)
-- Migration: 0001_init.sql
-- Apply with:  wrangler d1 execute avnideep-crm --remote --file=./migrations/0001_init.sql
-- =====================================================================

-- 1. USERS (replaces Supabase Auth + profiles table)
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile     TEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL DEFAULT 'Telecaller',
  role       TEXT NOT NULL DEFAULT 'telecaller' CHECK (role IN ('admin','telecaller')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  pin_hash   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 2. SHARED CRM TABLES (synced between admin + telecallers)
--    Columns match the app's local Dexie fields (snake_case in DB).
--    Dates are TEXT (ISO) for a perfect round-trip with the app.
CREATE TABLE IF NOT EXISTS crm_customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile          TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  alternate_number TEXT,
  address         TEXT,
  pincode         TEXT,
  city            TEXT,
  district        TEXT,
  state           TEXT,
  total_orders    REAL NOT NULL DEFAULT 0,
  delivered       REAL NOT NULL DEFAULT 0,
  rto             REAL NOT NULL DEFAULT 0,
  cancelled       REAL NOT NULL DEFAULT 0,
  fake_count      REAL NOT NULL DEFAULT 0,
  total_spend     REAL NOT NULL DEFAULT 0,
  last_order_date TEXT,
  risk_level      TEXT NOT NULL DEFAULT 'Low',
  current_status  TEXT NOT NULL DEFAULT 'New Lead',
  created_at      TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS crm_leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL DEFAULT 0,
  customer_name  TEXT NOT NULL DEFAULT '',
  mobile         TEXT NOT NULL DEFAULT '',
  product        TEXT,
  source         TEXT,
  expected_amount REAL NOT NULL DEFAULT 0,
  priority       TEXT NOT NULL DEFAULT 'Medium',
  status         TEXT NOT NULL DEFAULT 'New Lead',
  assigned_agent TEXT,
  assigned_to    TEXT,
  notes          TEXT,
  followup_date  TEXT,
  followup_time  TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_customer ON crm_leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads(status);

CREATE TABLE IF NOT EXISTS crm_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL UNIQUE,
  lead_id       INTEGER,
  customer_id   INTEGER NOT NULL DEFAULT 0,
  product       TEXT,
  qty           REAL NOT NULL DEFAULT 1,
  cod_amount    REAL NOT NULL DEFAULT 0,
  courier       TEXT,
  tracking_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'Order Booked',
  order_date    TEXT,
  shipment_date TEXT,
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_orders_customer ON crm_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_orders_status ON crm_orders(status);

CREATE TABLE IF NOT EXISTS crm_spacel_followups (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id            INTEGER NOT NULL DEFAULT 0,
  customer_id        INTEGER NOT NULL DEFAULT 0,
  action             TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  scheduled_date     TEXT,
  scheduled_time     TEXT,
  completed_at       TEXT,
  notes              TEXT,
  agent_name         TEXT,
  next_followup_date TEXT,
  next_followup_time TEXT,
  created_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_spacel_customer ON crm_spacel_followups(customer_id);

CREATE TABLE IF NOT EXISTS crm_timeline_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT,
  entity_id   INTEGER,
  action      TEXT,
  status_from TEXT,
  status_to   TEXT,
  notes       TEXT,
  agent_name  TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_timeline_customer ON crm_timeline_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_timeline_created ON crm_timeline_logs(created_at);

CREATE TABLE IF NOT EXISTS crm_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  message    TEXT,
  type       TEXT NOT NULL DEFAULT 'info',
  is_read    INTEGER NOT NULL DEFAULT 0,
  link_to    TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_notifications_created ON crm_notifications(created_at);

CREATE TABLE IF NOT EXISTS crm_call_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id          INTEGER NOT NULL DEFAULT 0,
  customer_id      INTEGER NOT NULL DEFAULT 0,
  telecaller_id    TEXT,
  telecaller_name  TEXT,
  status           TEXT,
  notes            TEXT,
  followup_date    TEXT,
  followup_time    TEXT,
  reminder_date    TEXT,
  reminder_time    TEXT,
  reminder_reason  TEXT,
  created_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_calllogs_customer ON crm_call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_calllogs_created ON crm_call_logs(created_at);

-- 3. ADMIN-ONLY TABLES (ported from Supabase schema for completeness;
--    sync engine does not use them yet, but they mirror the cloud schema)
CREATE TABLE IF NOT EXISTS crm_logistics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL DEFAULT 0,
  status        TEXT,
  dispatch_date TEXT,
  last_update   TEXT,
  created_at    TEXT,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS crm_ndr_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL DEFAULT 0,
  customer_id   INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending',
  attempt_count REAL NOT NULL DEFAULT 0,
  agent_name    TEXT,
  retry_date    TEXT,
  next_action   TEXT,
  risk_level    TEXT NOT NULL DEFAULT 'Medium',
  notes         TEXT,
  attempts      TEXT,
  created_at    TEXT,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS crm_invoices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number    TEXT NOT NULL UNIQUE,
  order_id          INTEGER NOT NULL DEFAULT 0,
  order_number      TEXT,
  customer_id       INTEGER NOT NULL DEFAULT 0,
  customer_name     TEXT,
  customer_mobile   TEXT,
  billing_address   TEXT,
  shipping_address  TEXT,
  customer_gstin    TEXT,
  product           TEXT,
  hsn_code          TEXT,
  qty               REAL NOT NULL DEFAULT 1,
  rate              REAL NOT NULL DEFAULT 0,
  discount          REAL NOT NULL DEFAULT 0,
  subtotal          REAL NOT NULL DEFAULT 0,
  cgst              REAL NOT NULL DEFAULT 0,
  sgst              REAL NOT NULL DEFAULT 0,
  igst              REAL NOT NULL DEFAULT 0,
  delivery_charge   REAL,
  cod_charge        REAL,
  round_off         REAL,
  total             REAL NOT NULL DEFAULT 0,
  amount_paid       REAL,
  balance_due       REAL,
  amount_in_words   TEXT,
  payment_status    TEXT NOT NULL DEFAULT 'Pending',
  place_of_supply   TEXT,
  invoice_date      TEXT,
  status            TEXT NOT NULL DEFAULT 'Draft',
  fulfillment_status TEXT,
  notes             TEXT,
  source            TEXT,
  created_at        TEXT,
  updated_at        TEXT
);

CREATE TABLE IF NOT EXISTS crm_products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  hsn_code        TEXT,
  category        TEXT,
  purchase_price  REAL NOT NULL DEFAULT 0,
  selling_price   REAL NOT NULL DEFAULT 0,
  gst_rate        REAL NOT NULL DEFAULT 0,
  stock_qty       REAL NOT NULL DEFAULT 0,
  low_stock_alert REAL NOT NULL DEFAULT 0,
  unit            TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS crm_inventory_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL DEFAULT 0,
  change_type TEXT,
  qty_change  REAL NOT NULL DEFAULT 0,
  qty_before  REAL NOT NULL DEFAULT 0,
  qty_after   REAL NOT NULL DEFAULT 0,
  reference   TEXT,
  order_id    INTEGER,
  notes       TEXT,
  agent_name  TEXT,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS crm_invoice_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id     INTEGER NOT NULL DEFAULT 0,
  product_id     INTEGER,
  product_name   TEXT,
  hsn_code       TEXT,
  qty            REAL NOT NULL DEFAULT 1,
  rate           REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  gst_rate       REAL NOT NULL DEFAULT 0,
  taxable_amount REAL NOT NULL DEFAULT 0,
  cgst           REAL NOT NULL DEFAULT 0,
  sgst           REAL NOT NULL DEFAULT 0,
  igst           REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS crm_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL DEFAULT 0,
  customer_id  INTEGER NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  method       TEXT,
  reference    TEXT,
  payment_date TEXT,
  notes        TEXT,
  created_at   TEXT
);

CREATE TABLE IF NOT EXISTS crm_invoice_settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  value      TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS crm_shipment_scans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL DEFAULT 0,
  logistics_id      INTEGER NOT NULL DEFAULT 0,
  status            TEXT,
  normalized_status TEXT,
  location          TEXT,
  remarks           TEXT,
  scan_date         TEXT,
  source            TEXT NOT NULL DEFAULT 'manual',
  created_at        TEXT
);

-- 3b. LOGIN RATE-LIMIT TRACKING (D1-backed — works across all isolates,
--     unlike the old in-memory per-isolate limiter which was bypassable
--     in production because Cloudflare spreads requests across isolates)
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);

-- 4. LANDING-PAGE INTAKE TABLE (public inserts via /api/intake;
--    CRM reads pending rows and converts them)
CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  mobile       TEXT NOT NULL,
  address      TEXT,
  city         TEXT,
  state        TEXT,
  pincode      TEXT,
  product      TEXT,
  amount       REAL,
  payment_mode TEXT DEFAULT 'COD',
  source       TEXT DEFAULT 'Landing Page',
  sync_status  TEXT DEFAULT 'pending',
  sync_error   TEXT,
  created_at   TEXT,
  synced_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_sync_status ON leads(sync_status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
