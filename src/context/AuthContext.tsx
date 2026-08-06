// AuthContext — provides the logged-in team member (session + role) to the whole app.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../db/supabaseClient';
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session && mounted) {
          setUser(data.session.user);
          const p = await fetchProfile(data.session.user.id);
          if (mounted) setProfile(p);
        }
      } catch (e) {
        console.error('[Auth] session restore failed:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) setProfile(null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
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
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    try { await signOut(); } catch (e) { console.error(e); }
    setUser(null);
    setProfile(null);
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
