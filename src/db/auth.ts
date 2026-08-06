// src/db/auth.ts — Phone + PIN authentication on top of Supabase Auth.
// Each team member logs in with a mobile number + PIN. The PIN is the
// Supabase Auth password of a synthetic email account (<mobile>@telecaller.in).
import { supabase } from './supabaseClient';

export type TeamRole = 'admin' | 'telecaller';

export interface TeamProfile {
  id: string;
  full_name: string;
  mobile: string;
  role: TeamRole;
  is_active: boolean;
  created_at: string;
}

/** Normalize a mobile number to digits only (strips +91, spaces, dashes). */
export function normalizeMobile(mobile: string): string {
  let digits = (mobile || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

/**
 * Synthetic email that maps a mobile number onto Supabase Auth.
 *
 * NOTE: `.crm` is NOT a valid TLD — newer Supabase email validation rejects
 * `@telecaller.crm` signups with `email_address_invalid`. New accounts now use
 * `@telecaller.in` (valid TLD). Existing accounts created on the legacy
 * `@telecaller.crm` domain still work via the fallback in loginWithMobilePin.
 */
export const EMAIL_DOMAIN = 'telecaller.in';
export const LEGACY_EMAIL_DOMAIN = 'telecaller.crm';

export function emailForMobile(mobile: string): string {
  return `${normalizeMobile(mobile)}@${EMAIL_DOMAIN}`;
}

export function legacyEmailForMobile(mobile: string): string {
  return `${normalizeMobile(mobile)}@${LEGACY_EMAIL_DOMAIN}`;
}

export function friendlyAuthError(error: any): string {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Mobile number ya PIN galat hai. Dobara try karein.';
  if (lower.includes('email not confirmed')) return 'Account abhi confirm nahi hua. Admin se contact karein.';
  if (lower.includes('user already registered')) return 'Is mobile number ka account pehle se maujood hai.';
  if (lower.includes('signup') && lower.includes('disabled')) return 'Naye signup abhi band hain. Supabase mein Email signup enable karein.';
  if (lower.includes('rate limit') || lower.includes('too many')) return 'Bahut saare attempts — thodi der baad try karein.';
  if (lower.includes('network') || lower.includes('fetch')) return 'Internet connection check karein.';
  return msg;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  profile?: TeamProfile;
  user?: any;
}

export async function loginWithMobilePin(mobile: string, pin: string): Promise<LoginResult> {
  // Try the current domain first, then fall back to the legacy `.crm` domain
  // so accounts created before the domain fix keep working.
  const candidates = [emailForMobile(mobile), legacyEmailForMobile(mobile)];
  let lastError: any = null;
  let data: any = null;
  let error: any = null;
  for (const email of candidates) {
    const attempt = await supabase.auth.signInWithPassword({ email, password: pin.trim() });
    if (!attempt.error && attempt.data?.user) {
      data = attempt.data;
      error = null;
      break;
    }
    lastError = attempt.error;
  }
  if (error || !data?.user) {
    return { ok: false, error: friendlyAuthError(lastError) };
  }
  const profile = await fetchProfile(data.user.id);
  if (!profile) {
    return { ok: false, error: 'Account profile nahi mila. Admin se contact karein.' };
  }
  if (!profile.is_active) {
    return { ok: false, error: 'Account active nahi hai. Admin se contact karein.' };
  }
  return { ok: true, profile, user: data.user };
}

export async function fetchProfile(userId?: string | null): Promise<TeamProfile | null> {
  let uid = userId;
  if (!uid) {
    const { data } = await supabase.auth.getUser();
    uid = data.user?.id;
  }
  if (!uid) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error || !data) return null;
  return data as TeamProfile;
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

/** Create a team member (admin only — Team page). SignUp metadata drives the DB trigger. */
export async function createTeamMember(
  name: string,
  mobile: string,
  pin: string,
  role: TeamRole
): Promise<{ ok: boolean; error?: string; userId?: string }> {
  const normMobile = normalizeMobile(mobile);
  const { data, error } = await supabase.auth.signUp({
    email: emailForMobile(normMobile),
    password: pin.trim(),
    options: { data: { full_name: name, mobile: normMobile, role } },
  });
  if (error) return { ok: false, error: friendlyAuthError(error) };
  return { ok: true, userId: data.user?.id };
}

export async function listTeamMembers(): Promise<TeamProfile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as TeamProfile[];
}

export async function setMemberActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', id);
  return { ok: !error, error: error?.message };
}

export async function setMemberRole(id: string, role: TeamRole) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
  return { ok: !error, error: error?.message };
}

/** Change own PIN (verify current PIN first, then set new one). */
export async function changePin(currentPin: string, newPin: string): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user?.email;
  if (!email) return { ok: false, error: 'Session nahi mila — login karein.' };
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPin.trim() });
  if (verifyError) return { ok: false, error: 'Current PIN galat hai.' };
  const { error } = await supabase.auth.updateUser({ password: newPin.trim() });
  if (error) return { ok: false, error: friendlyAuthError(error) };
  return { ok: true };
}
