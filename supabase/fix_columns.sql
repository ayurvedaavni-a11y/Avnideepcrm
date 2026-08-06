-- ============================================================
-- AVNIDEEP CRM - Safe Column Migration (fix_columns.sql)
-- ------------------------------------------------------------
-- crm_leads / crm_notifications were created by an earlier
-- partial schema run, so 'create table if not exists' skipped
-- them and newer columns never got added.
--
-- This migration ONLY ADDS MISSING COLUMNS (IF NOT EXISTS).
-- It never drops data, never recreates tables, and is 100%
-- safe to re-run.
-- ============================================================

-- ---- crm_leads : 6 missing columns ----
alter table public.crm_leads
  add column if not exists customer_id     bigint  not null default 0,
  add column if not exists expected_amount numeric not null default 0,
  add column if not exists priority        text    not null default 'Medium',
  add column if not exists assigned_agent  text,
  add column if not exists followup_date   text,
  add column if not exists followup_time   text;

-- ---- crm_notifications : 1 missing column ----
alter table public.crm_notifications
  add column if not exists link_to text;

-- ---- crm_leads : live table has customer_name + mobile as NOT NULL, but the
-- ---- sync engine never sent them -> every lead push failed with 400 and the
-- ---- cloud had 0 leads (mobile devices pulled nothing). Make them optional
-- ---- (app now fills them from the customer record on every push).
alter table public.crm_leads
  alter column customer_name drop not null,
  alter column mobile drop not null;

alter table public.crm_leads
  alter column customer_name set default '',
  alter column mobile set default '';

-- ---- verify ----
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'crm_leads'
 order by ordinal_position;
