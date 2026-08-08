-- =====================================================================
-- 0007 — Callback reminder RECIPIENT architecture (creator-based routing)
--
-- Production bugfix: callback reminders were broadcast to Admin + every
-- telecaller, and the push reminder was routed by the lead's assigned_to
-- instead of by the CREATOR.
--
-- This migration makes recipients explicit and server-side:
--   * crm_callback_reminders gets created_by / created_by_role /
--     created_by_name (the user who scheduled it) + recipient_ids
--     (comma-separated user ids the reminder must reach):
--         Telecaller creator -> creator + Admin(s)
--         Admin creator      -> Admin only
--   * crm_notifications gets recipient_user_id so the in-app bell only
--     delivers a reminder notification to its intended recipient(s)
--     (NULL = broadcast row, e.g. lead-assignment alerts).
-- Additive only — touches NO existing data.
-- =====================================================================

ALTER TABLE crm_callback_reminders ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_callback_reminders ADD COLUMN created_by_role TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_callback_reminders ADD COLUMN created_by_name TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_callback_reminders ADD COLUMN recipient_ids TEXT NOT NULL DEFAULT '';

ALTER TABLE crm_notifications ADD COLUMN recipient_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_crm_notifications_recipient ON crm_notifications(recipient_user_id);
