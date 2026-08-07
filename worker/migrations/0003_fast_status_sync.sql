-- =====================================================================
-- Fast status sync — ADDITIVE ONLY, backward compatible.
-- The incremental pull and the new /api/orders/status endpoint filter by
-- updated_at, so the hottest tables get an index on it. No data is touched.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_crm_orders_updated     ON crm_orders(updated_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_updated      ON crm_leads(updated_at);
CREATE INDEX IF NOT EXISTS idx_crm_customers_updated  ON crm_customers(updated_at);
