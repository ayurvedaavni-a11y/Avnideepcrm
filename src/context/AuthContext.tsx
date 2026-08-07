// AuthContext — provides the logged-in team member (session + role) to the whole app.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getToken, setUnauthorizedHandler } from '../db/apiClient';
import { fetchProfile, loginWithMobilePin, logout as signOut } from '../db/auth';
import type { TeamProfile, TeamRole } from '../db/auth';

interface AuthState {
  loading: boolean;
  user: any | null;
  profile: TeamProfile | null;
  isAdmin: boolean;
  login: (mobile: string, pin: string, expectedRole?: TeamRole) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  user: null,
  profile: null,
  isAdmin: false,
  login: async () => ({ ok: false, error: 'Not ready' }),
  logout: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<TeamProfile | null>(null);

  // Any 401 (blocked/deleted user, expired JWT) instantly logs out the UI.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setProfile(null);
      try { sessionStorage.removeItem('crm:post-login'); } catch { /* noop */ }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Session restore: the JWT is stored in localStorage. /api/auth/me
  // validates it and returns the profile (invalid tokens are cleared).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (getToken()) {
          const p = await fetchProfile();
          if (!mounted) return;
          if (p) {
            setUser({ id: p.id, email: `${p.mobile}@crm.local` });
            setProfile(p);
          }
        }
      } catch (e) {
        console.error('[Auth] session restore failed:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (mobile: string, pin: string, expectedRole?: TeamRole) => {
    const res = await loginWithMobilePin(mobile, pin);
    if (!res.ok || !res.profile) {
      return { ok: false, error: res.error || 'Login fail hua. Admin se contact karein.' };
    }
    // Role verification — enforce the login entry point chosen on the login screen
    if (expectedRole && res.profile.role !== expectedRole) {
      try { await signOut(); } catch (e) { console.error('[Auth] role mismatch signOut failed:', e); }
      const actualLabel = res.profile.role === 'admin' ? 'Admin' : 'Telecaller';
      const expectedLabel = expectedRole === 'admin' ? 'Admin' : 'Telecaller';
      return {
        ok: false,
        error: `Ye account ${actualLabel} account hai. ${expectedLabel} Login se login nahi ho sakta — ${actualLabel} Login use karein.`,
      };
    }
    setProfile(res.profile);
    setUser(res.user ?? null);
    // Signal that a fresh login just happened — the router (which mounts only
    // now) uses this to land on the role's default page instead of whatever
    // hash was left in the URL (e.g. never auto-open Team Management).
    try { sessionStorage.setItem('crm:post-login', '1'); } catch { /* noop */ }
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    try { await signOut(); } catch (e) { console.error(e); }
    setUser(null);
    setProfile(null);
    // Wipe all temporary session state (redirect intent, search flags, caches)
    // so nothing from the previous session leaks into the next login.
    try {
      sessionStorage.removeItem('crm:post-login');
      localStorage.removeItem('crm_team_cache');
    } catch { /* storage unavailable */ }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const p = await fetchProfile(user.id);
    setProfile(p);
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user,
      profile,
      isAdmin: profile?.role === 'admin',
      login,
      logout,
      refreshProfile,
    }),
    [loading, user, profile, login, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
