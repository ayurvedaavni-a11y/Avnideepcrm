-- =====================================================================
-- AVNIDEEP CRM PRO — ONLINE MULTI-USER SCHEMA (v1)
-- Run this ENTIRE file in: Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

-- =====================================================================
-- 1. TEAM / AUTH
-- =====================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Telecaller',
  mobile text not null default '',
  role text not null default 'telecaller' check (role in ('admin', 'telecaller')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

-- Auto-create profile row when a new auth user signs up (via Team page metadata)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, mobile, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Telecaller'),
    coalesce(new.raw_user_meta_data ->> 'mobile', ''),
    'telecaller' // role is NEVER taken from client metadata (security)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (public.is_admin());
-- =====================================================================
-- 2. SHARED CRM TABLES (sync between admin + telecallers)
--    Columns match the app's local Dexie fields (snake_case in DB).
--    Dates are TEXT (ISO) for a perfect round-trip with the app.
-- =====================================================================

create table if not exists public.crm_customers (
  id bigserial primary key,
  mobile text not null unique,
  name text not null,
  alternate_number text,
  address text,
  pincode text,
  city text,
  district text,
  state text,
  total_orders numeric not null default 0,
  delivered numeric not null default 0,
  rto numeric not null default 0,
  cancelled numeric not null default 0,
  fake_count numeric not null default 0,
  total_spend numeric not null default 0,
  last_order_date text,
  risk_level text not null default 'Low',
  current_status text not null default 'New Lead',
  created_at text,
  updated_at text
);

create table if not exists public.crm_leads (
  id bigserial primary key,
  customer_id bigint not null default 0,
  product text,
  source text,
  expected_amount numeric not null default 0,
  priority text not null default 'Medium',
  status text not null default 'New Lead',
  assigned_agent text,
  notes text,
  followup_date text,
  followup_time text,
  created_at text,
  updated_at text
);

create table if not exists public.crm_orders (
  id bigserial primary key,
  order_id text not null unique,
  lead_id bigint,
  customer_id bigint not null default 0,
  product text,
  qty numeric not null default 1,
  cod_amount numeric not null default 0,
  courier text,
  tracking_id text,
  status text not null default 'Order Booked',
  order_date text,
  shipment_date text,
  created_at text,
  updated_at text
);
create table if not exists public.crm_spacel_followups (
  id bigserial primary key,
  lead_id bigint not null default 0,
  customer_id bigint not null default 0,
  action text,
  status text not null default 'pending',
  scheduled_date text,
  scheduled_time text,
  completed_at text,
  notes text,
  agent_name text,
  next_followup_date text,
  next_followup_time text,
  created_at text
);

create table if not exists public.crm_timeline_logs (
  id bigserial primary key,
  customer_id bigint not null default 0,
  entity_type text,
  entity_id bigint,
  action text,
  status_from text,
  status_to text,
  notes text,
  agent_name text,
  created_at text
);

create table if not exists public.crm_notifications (
  id bigserial primary key,
  title text,
  message text,
  type text not null default 'info',
  is_read boolean not null default false,
  link_to text,
  created_at text
);

-- =====================================================================
-- 3. ADMIN-ONLY TABLES (desktop admin app; sync added in a later phase)
-- =====================================================================

create table if not exists public.crm_logistics (
  id bigserial primary key,
  order_id bigint not null default 0,
  status text,
  dispatch_date text,
  last_update text,
  created_at text,
  updated_at text
);

create table if not exists public.crm_ndr_cases (
  id bigserial primary key,
  order_id bigint not null default 0,
  customer_id bigint not null default 0,
  reason text,
  status text not null default 'Pending',
  attempt_count numeric not null default 0,
  agent_name text,
  retry_date text,
  next_action text,
  risk_level text not null default 'Medium',
  notes text,
  attempts text,
  created_at text,
  updated_at text
);
create table if not exists public.crm_invoices (
  id bigserial primary key,
  invoice_number text not null unique,
  order_id bigint not null default 0,
  order_number text,
  customer_id bigint not null default 0,
  customer_name text,
  customer_mobile text,
  billing_address text,
  shipping_address text,
  customer_gstin text,
  product text,
  hsn_code text,
  qty numeric not null default 1,
  rate numeric not null default 0,
  discount numeric not null default 0,
  subtotal numeric not null default 0,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  igst numeric not null default 0,
  delivery_charge numeric,
  cod_charge numeric,
  round_off numeric,
  total numeric not null default 0,
  amount_paid numeric,
  balance_due numeric,
  amount_in_words text,
  payment_status text not null default 'Pending',
  place_of_supply text,
  invoice_date text,
  status text not null default 'Draft',
  fulfillment_status text,
  notes text,
  source text,
  created_at text,
  updated_at text
);

create table if not exists public.crm_products (
  id bigserial primary key,
  sku text not null unique,
  name text not null,
  description text,
  hsn_code text,
  category text,
  purchase_price numeric not null default 0,
  selling_price numeric not null default 0,
  gst_rate numeric not null default 0,
  stock_qty numeric not null default 0,
  low_stock_alert numeric not null default 0,
  unit text,
  is_active boolean not null default true,
  created_at text,
  updated_at text
);
create table if not exists public.crm_inventory_logs (
  id bigserial primary key,
  product_id bigint not null default 0,
  change_type text,
  qty_change numeric not null default 0,
  qty_before numeric not null default 0,
  qty_after numeric not null default 0,
  reference text,
  order_id bigint,
  notes text,
  agent_name text,
  created_at text
);

create table if not exists public.crm_invoice_items (
  id bigserial primary key,
  invoice_id bigint not null default 0,
  product_id bigint,
  product_name text,
  hsn_code text,
  qty numeric not null default 1,
  rate numeric not null default 0,
  discount numeric not null default 0,
  gst_rate numeric not null default 0,
  taxable_amount numeric not null default 0,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  igst numeric not null default 0,
  total numeric not null default 0
);

create table if not exists public.crm_payments (
  id bigserial primary key,
  invoice_id bigint not null default 0,
  customer_id bigint not null default 0,
  amount numeric not null default 0,
  method text,
  reference text,
  payment_date text,
  notes text,
  created_at text
);

create table if not exists public.crm_invoice_settings (
  id bigserial primary key,
  key text not null unique,
  value text,
  updated_at text
);

create table if not exists public.crm_shipment_scans (
  id bigserial primary key,
  order_id bigint not null default 0,
  logistics_id bigint not null default 0,
  status text,
  normalized_status text,
  location text,
  remarks text,
  scan_date text,
  source text not null default 'manual',
  created_at text
);

-- =====================================================================
-- 4. LANDING-PAGE INTAKE TABLE (public can INSERT; team reads/updates)
--    Kept from the old sync guide so the landing page keeps working.
-- =====================================================================

create table if not exists public.leads (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  mobile text not null,
  address text,
  city text,
  state text,
  pincode text,
  product text,
  amount numeric,
  payment_mode text default 'COD',
  source text default 'Landing Page',
  sync_status text default 'pending',
  sync_error text,
  created_at timestamptz default timezone('utc'::text, now()),
  synced_at timestamptz
);
alter table public.leads enable row level security;

-- Public insert (landing page form — anon key)
drop policy if exists "Allow public insert" on public.leads;
create policy "Allow public insert" on public.leads
  for insert with check (true);

-- Team members read + update intake leads (replaces the old wide-open policy)
drop policy if exists "Allow CRM access" on public.leads;
drop policy if exists "team intake access" on public.leads;
create policy "team intake access" on public.leads
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- =====================================================================
-- 5. RLS — shared CRM tables (all logged-in team members)
-- =====================================================================

create or replace function public.enable_team_rls(tbl text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('drop policy if exists "team_access" on public.%I', tbl);
  execute format('create policy "team_access" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', tbl);
end;
$$;

select public.enable_team_rls('crm_customers');
select public.enable_team_rls('crm_leads');
select public.enable_team_rls('crm_orders');
select public.enable_team_rls('crm_spacel_followups');
select public.enable_team_rls('crm_timeline_logs');
select public.enable_team_rls('crm_notifications');

-- =====================================================================
-- 6. RLS — admin-only tables
-- =====================================================================

create or replace function public.enable_admin_rls(tbl text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('drop policy if exists "admin_access" on public.%I', tbl);
  execute format('create policy "admin_access" on public.%I for all using (public.is_admin()) with check (public.is_admin())', tbl);
end;
$$;

select public.enable_admin_rls('crm_logistics');
select public.enable_admin_rls('crm_ndr_cases');
select public.enable_admin_rls('crm_invoices');
select public.enable_admin_rls('crm_products');
select public.enable_admin_rls('crm_inventory_logs');
select public.enable_admin_rls('crm_invoice_items');
select public.enable_admin_rls('crm_payments');
select public.enable_admin_rls('crm_invoice_settings');
select public.enable_admin_rls('crm_shipment_scans');

-- =====================================================================
-- 7. REALTIME — live updates for shared tables
-- =====================================================================

alter publication supabase_realtime add table public.crm_customers;
alter publication supabase_realtime add table public.crm_leads;
alter publication supabase_realtime add table public.crm_orders;
alter publication supabase_realtime add table public.crm_spacel_followups;
alter publication supabase_realtime add table public.crm_timeline_logs;
alter publication supabase_realtime add table public.crm_notifications;

-- =====================================================================
-- 8. FIRST ADMIN (run ONCE after creating your first auth user via
--    Dashboard → Authentication → Users → Add user)
--    Replace the email below with <yourMobile>@telecaller.crm
-- =====================================================================
-- update public.profiles
--    set role = 'admin', mobile = '9876543210'
--  where id = (select id from auth.users where email = '9876543210@telecaller.crm');
