// =====================================================================
// apiClient.ts — central client for the Cloudflare D1 Worker backend.
// Replaces supabaseClient.ts. All online calls (auth + sync + intake)
// go through this fetch-based client.
// =====================================================================

// Production API base. `VITE_API_URL` comes from .env / .env.production / CI env.
// Default is the live Cloudflare Worker — NEVER fall back to localhost, otherwise
// a build made without the env var (e.g. Vercel / GitHub Actions) would call
// http://localhost:8787 in production.
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  'https://avnideep-crm-api.ayurvedaavni.workers.dev';

const TOKEN_KEY = 'crm_auth_token';

let token: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

let onUnauthorized: (() => void) | null = null;

/** Called whenever any API request returns 401 (blocked/deleted user, expired JWT). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export function getToken(): string | null {
  return token;
}

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
}

async function request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {} } = opts;
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
  if (auth && token) h.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Internet connection check karein.', 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && auth) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  // ---- auth ----
  login: (mobile: string, pin: string) =>
    request<{ token: string; user: any; profile: any }>('/api/auth/login', {
      method: 'POST',
      body: { mobile, pin },
      auth: false,
    }),
  me: () => request<{ user: any; profile: any }>('/api/auth/me'),
  register: (name: string, mobile: string, pin: string, role: string) =>
    request<{ ok: boolean; userId: string }>('/api/auth/register', {
      method: 'POST',
      body: { name, mobile, pin, role },
    }),
  listTeam: () => request<{ members: any[] }>('/api/auth/team').then((r) => r.members),
  setMember: (id: string, changes: { is_active?: boolean; role?: string; pin?: string; mobile?: string }) =>
    request<{ ok: boolean }>(`/api/auth/member/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: changes,
    }),
  deleteMember: (id: string) =>
    request<{ ok: boolean }>(`/api/auth/member/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  changePin: (currentPin: string, newPin: string) =>
    request<{ ok: boolean }>('/api/auth/change-pin', {
      method: 'POST',
      body: { currentPin, newPin },
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: {} }),

  // ---- lead assignment (admin) ----
  assignLeads: (leadIds: number[], assignToId: string, assignToName: string, reassign?: boolean) =>
    request<{ ok: boolean; assigned: number; total: number }>('/api/leads/assign', {
      method: 'POST',
      body: { leadIds, assignToId, assignToName, reassign: reassign === true },
    }),

  // ---- sync ----
  pushRow: (table: string, row: Record<string, unknown>, conflictKey?: string) =>
    request<{ id: number | string | null }>('/api/sync/push', {
      method: 'POST',
      body: { table, row, conflictKey },
    }),
  deleteRow: (table: string, id: number) =>
    request<{ ok: boolean }>('/api/sync/delete', { method: 'POST', body: { table, id } }),
  pullAll: (tables: string[], opts?: { since?: string; deletedSince?: string }) => {
    let q = `/api/sync/pull?tables=${encodeURIComponent(tables.join(','))}`;
    if (opts?.since) q += `&since=${encodeURIComponent(opts.since)}`;
    if (opts?.deletedSince) q += `&deletedSince=${encodeURIComponent(opts.deletedSince)}`;
    return request<{ rows: Record<string, any[]>; deleted?: Record<string, any[]>; pulledAt?: string }>(q);
  },
  countTable: (table: string) =>
    request<{ count: number }>(`/api/sync/count?table=${encodeURIComponent(table)}`),

  // ---- intake ----
  intakePending: () => request<{ data: any[] }>('/api/intake/pending'),
};
