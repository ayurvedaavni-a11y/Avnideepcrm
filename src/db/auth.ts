// src/db/auth.ts — Phone + PIN authentication on the Cloudflare D1 Worker.
// Same public API as before (loginWithMobilePin, fetchProfile, logout,
// createTeamMember, listTeamMembers, setMemberActive, setMemberRole,
// changePin) so pages and AuthContext keep working unchanged.
import { api, setToken } from './apiClient';

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

export function friendlyAuthError(error: any): string {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();
  if (lower.includes('galat') || lower.includes('invalid login')) return 'Wrong mobile number or PIN. Please try again.';
  if (lower.includes('account active nahi')) return 'Account is not active. Please contact the admin.';
  if (lower.includes('bahut saare') || lower.includes('rate limit') || lower.includes('too many')) return 'Too many attempts — please try again in a while.';
  if (lower.includes('pehle se maujood') || lower.includes('already registered')) return 'An account already exists for this mobile number.';
  if (lower.includes('unauthorized') || lower.includes('session expire') || msg.includes('401')) return 'Session expired — please log in again.';
  if (lower.includes('internet') || lower.includes('network') || lower.includes('failed to fetch')) return 'Please check your internet connection.';
  return msg;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  profile?: TeamProfile;
  user?: any;
}

export async function loginWithMobilePin(mobile: string, pin: string): Promise<LoginResult> {
  try {
    const res = await api.login(normalizeMobile(mobile), pin.trim());
    setToken(res.token);
    return { ok: true, profile: res.profile, user: res.user };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

/** Restore the current user's profile from the stored JWT (via /api/auth/me). */
export async function fetchProfile(_userId?: string | null): Promise<TeamProfile | null> {
  try {
    const me = await api.me();
    return me.profile;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    /* offline or worker down — token is cleared regardless */
  } finally {
    setToken(null);
  }
}

/** Create a team member (admin only — Team page). */
export async function createTeamMember(
  name: string,
  mobile: string,
  pin: string,
  role: TeamRole
): Promise<{ ok: boolean; error?: string; userId?: string }> {
  try {
    const res = await api.register(name, normalizeMobile(mobile), pin.trim(), role);
    clearTeamCache(); // force a fresh team list next time
    return { ok: true, userId: res.userId };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

/** localStorage cache of the team list — lets Lead Center / assignment work
 *  even when the Worker is unreachable (offline / brief network failure).
 *  Refreshed on every successful fetch; invalidated on member mutations.
 *  Expires after 7 days so deleted/renamed members don't linger forever. */
const TEAM_CACHE_KEY = 'crm_team_cache';
const TEAM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TeamCacheEntry {
  cachedAt: number;
  members: TeamProfile[];
}

function readTeamCache(): TeamProfile[] {
  try {
    const raw = localStorage.getItem(TEAM_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TeamCacheEntry;
    if (!parsed || !Array.isArray(parsed.members)) return [];
    if (Date.now() - parsed.cachedAt > TEAM_CACHE_TTL_MS) return [];
    return parsed.members;
  } catch {
    return [];
  }
}

function writeTeamCache(members: TeamProfile[]) {
  try {
    localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), members }));
  } catch {
    /* storage full / disabled — cache is best-effort */
  }
}

export function clearTeamCache(): void {
  try {
    localStorage.removeItem(TEAM_CACHE_KEY);
  } catch {
    /* noop */
  }
}

export async function listTeamMembers(): Promise<TeamProfile[]> {
  try {
    const members = (await api.listTeam()) as TeamProfile[];
    writeTeamCache(members);
    return members;
  } catch {
    // Worker unreachable — fall back to the last known team list so the
    // admin can still assign leads to telecallers offline.
    return readTeamCache();
  }
}

export async function setMemberActive(id: string, isActive: boolean) {
  try {
    await api.setMember(id, { is_active: isActive });
    clearTeamCache();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

export async function deleteMember(id: string, force = false) {
  try {
    const res = await api.deleteMember(id, force);
    clearTeamCache();
    return { ok: true, unassignedLeads: res?.unassignedLeads };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

export async function setMemberRole(id: string, role: TeamRole) {
  try {
    await api.setMember(id, { role });
    clearTeamCache();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

/** Admin resets another member's login PIN (no current-PIN check needed). */
export async function resetMemberPin(id: string, newPin: string): Promise<{ ok: boolean; error?: string }> {
  const pin = newPin.trim();
  if (!/^\d{6,8}$/.test(pin)) {
    return { ok: false, error: 'PIN must be 6-8 digits' };
  }
  try {
    await api.setMember(id, { pin });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

/** Change own PIN (verify current PIN first, then set new one). */
export async function changePin(currentPin: string, newPin: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.changePin(currentPin, newPin);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}
