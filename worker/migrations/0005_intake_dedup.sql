-- ============================================================================
-- Migration 0005 — intake lead mobile uniqueness (BUGFIX: duplicate leads)
--
-- 1. Marks existing duplicate intake rows (keeps the earliest per mobile).
--    No rows are deleted — duplicates are flagged sync_status='duplicate'
--    and are ignored by /api/intake/pending + processIntakeLeads.
-- 2. Creates a UNIQUE index on leads(mobile) so the database itself
--    rejects new duplicates (defense in depth + ON CONFLICT target).
-- 3. (latent-fix) crm_settings was referenced by the worker
--    (handleSettingsGet/handleSettingsPatch + auto-invoice) but was NEVER
--    created by any migration — every settings API call 500'd in a fresh
--    database. Created here idempotently; existing data untouched.
-- Fully idempotent: safe to re-run on every deploy.
-- ============================================================================

-- Keep the earliest row per mobile; mark the rest (never delete).
UPDATE leads SET sync_status = 'duplicate'
WHERE id NOT IN (SELECT MIN(id) FROM leads GROUP BY mobile);

-- Database-level uniqueness — future INSERTs of the same mobile conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_mobile_unique ON leads(mobile);

-- Latent fix: crm_settings table (worker reads/writes this for
-- commission_rate, auto_invoice, etc.).
CREATE TABLE IF NOT EXISTS crm_settings (
  key        TEXT NOT NULL UNIQUE,
  value      TEXT,
  updated_at TEXT
);
