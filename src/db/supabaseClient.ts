// Central Supabase client — used by auth, sync engine and realtime.
// Values come from .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Falls back to the built-in project so existing builds keep working.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://vigahmdtvojcnlofdxen.supabase.co';

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZ2FobWR0dm9qY25sb2ZkeGVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc2MTAyMDgsImV4cCI6MjA2MzE4NjIwOH0.2JDO3W3CZr9-PbTX3nVpCECMWg5TjqlPqgVJF25pe9Y';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
