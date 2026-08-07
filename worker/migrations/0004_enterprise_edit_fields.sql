-- =====================================================================
-- Enterprise edit-permission upgrade — ADDITIVE ONLY, backward compatible.
-- Adds the fields the order-booking form / admin order edit persist so
-- "sab fields D1 me save hon". No existing data is altered or dropped.
-- =====================================================================

-- Customer: landmark (nearby location) + notes (customer remark)
ALTER TABLE crm_customers ADD COLUMN landmark TEXT;
ALTER TABLE crm_customers ADD COLUMN notes TEXT;

-- Order: pricing breakdown + payment mode + instructions/remarks
ALTER TABLE crm_orders ADD COLUMN discount REAL DEFAULT 0;
ALTER TABLE crm_orders ADD COLUMN delivery_charge REAL DEFAULT 0;
ALTER TABLE crm_orders ADD COLUMN cod_charge REAL DEFAULT 0;
ALTER TABLE crm_orders ADD COLUMN payment_mode TEXT DEFAULT 'COD';
ALTER TABLE crm_orders ADD COLUMN special_instructions TEXT;
ALTER TABLE crm_orders ADD COLUMN order_notes TEXT;
