// =====================================================================
// AVNIDEEP CRM PRO — Cloudflare Worker API (D1 backend)
//
// Endpoints:
//   POST /api/auth/bootstrap      create first admin (one-time, key guarded)
//   POST /api/auth/login          mobile + PIN -> JWT
//   POST /api/auth/register       admin creates a team member
//   GET  /api/auth/me             restore session from JWT
//   GET  /api/auth/team           admin lists members
//   PATCH /api/auth/member/:id    admin updates is_active / role
//   POST /api/auth/change-pin     change own PIN
//   POST /api/auth/logout         no-op (stateless JWT)
//   POST /api/sync/push           upsert/insert a row, returns cloud id
//   POST /api/sync/delete         delete a row by cloud id
//   GET  /api/sync/pull?tables=   full pull (or selected tables)
//   GET  /api/sync/count?table=   row count
//   POST /api/intake              landing-page lead insert (public, key guarded)
//   GET  /api/intake/pending      CRM picks up pending landing-page leads
// =====================================================================
import { TABLES, SYNC_TABLE_NAMES, TableDef } from './tables';
import { hashPin, verifyPin, signJwt, verifyJwt } from './auth';

export interface Env {
  DB: D1Database;
  AUTH_SECRET: string;
  BOOTSTRAP_KEY: string;
  INTAKE_KEY: string;
  PBKDF2_ITERATIONS?: string;
  ALLOWED_ORIGINS?: string;
}

/** Tables whose `id` column is TEXT (leads uses crypto.randomUUID()). */
const TEXT_ID_TABLES = new Set(['leads']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Intake-Key',
  'Access-Control-Max-Age': '86400',
};

/**
 * Per-request CORS. Default = allow all (safe here because auth is a
 * bearer token in origin-scoped localStorage — no ambient cookies).
 * Set ALLOWED_ORIGINS (comma-separated) to lock down to specific web
 * origins; `null` (Electron file://) and same-origin are always allowed.
 */
function corsHeaders(env: Env, request: Request): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : ['*'];
  if (allowed[0] === '*') return CORS_HEADERS;
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null' || allowed.includes(origin)) {
    return { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin ?? 'null' };
  }
  return {}; // disallowed origin → caller returns 403 without CORS headers
}

const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const DEFAULT_PBKDF2_ITERATIONS = 15000;

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    return (await request.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

function normalizeMobile(mobile: unknown): string {
  let digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

// Simple in-memory sliding-window rate limiter (per isolate).
// Good enough for a small team; upgrade to the `ratelimit` binding if needed.
const buckets = new Map<string, { count: number; resetAt: number }>();
function isLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    if (buckets.size > 5000) buckets.clear(); // crude memory guard
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > limit;
}

function profileOf(row: Record<string, any>) {
  return {
    id: String(row.id),
    full_name: row.full_name,
    mobile: row.mobile,
    role: row.role,
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: row.created_at,
  };
}

async function currentUser(env: Env, request: Request): Promise<Record<string, any> | null> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const payload = await verifyJwt(token, env.AUTH_SECRET);
  if (!payload || !payload.sub) return null;
  const row = await env.DB.prepare(
    'SELECT id, mobile, full_name, role, is_active, created_at FROM users WHERE id = ?'
  )
    .bind(Number(payload.sub))
    .first();
  if (!row || !row.is_active) return null;
  return profileOf(row as Record<string, any>);
}

function requireAuth(user: Record<string, any> | null): Response | null {
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return null;
}

function requireAdmin(user: Record<string, any> | null): Response | null {
  const err = requireAuth(user);
  if (err) return err;
  if (user!.role !== 'admin') return json({ error: 'Forbidden — admin only' }, 403);
  return null;
}

/** Team members may only touch the shared sync tables (+ intake `leads`);
 *  admin-only tables (invoices, products, payments, …) stay admin-only. */
function canAccessTable(user: Record<string, any> | null, table: string): boolean {
  return user?.role === 'admin' || [...SYNC_TABLE_NAMES, 'leads'].includes(table);
}

function pbkdf2Iters(env: Env): number {
  const iters = Number(env.PBKDF2_ITERATIONS) || DEFAULT_PBKDF2_ITERATIONS;
  return Math.min(Math.max(iters, 1000), 100000);
}

// ---------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------
async function handleBootstrap(env: Env, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!env.BOOTSTRAP_KEY || body.key !== env.BOOTSTRAP_KEY) {
    return json({ error: 'Forbidden' }, 403);
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (Number((count as any)?.c) > 0) return json({ error: 'Already bootstrapped' }, 409);

  const mobile = normalizeMobile(body.mobile);
  const pin = String(body.pin || '').trim();
  if (!/^\d{10}$/.test(mobile)) return json({ error: 'Invalid mobile number' }, 400);
  if (pin.length < 4 || pin.length > 8) return json({ error: 'PIN 4-8 digits' }, 400);

  const iters = pbkdf2Iters(env);
  const pinHash = await hashPin(pin, iters);
  const res = await env.DB.prepare(
    'INSERT INTO users (mobile, full_name, role, is_active, pin_hash, created_at) VALUES (?, ?, ?, 1, ?, ?)'
  )
    .bind(mobile, String(body.name || 'Admin').slice(0, 100), 'admin', pinHash, new Date().toISOString())
    .run();
  return json({ ok: true, userId: String((res.meta as any)?.last_row_id ?? '') });
}

// ---- D1-backed login rate limiting (works across ALL worker isolates) ----
// The old in-memory per-isolate limiter was bypassable in production because
// Cloudflare distributes requests across many isolates, each with its own
// counter. Storing failed attempts in D1 gives a single global counter.
// Only FAILED attempts count, so legitimate users can never lock themselves out.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

async function recordLoginFailure(env: Env, ip: string): Promise<boolean> {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(now - LOGIN_WINDOW_MS).run();
  await env.DB.prepare('INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)').bind(ip, now).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND created_at > ?').bind(ip, now - LOGIN_WINDOW_MS).first();
  return Number((row as any)?.c ?? 0) > LOGIN_MAX_FAILURES;
}

async function handleLogin(env: Env, request: Request): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const body = await readJson(request);
  const mobile = normalizeMobile(body.mobile);
  const pin = String(body.pin || '').trim();
  const user = await env.DB.prepare('SELECT * FROM users WHERE mobile = ?').bind(mobile).first();
  if (!user) {
    if (await recordLoginFailure(env, ip)) return json({ error: 'Bahut saare attempts — thodi der baad try karein.' }, 429);
    return json({ error: 'Mobile number ya PIN galat hai. Dobara try karein.' }, 401);
  }
  const iters = pbkdf2Iters(env);
  const okHash = await verifyPin(pin, String((user as any).pin_hash), iters);
  if (!okHash) {
    if (await recordLoginFailure(env, ip)) return json({ error: 'Bahut saare attempts — thodi der baad try karein.' }, 429);
    return json({ error: 'Mobile number ya PIN galat hai. Dobara try karein.' }, 401);
  }
  if (!(user as any).is_active) return json({ error: 'Account active nahi hai. Admin se contact karein.' }, 403);

  const profile = profileOf(user as Record<string, any>);
  const token = await signJwt({ sub: String(profile.id), mobile, role: profile.role }, env.AUTH_SECRET, SESSION_TTL_SEC);
  return json({ token, user: { id: profile.id, email: `${mobile}@crm.local` }, profile });
}

async function handleRegister(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const body = await readJson(request);
  const mobile = normalizeMobile(body.mobile);
  const pin = String(body.pin || '').trim();
  const role = body.role === 'admin' ? 'admin' : 'telecaller';
  if (!/^\d{10}$/.test(mobile)) return json({ error: 'Invalid mobile number' }, 400);
  if (pin.length < 4 || pin.length > 8) return json({ error: 'PIN 4-8 digits' }, 400);

  const iters = pbkdf2Iters(env);
  const pinHash = await hashPin(pin, iters);
  try {
    const res = await env.DB.prepare(
      'INSERT INTO users (mobile, full_name, role, is_active, pin_hash, created_at) VALUES (?, ?, ?, 1, ?, ?)'
    )
      .bind(mobile, String(body.name || 'Telecaller').slice(0, 100), role, pinHash, new Date().toISOString())
      .run();
    return json({ ok: true, userId: String((res.meta as any)?.last_row_id ?? '') });
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return json({ error: 'Is mobile number ka account pehle se maujood hai.' }, 409);
    }
    throw e;
  }
}

async function handleMe(_env: Env, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  return json({ user: { id: user!.id, email: `${user!.mobile}@crm.local` }, profile: user });
}

async function handleTeam(env: Env, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  // lead_count lets the admin see how many leads each telecaller currently owns.
  const res = await env.DB.prepare(
    `SELECT u.id, u.mobile, u.full_name, u.role, u.is_active, u.created_at,
            (SELECT COUNT(*) FROM crm_leads WHERE assigned_to = CAST(u.id AS TEXT) OR assigned_agent = u.full_name) AS lead_count
     FROM users u ORDER BY u.created_at DESC`
  ).all();
  return json({
    members: (res.results || []).map((r) => {
      const row = r as Record<string, any>;
      return { ...profileOf(row), lead_count: Number(row.lead_count ?? 0) };
    }),
  });
}

async function handleMemberPatch(env: Env, request: Request, user: Record<string, any> | null, id: string): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const targetId = Number(id);
  const isSelf = String(user!.id) === String(targetId);
  const body = await readJson(request);
  const sets: string[] = [];
  const values: any[] = [];

  // Admin can change a telecaller's mobile number (unique, normalized).
  if (body.mobile !== undefined) {
    const mobile = normalizeMobile(body.mobile);
    if (!/^\d{10}$/.test(mobile)) return json({ error: 'Invalid mobile number' }, 400);
    const dup = await env.DB.prepare('SELECT id FROM users WHERE mobile = ? AND id <> ?')
      .bind(mobile, targetId)
      .first();
    if (dup) return json({ error: 'Is mobile number ka account pehle se maujood hai.' }, 409);
    sets.push('mobile = ?');
    values.push(mobile);
  }
  if (body.is_active !== undefined) {
    if (isSelf && !body.is_active) {
      return json({ error: 'Apna account khud deactivate nahi kar sakte' }, 400);
    }
    sets.push('is_active = ?');
    values.push(body.is_active ? 1 : 0);
  }
  if (body.role === 'admin' || body.role === 'telecaller') {
    if (isSelf && body.role !== 'admin') {
      return json({ error: 'Apna role khud nahi badal sakte' }, 400);
    }
    sets.push('role = ?');
    values.push(body.role);
  }
  // LOCKOUT GUARD: never deactivate/demote the last active admin.
  if ((body.is_active === false || body.role === 'telecaller') && !isSelf) {
    const target = await env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(targetId).first();
    if (target && (target as any).role === 'admin' && (target as any).is_active === 1) {
      const admins = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?"
      )
        .bind(targetId)
        .first();
      if (Number((admins as any)?.c ?? 0) === 0) {
        return json({ error: 'Last admin ko block/demote nahi kar sakte' }, 400);
      }
    }
  }
  // Admin resets a member's login PIN (no current-PIN check needed — the
  // admin is already authorized via requireAdmin).
  if (typeof body.pin === 'string') {
    const newPin = body.pin.trim();
    if (!/^\d{6,8}$/.test(newPin)) return json({ error: 'PIN 6-8 digits' }, 400);
    sets.push('pin_hash = ?');
    values.push(await hashPin(newPin, pbkdf2Iters(env)));
  }
  if (sets.length === 0) return json({ error: 'Nothing to update' }, 400);
  values.push(targetId);
  const res = await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  if (Number((res.meta as any)?.changes ?? 0) === 0) return json({ error: 'Member not found' }, 404);
  return json({ ok: true });
}

async function handleMemberDelete(env: Env, _request: Request, user: Record<string, any> | null, id: string): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const targetId = Number(id);
  if (String(id) === String(user!.id)) return json({ error: 'Apna account delete nahi kar sakte' }, 400);
  // LOCKOUT GUARD: never delete the last active admin.
  const target = await env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(targetId).first();
  if (target && (target as any).role === 'admin' && (target as any).is_active === 1) {
    const admins = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?"
    )
      .bind(targetId)
      .first();
    if (Number((admins as any)?.c ?? 0) === 0) {
      return json({ error: 'Last admin ko delete nahi kar sakte' }, 400);
    }
  }
  const res = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
  if (Number((res.meta as any)?.changes ?? 0) === 0) return json({ error: 'Member not found' }, 404);
  return json({ ok: true });
}

async function handleChangePin(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?').bind(Number(user!.id)).first();
  const iters = pbkdf2Iters(env);
  const ok = await verifyPin(String(body.currentPin || '').trim(), String((row as any)?.pin_hash || ''), iters);
  if (!ok) return json({ error: 'Current PIN galat hai.' }, 400);
  const newPin = String(body.newPin || '').trim();
  if (newPin.length < 4 || newPin.length > 8) return json({ error: 'PIN 4-8 digits' }, 400);
  const pinHash = await hashPin(newPin, iters);
  await env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').bind(pinHash, Number(user!.id)).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// sync handlers
// ---------------------------------------------------------------------
function normalizeRow(table: string, row: Record<string, any>): Record<string, any> {
  const def = TABLES[table];
  if (!def || !def.booleans) return row;
  const out = { ...row };
  for (const b of def.booleans) out[b] = out[b] === 1 || out[b] === true;
  return out;
}

async function handlePush(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await readJson(request);
  const table = String(body.table || '');
  const row = body.row as Record<string, any> | undefined;
  const def: TableDef | undefined = TABLES[table];
  if (!def || typeof row !== 'object' || row === null) {
    return json({ error: `Unknown table: ${table}` }, 400);
  }
  if (!canAccessTable(user, table)) return json({ error: 'Forbidden' }, 403);

  const data: Record<string, any> = {};
  for (const c of def.columns) {
    if (row[c] !== undefined && row[c] !== null) data[c] = row[c];
  }
  // Every sync table except `leads` uses an INTEGER PRIMARY KEY (D1
  // autoincrement). The app sends numeric Dexie ids — coerce numeric
  // strings — but a non-numeric string id must not 500 (SQLITE_MISMATCH);
  // drop it and let D1 assign the real cloud id instead.
  let hasId = row.id !== undefined && row.id !== null && row.id !== '';
  if (hasId) {
    if (TEXT_ID_TABLES.has(table)) {
      data.id = String(row.id);
    } else {
      const rawId = String(row.id).trim();
      if (/^\d+$/.test(rawId)) {
        data.id = Number(rawId);
      } else {
        hasId = false;
        delete data.id;
      }
    }
  }
  for (const b of def.booleans || []) {
    if (data[b] !== undefined) data[b] = data[b] ? 1 : 0;
  }
  // SERVER-SIDE OWNERSHIP + FIELD RESTRICTIONS for telecallers:
  //  - may only UPDATE leads already assigned to them (403 otherwise),
  //  - any NEW lead they create is auto-assigned to themselves,
  //  - may NEVER change identity/ownership fields (mobile, name, source,
  //    expected_amount, assigned_agent/assigned_to) — address, notes,
  //    follow-up and status are the only things they can edit.
  if (user && user.role !== 'admin' && table === 'crm_leads') {
    if (hasId) {
      const existing = await env.DB.prepare('SELECT assigned_to, assigned_agent FROM crm_leads WHERE id = ?')
        .bind(data.id)
        .first();
      // Ownership is decided by assigned_to (id) FIRST so two telecallers with
      // the same full_name can never touch each other's leads; the name is only
      // a fallback for legacy rows whose assigned_to was never populated.
      const ownerId = existing ? String(existing.assigned_to ?? '') : '';
      const ownerName = existing ? String(existing.assigned_agent ?? '') : '';
      const nameFallback = (!ownerId || ownerId === '0') && ownerName === user.full_name;
      if (existing && ownerId !== String(user.id) && !nameFallback) {
        return json({ error: 'Forbidden — ye lead kisi aur telecaller ko assigned hai' }, 403);
      }
      for (const p of ['mobile', 'customer_id', 'customer_name', 'source', 'expected_amount', 'assigned_agent', 'assigned_to']) {
        delete data[p];
      }
    } else {
      data.assigned_to = user.id;
      data.assigned_agent = user.full_name;
    }
  }
  // Telecallers may edit customer ADDRESS/notes fields but never identity or
  // financial/counter fields (mobile, name, totals, risk, status counters).
  if (user && user.role !== 'admin' && table === 'crm_customers') {
    for (const p of ['mobile', 'name', 'alternate_number', 'total_orders', 'delivered', 'rto', 'cancelled', 'fake_count', 'total_spend', 'last_order_date', 'risk_level', 'current_status']) {
      delete data[p];
    }
  }
  if (Object.keys(data).length === 0) return json({ error: 'No writable columns' }, 400);

  let conflict: string | undefined = typeof body.conflictKey === 'string' ? body.conflictKey : undefined;
  // Only ever interpolate whitelisted conflict targets into SQL — client
  // input (or anything not a real column) must fall back to a plain insert.
  if (conflict && conflict !== 'id' && !def.columns.includes(conflict)) conflict = undefined;
  if (!conflict && hasId) conflict = 'id';
  if (!conflict && def.dedup && data[def.dedup]) conflict = def.dedup;

  const names = Object.keys(data);
  const placeholders = names.map(() => '?').join(', ');
  const values = names.map((n) => data[n]);

  // Upsert by id = UPDATE-first (mirrors the old .update().eq('id') semantics
  // and avoids NOT NULL failures when a client sends a partial row).
  if (conflict === 'id' && hasId) {
    const settable = names.filter((n) => n !== 'id');
    if (settable.length) {
      const sets = settable.map((n) => `${n} = ?`).join(', ');
      const upd = await env.DB.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`)
        .bind(...settable.map((n) => data[n]), data.id)
        .run();
      // changes() is 0 both when the row is missing AND when the UPDATE set
      // identical values (idempotent re-push) — check existence either way.
      if (Number((upd.meta as any)?.changes ?? 0) > 0) return json({ id: data.id });
    }
    const exists = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(data.id).first();
    if (exists) return json({ id: data.id });
    const ins = await env.DB.prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) RETURNING id`
    ).bind(...values).first();
    return json({ id: (ins as any)?.id ?? null });
  }

  let sql: string;
  if (conflict) {
    const settable = names.filter((n) => n !== 'id');
    const sets = settable.map((n) => `${n} = excluded.${n}`).join(', ');
    sql = settable.length
      ? `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflict}) DO UPDATE SET ${sets} RETURNING id`
      : `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflict}) DO NOTHING RETURNING id`;
  } else {
    sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) RETURNING id`;
  }
  const res = await env.DB.prepare(sql).bind(...values).first();
  return json({ id: (res as any)?.id ?? null });
}

async function handleDelete(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await readJson(request);
  const table = String(body.table || '');
  if (!TABLES[table]) return json({ error: `Unknown table: ${table}` }, 400);
  if (!canAccessTable(user, table)) return json({ error: 'Forbidden' }, 403);
  // DATA SAFETY: deletes are ADMIN-ONLY. Telecallers can never permanently
  // delete any row — lead history, call logs, timeline etc. stay forever, and
  // no telecaller can silently wipe cloud data.
  if (user && user.role !== 'admin') {
    return json({ error: 'Forbidden — admin only' }, 403);
  }
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(body.id).run();
  return json({ ok: true });
}

async function handlePull(env: Env, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const requested = url.searchParams.get('tables');
  const requestedNames = requested ? requested.split(',') : [...SYNC_TABLE_NAMES];
  const names = requestedNames.filter((n) => canAccessTable(user, n));
  const rows: Record<string, any[]> = {};
  for (const name of names) {
    if (!TABLES[name]) continue;
    // SERVER-SIDE ISOLATION: telecallers only ever receive leads assigned to
    // themselves. (Previously the whole table was returned and the UI hid the
    // rest — any telecaller could pull everyone's lead data via the API.)
    if (name === 'crm_leads' && user && user.role !== 'admin') {
      // Isolation by assigned_to (id) first; name only for legacy rows where
      // assigned_to is missing/0. Prevents same-name telecaller cross-leaks.
      const res = await env.DB.prepare(
        "SELECT * FROM crm_leads WHERE assigned_to = ? OR ((assigned_to IS NULL OR assigned_to = '' OR assigned_to = '0') AND assigned_agent = ?) ORDER BY id ASC"
      )
        .bind(user.id, user.full_name)
        .all();
      rows[name] = (res.results || []).map((r) => normalizeRow(name, r as Record<string, any>));
      continue;
    }
    const res = await env.DB.prepare(`SELECT * FROM ${name} ORDER BY id ASC`).all();
    rows[name] = (res.results || []).map((r) => normalizeRow(name, r as Record<string, any>));
  }
  return json({ rows });
}

async function handleCount(env: Env, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const table = String(url.searchParams.get('table') || '');
  if (!TABLES[table]) return json({ error: `Unknown table: ${table}` }, 400);
  if (!canAccessTable(user, table)) return json({ error: 'Forbidden' }, 403);
  const res = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first();
  return json({ count: Number((res as any)?.c ?? 0) });
}

// ---------------------------------------------------------------------
// intake (landing page)
// ---------------------------------------------------------------------
async function handleIntake(env: Env, request: Request): Promise<Response> {
  const key = request.headers.get('X-Intake-Key') || '';
  if (!env.INTAKE_KEY || key !== env.INTAKE_KEY) return json({ error: 'Forbidden' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (isLimited(`intake:${ip}`, 30, 60 * 1000)) return json({ error: 'Rate limited' }, 429);

  const body = await readJson(request);
  const mobile = normalizeMobile(body.mobile);
  if (!/^\d{10}$/.test(mobile)) return json({ error: 'Invalid mobile number' }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO leads (id, name, mobile, address, city, state, pincode, product, amount, payment_mode, source, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(
      id,
      String(body.name || '').slice(0, 200),
      mobile,
      body.address ?? null,
      body.city ?? null,
      body.state ?? null,
      body.pincode ?? null,
      body.product ?? null,
      Number(body.amount) || 0,
      body.payment_mode || 'COD',
      body.source || 'Landing Page',
      now
    )
    .run();
  return json({ ok: true, id });
}

// ---------------------------------------------------------------------
// lead assignment (admin-only, server-side — survives sync + scales to
// 100k+ leads, and generates an in-app notification for the assignee)
// ---------------------------------------------------------------------
async function handleLeadsAssign(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const body = await readJson(request);
  const ids = Array.isArray(body.leadIds)
    ? body.leadIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!ids.length) return json({ error: 'leadIds required' }, 400);

  const assignToId = body.assignToId !== undefined ? String(body.assignToId) : '';
  const rawName = typeof body.assignToName === 'string' ? body.assignToName : '';

  // Empty assignToId => unassign (admin retracts leads). Otherwise the
  // assignee must be an existing active member.
  let name = '';
  if (assignToId && assignToId !== '0') {
    const member = await env.DB.prepare('SELECT id, full_name FROM users WHERE id = ? AND is_active = 1')
      .bind(Number(assignToId) || assignToId)
      .first();
    if (!member) return json({ error: 'Assignee not found / inactive' }, 404);
    name = rawName || String((member as any).full_name || 'Telecaller');
  }

  const reassign = body.reassign === true;
  const now = new Date().toISOString();
  // Without `reassign`, already-assigned leads are skipped (no double work,
  // no accidental overwrite of another telecaller's leads).
  const whereExtra = reassign
    ? ''
    : " AND (assigned_to IS NULL OR assigned_to = '' OR assigned_to = '0')";
  // D1 caps SQL variables per statement (~100) — chunk the IN() list so
  // bulk-assigns of thousands of leads never hit "too many SQL variables".
  const CHUNK = 90;
  let changed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const res = await env.DB.prepare(
      `UPDATE crm_leads SET assigned_to = ?, assigned_agent = ?, updated_at = ? WHERE id IN (${placeholders})${whereExtra}`
    )
      .bind(assignToId, name, now, ...chunk)
      .run();
    changed += Number((res.meta as any)?.changes ?? 0);
  }

  // Notify the assignee (in-app; surfaced by the NotificationBell).
  if (changed > 0 && name) {
    const title = assignToId ? 'New leads assigned' : 'Leads unassigned';
    const message = `${changed} lead${changed === 1 ? '' : 's'} aapko assign hui hain.`;
    await env.DB.prepare(
      "INSERT INTO crm_notifications (title, message, type, is_read, link_to, created_at) VALUES (?, ?, 'lead_assignment', 0, '/leads', ?)"
    )
      .bind(title, message, now)
      .run();
  }
  return json({ ok: true, assigned: changed, total: ids.length });
}

async function handleIntakePending(env: Env, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const res = await env.DB.prepare(
    "SELECT * FROM leads WHERE sync_status = 'pending' ORDER BY created_at ASC"
  ).all();
  return json({ data: res.results || [] });
}

// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------
async function dispatch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '' || path === '/' || path === '/api/health') return json({ ok: true });

  // Fail closed: never sign JWTs with a missing or placeholder secret.
  if (!env.AUTH_SECRET || env.AUTH_SECRET.startsWith('replace-')) {
    return json({ error: 'Server not configured — set AUTH_SECRET.' }, 503);
  }

  try {
      // ---- auth ----
      if (path === '/api/auth/bootstrap' && request.method === 'POST') return handleBootstrap(env, request);
      if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(env, request);
      if (path === '/api/auth/logout' && request.method === 'POST') return json({ ok: true });

      const user = await currentUser(env, request);

      if (path === '/api/auth/me' && request.method === 'GET') return handleMe(env, request, user);
      if (path === '/api/auth/register' && request.method === 'POST') return handleRegister(env, request, user);
      if (path === '/api/auth/team' && request.method === 'GET') return handleTeam(env, request, user);
      if (path === '/api/auth/change-pin' && request.method === 'POST') return handleChangePin(env, request, user);
      const memberMatch = path.match(/^\/api\/auth\/member\/([^/]+)$/);
      if (memberMatch && request.method === 'PATCH') return handleMemberPatch(env, request, user, memberMatch[1]);
      if (memberMatch && request.method === 'DELETE') return handleMemberDelete(env, request, user, memberMatch[1]);

      // ---- sync ----
      if (path === '/api/sync/push' && request.method === 'POST') return handlePush(env, request, user);
      if (path === '/api/sync/delete' && request.method === 'POST') return handleDelete(env, request, user);
      if (path === '/api/sync/pull' && request.method === 'GET') return handlePull(env, request, user, url);
      if (path === '/api/sync/count' && request.method === 'GET') return handleCount(env, request, user, url);

      // ---- lead assignment ----
      if (path === '/api/leads/assign' && request.method === 'POST') return handleLeadsAssign(env, request, user);

      // ---- intake ----
      if (path === '/api/intake' && request.method === 'POST') return handleIntake(env, request);
      if (path === '/api/intake/pending' && request.method === 'GET') return handleIntakePending(env, request, user);

      return json({ error: 'Not found' }, 404);
    } catch (e: any) {
      return json({ error: String(e?.message || e) }, 500);
    }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, request);
    if (Object.keys(cors).length === 0) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    const res = await dispatch(request, env);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
