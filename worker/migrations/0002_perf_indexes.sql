-- =====================================================================
-- Production performance pass — ADDITIVE ONLY, backward compatible.
-- No existing table is altered/dropped; only new indexes + a new
-- tombstone table used by incremental sync.
-- =====================================================================

-- Incremental sync: tracks which cloud rows were deleted so other
-- clients can prune them locally without a full re-pull.
CREATE TABLE IF NOT EXISTS crm_sync_tombstones (
  tbl        TEXT NOT NULL,
  row_id     INTEGER NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tombstones_deleted ON crm_sync_tombstones(deleted_at);

-- Lead assignment / team counters / telecaller pull hot paths.
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned_to ON crm_leads(assigned_to);

-- Duplicate detection + search by mobile.
CREATE INDEX IF NOT EXISTS idx_crm_leads_mobile     ON crm_leads(mobile);
CREATE INDEX IF NOT EXISTS idx_crm_customers_mobile ON crm_customers(mobile);
