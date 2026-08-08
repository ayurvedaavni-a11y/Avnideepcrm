-- =====================================================================
-- 0006 — Web Push callback reminders (real OS-level device notifications)
--
-- Production fix: previously follow-up/callback reminders only showed an
-- in-app popup polled by a 5-second setInterval (tab must be open, and no
-- OS notification ever fired in a browser/PWA — only the Electron build
-- routed to the OS). This migration adds:
--   * crm_push_subscriptions  — one row per (user, device/browser)
--   * crm_callback_reminders  — one row per lead; server cron fires a real
--                               Web Push at remind_at (works app-closed)
-- Additive only — touches NO existing tables / data.
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_push_subs_user ON crm_push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS crm_callback_reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  customer_id   INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL DEFAULT '',
  product       TEXT,
  lead_status   TEXT NOT NULL DEFAULT '',
  followup_date TEXT,
  followup_time TEXT,
  remind_at     TEXT NOT NULL,                       -- ISO 8601 UTC
  status        TEXT NOT NULL DEFAULT 'pending',     -- pending | sent | failed | cancelled
  retry_count   INTEGER NOT NULL DEFAULT 0,
  fired_at      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT,
  UNIQUE(lead_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_reminders_due ON crm_callback_reminders(status, remind_at);
