-- =====================================================================
-- Sync performance pass 2 - ADDITIVE ONLY, backward compatible.
-- Two genuinely-used indexes for hot paths that were still doing full table
-- scans on every device:
--   1. crm_spacel_followups(created_at): the incremental pull filters this
--      table by created_at (it has no updated_at column), so without an index
--      every 15s pull on every open device scanned the whole table.
--   2. crm_orders(booked_by): the 2s order-status poll (telecaller path) and
--      the /api/performance commission queries filter by booked_by.
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_crm_spacel_followups_created ON crm_spacel_followups(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_orders_booked_by ON crm_orders(booked_by);
