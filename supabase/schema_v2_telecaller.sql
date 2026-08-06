-- =====================================================================
-- AVNIDEEP CRM PRO — Telecaller CRM v2 (additive, run AFTER schema.sql)
-- 1) New columns on crm_leads (assignment + call tracking + reminders)
-- 2) call_logs table (full call history, never overwritten)
-- 3) Per-telecaller RLS scoping — telecallers see only their own leads
-- Safe to run multiple times (IF NOT EXISTS everywhere).
-- =====================================================================

-- ---------------------------------------------------------------
-- 1) crm_leads: assignment + call tracking + reminder columns
-- ---------------------------------------------------------------
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS reminder_date DATE;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS reminder_time TIME;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS reminder_reason TEXT;

CREATE INDEX IF NOT EXISTS crm_leads_assigned_to_idx ON public.crm_leads(assigned_to);

-- ---------------------------------------------------------------
-- 2) call_logs — complete call history (append-only)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_call_logs (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  customer_id BIGINT,
  telecaller_id TEXT,
  telecaller_name TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT DEFAULT '',
  followup_date DATE,
  followup_time TIME,
  reminder_date DATE,
  reminder_time TIME,
  reminder_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_call_logs_lead_idx ON public.crm_call_logs(lead_id);
CREATE INDEX IF NOT EXISTS crm_call_logs_tc_idx ON public.crm_call_logs(telecaller_id);

-- ---------------------------------------------------------------
-- 3) Row Level Security — per-telecaller scoping
-- Telecaller sees ONLY leads assigned to them (or unassigned pool for admin).
-- Admins see everything.
-- ---------------------------------------------------------------
ALTER TABLE public.crm_call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_telecaller_select ON public.crm_leads;
CREATE POLICY leads_telecaller_select ON public.crm_leads
  FOR SELECT
  USING (
    assigned_to = (SELECT id::text FROM public.profiles WHERE id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS crm_call_logs_telecaller_select ON public.crm_call_logs;
CREATE POLICY crm_call_logs_telecaller_select ON public.crm_call_logs
  FOR SELECT
  USING (
    telecaller_id = (SELECT id::text FROM public.profiles WHERE id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS crm_call_logs_telecaller_insert ON public.crm_call_logs;
CREATE POLICY crm_call_logs_telecaller_insert ON public.crm_call_logs
  FOR INSERT
  WITH CHECK (
    telecaller_id = (SELECT id::text FROM public.profiles WHERE id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- Grant (safe even if roles already granted)
GRANT SELECT, INSERT ON public.crm_call_logs TO authenticated;
GRANT USAGE ON SEQUENCE crm_call_logs_id_seq TO authenticated;
