-- =====================================================================
-- AVNIDEEP CRM PRO — SECURITY-FIRST Production Audit & Fix
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- SECURITY PRINCIPLES:
--   * Row Level Security (RLS) is the PRIMARY protection.
--   * Least privilege grants only — NO "GRANT ALL ON ALL TABLES".
--   * anon can ONLY INSERT into public.leads (landing-page form).
--   * anon has NO read/update/delete on any internal CRM table.
--   * authenticated (logged-in team member) gets table-level DML;
--     RLS policies then enforce row-level + admin-only access.
--   * Nothing is dropped; no data is modified.
-- =====================================================================

-- ---------- 1. REVOKE over-broad grants (security hardening) ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
revoke all on all routines in schema public from authenticated;

-- ---------- 2. LEAST-PRIVILEGE GRANTS ----------
-- Schema usage is required before any object access.
grant usage on schema public to anon, authenticated;

-- LANDING PAGE: anon can ONLY insert into public.leads (public form).
-- No select / update / delete / sequence access for anon anywhere.
grant insert on public.leads to anon;

-- TEAM MEMBERS (authenticated): profiles — own row select + admin update
grant select, update on public.profiles to authenticated;

-- SHARED CRM TABLES: all team members (RLS 'team_access' filters rows)
grant select, insert, update, delete on public.crm_customers to authenticated;
grant select, insert, update, delete on public.crm_leads to authenticated;
grant select, insert, update, delete on public.crm_orders to authenticated;
grant select, insert, update, delete on public.crm_spacel_followups to authenticated;
grant select, insert, update, delete on public.crm_timeline_logs to authenticated;
grant select, insert, update, delete on public.crm_notifications to authenticated;
grant select, insert, update, delete on public.leads to authenticated;

-- ADMIN-ONLY TABLES: table-level grant to authenticated is required so
-- admin users (is_admin() = true) can operate; RLS 'admin_access'
-- policy BLOCKS every non-admin row/statement on these tables.
grant select, insert, update, delete on public.crm_logistics to authenticated;
grant select, insert, update, delete on public.crm_ndr_cases to authenticated;
grant select, insert, update, delete on public.crm_invoices to authenticated;
grant select, insert, update, delete on public.crm_products to authenticated;
grant select, insert, update, delete on public.crm_inventory_logs to authenticated;
grant select, insert, update, delete on public.crm_invoice_items to authenticated;
grant select, insert, update, delete on public.crm_payments to authenticated;
grant select, insert, update, delete on public.crm_invoice_settings to authenticated;
grant select, insert, update, delete on public.crm_shipment_scans to authenticated;

-- Sequences (bigserial columns) for team-member inserts
grant usage on all sequences in schema public to authenticated;

-- ---------- 3. MISSING INDEXES (performance, non-destructive) ----------
create index if not exists idx_profiles_mobile      on public.profiles (mobile);
create index if not exists idx_profiles_role        on public.profiles (role);
create index if not exists idx_crm_customers_mobile on public.crm_customers (mobile);
create index if not exists idx_crm_leads_status     on public.crm_leads (status);
create index if not exists idx_crm_leads_agent      on public.crm_leads (assigned_agent);
create index if not exists idx_crm_orders_status    on public.crm_orders (status);
create index if not exists idx_crm_orders_customer  on public.crm_orders (customer_id);
create index if not exists idx_leads_sync_status    on public.leads (sync_status);
create index if not exists idx_followups_status     on public.crm_spacel_followups (status);
create index if not exists idx_followups_scheduled  on public.crm_spacel_followups (scheduled_date);

-- ---------- 4. VERIFICATION (run; expected values below) ----------
-- Tables: 17 expected (profiles + 15 crm_* + leads)
select count(*) as table_count from pg_tables where schemaname = 'public' and (tablename like 'crm_%' or tablename in ('profiles','leads'));

-- RLS: every table must be listed here (rlsstatus = ON)
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

-- Policies: 6+1+2 = profiles(2) + leads(2) + 6 team + 9 admin = 19 expected
select count(*) as policy_count from pg_policies where schemaname = 'public';

-- Trigger
select trigger_name, event_object_table from information_schema.triggers
 where trigger_schema = 'public' and trigger_name = 'on_auth_user_created';

-- Indexes: 10 just created + PK indexes
select count(*) as index_count from pg_indexes where schemaname = 'public';

-- Grants check — anon must have ONLY: USAGE(schema) + INSERT(leads)
select grantee, table_name, privilege_type
  from information_schema.table_privileges
 where grantee = 'anon' order by table_name, privilege_type;
