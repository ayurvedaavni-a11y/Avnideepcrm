-- ============================================================
-- AVNIDEEP CRM PRO — Production Audit & Fix Script
-- Run in Supabase SQL Editor. 100% safe to re-run (idempotent).
-- Fixes: missing indexes + table grants + default privileges.
-- Tables / RLS policies / trigger are created by schema.sql.
-- ============================================================

-- ---------- 1. GRANTS (fixes 401/42501 privilege errors) ----------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------- 2. MISSING INDEXES (performance) ----------
create index if not exists idx_profiles_mobile     on public.profiles (mobile);
create index if not exists idx_profiles_role       on public.profiles (role);
create index if not exists idx_crm_customers_mobile on public.crm_customers (mobile);
create index if not exists idx_crm_leads_status    on public.crm_leads (status);
create index if not exists idx_crm_leads_agent     on public.crm_leads (assigned_agent);
create index if not exists idx_crm_orders_status   on public.crm_orders (status);
create index if not exists idx_crm_orders_customer on public.crm_orders (customer_id);
create index if not exists idx_leads_sync_status   on public.leads (sync_status);
create index if not exists idx_followups_status    on public.crm_spacel_followups (status);
create index if not exists idx_followups_scheduled on public.crm_spacel_followups (scheduled_date);

-- ---------- 3. VERIFICATION (run; expected values below) ----------
-- Expected: 17 rows (all CRM tables)
select count(*) as table_count from pg_tables where schemaname = 'public' and tablename like 'crm_%';
select tablename from pg_tables where schemaname = 'public' order by tablename;

-- Expected: 6 RLS policies
select count(*) as policy_count from pg_policies where schemaname = 'public';

-- Expected: 1 trigger on auth.users → public.handle_new_user
select trigger_name, event_object_table from information_schema.triggers
 where trigger_schema = 'public' and trigger_name = 'on_auth_user_created';

-- Expected: 10 indexes just created
select count(*) as index_count from pg_indexes where schemaname = 'public';
