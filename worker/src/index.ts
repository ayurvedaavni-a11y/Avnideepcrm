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
    if (await recordLoginFailure(env, ip)) return json({ error: 'Too many attempts — please try again in a while.' }, 429);
    return json({ error: 'Wrong mobile number or PIN. Please try again.' }, 401);
  }
  const iters = pbkdf2Iters(env);
  const okHash = await verifyPin(pin, String((user as any).pin_hash), iters);
  if (!okHash) {
    if (await recordLoginFailure(env, ip)) return json({ error: 'Too many attempts — please try again in a while.' }, 429);
    return json({ error: 'Wrong mobile number or PIN. Please try again.' }, 401);
  }
  if (!(user as any).is_active) return json({ error: 'Account is not active. Please contact the admin.' }, 403);

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
  // Ownership rule (matches the pull/push enforcement): assigned_to is the
  // authority; assigned_agent is only a fallback for legacy rows whose
  // assigned_to was never populated. Two aggregate passes instead of a
  // correlated subquery per user — uses idx_crm_leads_assigned_to and scales
  // with O(leads + users) instead of O(leads × users).
  const exact = await env.DB.prepare(
    `SELECT CAST(u.id AS TEXT) AS uid, COALESCE(e.cnt, 0) AS cnt
     FROM users u
     LEFT JOIN (SELECT assigned_to AS aid, COUNT(*) AS cnt FROM crm_leads GROUP BY assigned_to) e
       ON e.aid = CAST(u.id AS TEXT)`
  ).all();
  const legacy = await env.DB.prepare(
    `SELECT assigned_agent AS agent, COUNT(*) AS cnt FROM crm_leads
     WHERE assigned_to IS NULL OR assigned_to = '' OR assigned_to = '0'
     GROUP BY assigned_agent`
  ).all();
  const exactMap = new Map<string, number>();
  for (const r of (exact.results || []) as Record<string, any>[]) exactMap.set(String(r.uid), Number(r.cnt) || 0);
  const legacyMap = new Map<string, number>();
  for (const r of (legacy.results || []) as Record<string, any>[]) legacyMap.set(String(r.agent || ''), Number(r.cnt) || 0);
  const members = (await env.DB.prepare('SELECT id, mobile, full_name, role, is_active, created_at FROM users ORDER BY created_at DESC').all())
    .results as Record<string, any>[];
  return json({
    members: members.map((row) => ({
      ...profileOf(row),
      lead_count: (exactMap.get(String(row.id)) || 0) + (legacyMap.get(String(row.full_name || '')) || 0),
    })),
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
      return json({ error: 'You cannot deactivate your own account' }, 400);
    }
    sets.push('is_active = ?');
    values.push(body.is_active ? 1 : 0);
  }
  if (body.role === 'admin' || body.role === 'telecaller') {
    if (isSelf && body.role !== 'admin') {
      return json({ error: 'You cannot change your own role' }, 400);
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
        return json({ error: 'You cannot block/demote the last admin' }, 400);
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
  // DISABLE = UNASSIGN: a deactivated telecaller's leads return to the pool so
  // they never sit invisible/untouchable while the account is blocked. Bumping
  // updated_at lets every client pick up the unassignment via delta sync.
  if (body.is_active === false) {
    await env.DB.prepare(
      "UPDATE crm_leads SET assigned_to = NULL, assigned_agent = NULL, updated_at = ? WHERE assigned_to = ?"
    )
      .bind(new Date().toISOString(), String(targetId))
      .run();
  }
  return json({ ok: true });
}

async function handleMemberDelete(env: Env, request: Request, user: Record<string, any> | null, id: string): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const targetId = Number(id);
  if (String(id) === String(user!.id)) return json({ error: 'You cannot delete your own account' }, 400);
  // LOCKOUT GUARD: never delete the last active admin.
  const target = await env.DB.prepare('SELECT role, is_active FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return json({ error: 'Member not found' }, 404);
  if ((target as any).role === 'admin' && (target as any).is_active === 1) {
    const admins = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?"
    )
      .bind(targetId)
      .first();
    if (Number((admins as any)?.c ?? 0) === 0) {
      return json({ error: 'You cannot delete the last admin' }, 400);
    }
  }
  // DELETE PROTECTION: a telecaller with assigned leads cannot be deleted unless
  // force=true. The UI warns first; this 409 is the server-side guarantee so no
  // client (or direct API call) can ever orphan leads.
  const leadCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM crm_leads WHERE assigned_to = ?')
    .bind(String(targetId))
    .first();
  const count = Number((leadCount as any)?.c ?? 0);
  const body = await readJson(request);
  const force = body.force === true;
  if (count > 0 && !force) {
    return json(
      { error: `This telecaller has ${count} assigned lead(s). Transfer/unassign the leads first, or force delete.`, assignedLeads: count },
      409
    );
  }
  if (count > 0) {
    // AUTO-REASSIGN (force delete): leads return to the unassigned pool and the
    // bumped updated_at propagates the change to every client via delta sync.
    await env.DB.prepare(
      "UPDATE crm_leads SET assigned_to = NULL, assigned_agent = NULL, updated_at = ? WHERE assigned_to = ?"
    )
      .bind(new Date().toISOString(), String(targetId))
      .run();
  }
  const res = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
  if (Number((res.meta as any)?.changes ?? 0) === 0) return json({ error: 'Member not found' }, 404);
  return json({ ok: true, unassignedLeads: count });
}

async function handleChangePin(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?').bind(Number(user!.id)).first();
  const iters = pbkdf2Iters(env);
  const ok = await verifyPin(String(body.currentPin || '').trim(), String((row as any)?.pin_hash || ''), iters);
  if (!ok) return json({ error: 'Current PIN is wrong.' }, 400);
  const newPin = String(body.newPin || '').trim();
  if (newPin.length < 4 || newPin.length > 8) return json({ error: 'PIN 4-8 digits' }, 400);
  const pinHash = await hashPin(newPin, iters);
  await env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').bind(pinHash, Number(user!.id)).run();
  return json({ ok: true });
}


async function handleFactoryReset(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const body = await readJson(request);

  // Brute-force guard: reuse login rate limiter (5-min window, max 10 attempts).
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await recordLoginFailure(env, ip)) {
    return json({ error: 'Too many attempts — please try again in a while.' }, 429);
  }

  // Re-verify the admin's own login PIN before any destructive wipe.
  const row = await env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?').bind(Number(user!.id)).first();
  const iters = pbkdf2Iters(env);
  const ok = await verifyPin(String(body.pin || '').trim(), String((row as any)?.pin_hash || ''), iters);
  // 403 (not 401) so a wrong PIN never logs the admin out of the app.
  if (!ok) return json({ error: 'Wrong PIN — factory reset blocked.' }, 403);

  // Tombstone every row about to be deleted so other devices prune locally.
  const synced = ['crm_customers', 'crm_leads', 'crm_orders', 'crm_spacel_followups', 'crm_timeline_logs', 'crm_notifications', 'crm_call_logs'];
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  for (const t of synced) {
    try {
      await env.DB.prepare(
        `INSERT INTO crm_sync_tombstones (tbl, row_id, deleted_at) SELECT '${t}', id, ? FROM ${t}`
      ).bind(future).run();
    } catch { /* table absent — ignore */ }
  }

  // Wipe business data (keep users, settings, products, invoice settings).
  const WIPE = [
    'leads', 'crm_leads', 'crm_orders', 'crm_customers', 'crm_invoices', 'crm_invoice_items',
    'crm_logistics', 'crm_ndr_cases', 'crm_payments', 'crm_call_logs', 'crm_timeline_logs',
    'crm_notifications', 'crm_spacel_followups', 'crm_inventory_logs', 'crm_shipment_scans',
  ];
  let deleted = 0;
  for (const t of WIPE) {
    try {
      const res = await env.DB.prepare(`DELETE FROM ${t}`).run();
      deleted += Number((res.meta as any)?.changes ?? 0);
    } catch { /* table absent */ }
  }
  // Fresh auto-increment IDs.
  try {
    await env.DB.prepare(
      `DELETE FROM sqlite_sequence WHERE name IN (${WIPE.map((t) => `'${t}'`).join(',')})`
    ).run();
  } catch { /* no sequences */ }

  return json({ ok: true, deleted });
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

// ===========================================================================
// SERVER-SIDE AUTO-INVOICE (bugfix): when an order row first appears in the
// cloud (created by admin OR telecaller — the local app blocks non-admin
// invoice generation), the worker creates the crm_invoices row itself.
//   - Idempotent: NOT EXISTS(order_id) guard + unique invoice_number
//     derived from the unique order id → re-pushes never duplicate.
//   - Access stays ADMIN-ONLY: crm_invoices is not in SYNC_TABLE_NAMES and
//     canAccessTable() rejects every non-admin table access.
//   - Respects the optional crm_settings.auto_invoice = 'false' override.
// ===========================================================================
// ===========================================================================
// LEAD → ORDER AUTO-LINK (pipeline consistency): when an order row exists in
// the cloud with a lead_id, the linked lead MUST leave the active pipeline.
// The app does this in its own conversion flow, but any client that pushes an
// order directly (or a missed app step) left the lead in 'Interested'/'New'
// forever — the lead stayed visible in the active pipeline while an order
// existed. This hook idempotently:
//   1. sets crm_leads.status = 'Order Booked' (only if not already)
//   2. appends one timeline entry (Lead → Order Booked) with the actor.
// Safe to re-run: status update is guarded by `status != 'Order Booked'`,
// timeline insert only happens when the status actually changed.
// ===========================================================================
async function maybeLinkLeadToOrder(env: Env, table: string, cloudRowId: number): Promise<void> {
  if (table !== 'crm_orders' || !cloudRowId || cloudRowId <= 0) return;
  try {
    const order = await env.DB.prepare(
      'SELECT lead_id, booked_by_name, order_id, product FROM crm_orders WHERE id = ?'
    ).bind(cloudRowId).first<{ lead_id: number; booked_by_name: string | null; order_id: string; product: string | null }>();
    const leadId = Number(order?.lead_id || 0);
    if (!order || !leadId || leadId <= 0) return;
    const lead = await env.DB.prepare(
      'SELECT id, status, customer_id, customer_name FROM crm_leads WHERE id = ?'
    ).bind(leadId).first<{ id: number; status: string; customer_id: number; customer_name: string }>();
    if (!lead || lead.status === 'Order Booked') return;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE crm_leads SET status = 'Order Booked', updated_at = ? WHERE id = ? AND status != 'Order Booked'"
      ).bind(now, leadId),
      env.DB.prepare(
        `INSERT INTO crm_timeline_logs (customer_id, entity_type, entity_id, action, status_from, status_to, notes, agent_name, created_at)
         VALUES (?, 'Lead', ?, 'Order Booked', ?, 'Order Booked', ?, ?, ?)`
      ).bind(
        lead.customer_id ?? 0, leadId, lead.status,
        `Order ${order.order_id} booked for ${order.product || 'product'} (server auto-link).`,
        order.booked_by_name || 'Telecaller', now,
      ),
    ]);
    console.log('[lead-link] order', cloudRowId, '→ lead', leadId, 'converted');
  } catch (e: any) {
    // Never fail the order write because of the link step.
    console.error('[lead-link] skipped for order', cloudRowId, '—', String(e?.message || e).slice(0, 160));
  }
}

async function maybeAutoCreateInvoice(env: Env, table: string, cloudRowId: number): Promise<void> {
  if (table !== 'crm_orders' || !cloudRowId || cloudRowId <= 0) return;
  try {
    const auto = await env.DB.prepare("SELECT value FROM crm_settings WHERE key = 'auto_invoice'").first<{ value: string }>();
    if (auto && String(auto.value).trim().toLowerCase() === 'false') return;
    const now = new Date().toISOString();
    const ins = await env.DB.prepare(
      `INSERT INTO crm_invoices
         (invoice_number, order_id, order_number, customer_id, customer_name, customer_mobile,
          product, qty, rate, discount, subtotal, delivery_charge, cod_charge, total,
          payment_status, status, invoice_date, source, created_at, updated_at)
       SELECT
         'INV-' || strftime('%Y','now') || '-' || printf('%06d', o.id),
         o.id, o.order_id, o.customer_id, c.name, c.mobile, o.product,
         COALESCE(o.qty, 1), COALESCE(o.cod_amount, 0), COALESCE(o.discount, 0),
         COALESCE(o.cod_amount, 0) * COALESCE(o.qty, 1),
         COALESCE(o.delivery_charge, 0), COALESCE(o.cod_charge, 0),
         COALESCE(o.cod_amount, 0) * COALESCE(o.qty, 1) - COALESCE(o.discount, 0)
           + COALESCE(o.delivery_charge, 0) + COALESCE(o.cod_charge, 0),
         'Pending', 'Issued', COALESCE(o.order_date, ?), 'auto', ?, ?
       FROM crm_orders o LEFT JOIN crm_customers c ON c.id = o.customer_id
       WHERE o.id = ? AND NOT EXISTS (SELECT 1 FROM crm_invoices i WHERE i.order_id = o.id)`
    ).bind(now, now, now, cloudRowId).run();
    if (Number((ins.meta as any)?.changes ?? 0) > 0) {
      console.log('[auto-invoice] created for order', cloudRowId);
    }
  } catch (e: any) {
    // Never fail the order push because of an invoice problem.
    console.error('[auto-invoice] skipped for order', cloudRowId, '—', String(e?.message || e).slice(0, 200));
  }
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
  // FK VALIDATION (admin path): an assigned_to value pushed for a lead must point
  // to an existing, ACTIVE, TELECALLER user — otherwise the row is rejected with
  // 400 so an invalid assignment can never be written to D1. Telecallers never
  // reach this branch with a foreign id: their ownership fields were stripped
  // above and any NEW lead they create is auto-assigned to their own (already
  // validated) user id. The stored value is canonicalized to the user-id string
  // format so downstream joins (CAST(u.id AS TEXT) = assigned_to) always match.
  if (user && user.role === 'admin' && table === 'crm_leads' && data.assigned_to !== undefined && data.assigned_to !== null && data.assigned_to !== '' && data.assigned_to !== '0') {
    const at = String(data.assigned_to);
    const member = await env.DB.prepare("SELECT id, full_name FROM users WHERE id = ? AND is_active = 1 AND role = 'telecaller'")
      .bind(Number(at) || at)
      .first();
    if (!member) return json({ error: 'Invalid assignee — telecaller does not exist or is not active' }, 400);
    data.assigned_to = String((member as any).id);
    if (!data.assigned_agent) data.assigned_agent = String((member as any).full_name || 'Telecaller');
  }
  // TELECALLER CUSTOMER EDIT PERMISSION (enterprise matrix):
  //  - editable: name, alternate_number, address, landmark, city, state,
  //    pincode, district, notes  (Req: address/landmark/city/state/pincode/
  //    alt number/notes/customer remark/customer name)
  //  - BLOCKED: mobile (identity — kabhi nahi badal sakta), plus all
  //    financial/counter fields (totals, risk, status counters) jo sirf
  //    system/admin update karte hain.
  if (user && user.role !== 'admin' && table === 'crm_customers') {
    for (const p of ['mobile', 'total_orders', 'delivered', 'rto', 'cancelled', 'fake_count', 'total_spend', 'last_order_date', 'risk_level', 'current_status']) {
      delete data[p];
    }
  }
  // TELECALLER LEAD-STATUS WHITELIST (UI + API): telecallers may only set one
  // of the 8 sales-pipeline statuses. Everything else (Fake Lead, Duplicate,
  // NDR, fulfilment statuses, terminal flags) is admin-only. 'Followup' is the
  // canonical stored value for the displayed 'Follow-up'.
  if (user && user.role !== 'admin' && table === 'crm_leads' && data.status !== undefined) {
    const LEAD_STATUS_WHITELIST = [
      'New Lead', 'Calling', 'Ring', 'Busy', 'Interested', 'Followup',
      'Not Interested', 'Order Booked',
    ];
    if (!LEAD_STATUS_WHITELIST.includes(String(data.status))) {
      return json({ error: 'Invalid lead status for telecaller — only New Lead, Calling, Ring, Busy, Interested, Follow-up, Not Interested, Order Booked are allowed' }, 400);
    }
  }
  // ORDER RULES — single source of truth + server-side permissions:
  //  - `status` must be a valid pipeline status (anyone, admin included).
  //  - Telecallers may CREATE an order (status forced to 'Order Booked') but
  //    can NEVER change shipment status, courier, AWB, shipment date, COD or
  //    which customer/lead the order belongs to.
  if (table === 'crm_orders') {
    const ORDER_STATUS_WHITELIST = [
      'Order Booked', 'Packing', 'Packed', 'Ready To Ship', 'Shipped',
      'In Transit', 'Out For Delivery', 'Undelivered', 'Delivered', 'RTO', 'Cancelled',
    ];
    if (data.status !== undefined && !ORDER_STATUS_WHITELIST.includes(String(data.status))) {
      return json({ error: 'Invalid order status' }, 400);
    }
    if (user && user.role !== 'admin') {
      if (hasId) {
        // Update path (enterprise matrix): telecaller kabhi shipment/payment
        // status, courier, AWB, identity ya ownership fields change nahi kar
        // sakta — lekin COD AMOUNT edit kar sakta hai (Req 3). Baki pricing
        // fields (discount/delivery/cod charge) admin-only.
        for (const p of ['status', 'courier', 'tracking_id', 'shipment_date', 'payment_mode', 'discount', 'delivery_charge', 'cod_charge', 'special_instructions', 'order_notes', 'customer_id', 'lead_id', 'order_id', 'booked_by', 'booked_by_name', 'delivered_at']) {
          delete data[p];
        }
      } else {
        // Create path: order always starts at 'Order Booked'; courier fields
        // are assigned by admin at dispatch time. booked_by = the telecaller
        // who booked it (IMMUTABLE — commission attribution must never follow
        // a later reassignment of the lead).
        data.status = 'Order Booked';
        data.booked_by = String(user.id);
        data.booked_by_name = user.full_name;
        for (const p of ['courier', 'tracking_id', 'shipment_date']) {
          delete data[p];
        }
      }
    }
    // delivered_at is stamped the moment an order reaches 'Delivered' — the
    // authoritative date for Daily/Weekly/Monthly commission windows.
    if (data.status === 'Delivered' && !data.delivered_at) data.delivered_at = data.updated_at || new Date().toISOString();
  }

  if (Object.keys(data).length === 0) return json({ error: 'No writable columns' }, 400);

  // DELTA-SYNC SAFETY: guarantee timestamps on pushed rows. Without this, a
  // client that omits created_at/updated_at would create a row that incremental
  // pulls (WHERE updated_at > cursor) can never see until the full re-pull
  // safety net. Backward compatible — never overwrites a client-provided value.
  const nowIso = new Date().toISOString();
  if (def.columns.includes('created_at') && data.created_at == null) data.created_at = nowIso;
  if (def.columns.includes('updated_at') && data.updated_at == null) data.updated_at = nowIso;
  // STATUS-WRITE TIMESTAMP AUTHORITY: whenever a write carries a STATUS change,
  // stamp updated_at with the SERVER clock. Incremental pulls compare
  // updated_at > watermark where the watermark is server time (pulledAt); a
  // client clock running behind the server would push an OLDER timestamp and
  // the change would be invisible to other devices until the next full pull.
  // Server-stamping status writes makes every status change newer than any
  // prior watermark, so Delivered / RTO / Cancelled reach every device on the
  // very next pull (~2s via the fast /api/orders/status poll).
  if (def.columns.includes('updated_at')) {
    const statusField =
      table === 'crm_orders' || table === 'crm_leads' ? 'status'
      : table === 'crm_customers' ? 'current_status'
      : null;
    if (statusField && data[statusField] !== undefined && data[statusField] !== null) {
      data.updated_at = new Date().toISOString();
    }
  }
  // delivered_at rides the same server clock so commission windows and the
  // order row always agree (the earlier rules block stamps it with the CLIENT
  // timestamp — override it with the authoritative server updated_at).
  if (table === 'crm_orders' && data.status === 'Delivered') {
    data.delivered_at = data.updated_at || new Date().toISOString();
  }

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
      if (Number((upd.meta as any)?.changes ?? 0) > 0) {
        await maybeAutoCreateInvoice(env, table, Number(data.id) || 0);
      await maybeLinkLeadToOrder(env, table, Number(data.id) || 0);
        await maybeLinkLeadToOrder(env, table, Number(data.id) || 0);
        return json({ id: data.id });
      }
    }
    const exists = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(data.id).first();
    if (exists) {
      // Backfill: pre-fix orders that never got an invoice get one on the
      // next push (idempotent — NOT EXISTS guard inside the helper).
      await maybeAutoCreateInvoice(env, table, Number(data.id) || 0);
      await maybeLinkLeadToOrder(env, table, Number(data.id) || 0);
      return json({ id: data.id });
    }
    const ins = await env.DB.prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) RETURNING id`
    ).bind(...values).first();
    const insId = Number((ins as any)?.id ?? 0);
    await maybeAutoCreateInvoice(env, table, insId);
    await maybeLinkLeadToOrder(env, table, insId);
    return json({ id: insId });
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
  const cloudId = Number((res as any)?.id ?? 0);
  await maybeAutoCreateInvoice(env, table, cloudId);
  await maybeLinkLeadToOrder(env, table, cloudId);
  return json({ id: cloudId });
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
  // Incremental sync tombstone — lets other clients remove this row locally
  // without a full re-pull. Additive; never blocks the delete itself.
  try {
    await env.DB.prepare(
      'INSERT INTO crm_sync_tombstones (tbl, row_id, deleted_at) VALUES (?, ?, ?)'
    ).bind(table, Number(body.id) || 0, new Date().toISOString()).run();
  } catch { /* tombstone table absent — delete still succeeds */ }
  return json({ ok: true });
}

async function handlePull(env: Env, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const requested = url.searchParams.get('tables');
  const requestedNames = requested ? requested.split(',') : [...SYNC_TABLE_NAMES];
  // Explicit request for a table this role cannot access → hard 403
  // (defense in depth; the frontend only ever requests accessible tables).
  if (requested && requestedNames.some((n) => TABLES[n] && !canAccessTable(user, n))) {
    return json({ error: 'Forbidden' }, 403);
  }
  const names = requestedNames.filter((n) => canAccessTable(user, n));
  // OPTIONAL incremental params — when absent the response is the exact same
  // full pull as before (old clients are unaffected). `since` limits rows to
  // those changed after the cursor; `deletedSince` returns tombstones so
  // other clients can prune locally-deleted rows without a full re-pull.
  const since = String(url.searchParams.get('since') || '');
  const deletedSince = String(url.searchParams.get('deletedSince') || '');
  const rows: Record<string, any[]> = {};
  for (const name of names) {
    if (!TABLES[name]) continue;
    // SERVER-SIDE ISOLATION: telecallers only ever receive leads assigned to
    // themselves. (Previously the whole table was returned and the UI hid the
    // rest — any telecaller could pull everyone's lead data via the API.)
    if (name === 'crm_leads' && user && user.role !== 'admin') {
      const sql = since
        ? "SELECT * FROM crm_leads WHERE (assigned_to = ? OR ((assigned_to IS NULL OR assigned_to = '' OR assigned_to = '0') AND assigned_agent = ?)) AND updated_at > ? ORDER BY id ASC"
        : "SELECT * FROM crm_leads WHERE assigned_to = ? OR ((assigned_to IS NULL OR assigned_to = '' OR assigned_to = '0') AND assigned_agent = ?) ORDER BY id ASC";
      const res = since
        ? await env.DB.prepare(sql).bind(user.id, user.full_name, since).all()
        : await env.DB.prepare(sql).bind(user.id, user.full_name).all();
      rows[name] = (res.results || []).map((r) => normalizeRow(name, r as Record<string, any>));
      continue;
    }
    if (since) {
      // Tables with an updated_at column sync on edits; append-only tables
      // (timeline, call logs, notifications, follow-ups) sync on created_at.
      const def = TABLES[name];
      const col = def.columns.includes('updated_at') ? 'updated_at' : 'created_at';
      const res = await env.DB.prepare(`SELECT * FROM ${name} WHERE ${col} > ? ORDER BY id ASC`)
        .bind(since)
        .all();
      rows[name] = (res.results || []).map((r) => normalizeRow(name, r as Record<string, any>));
      continue;
    }
    const res = await env.DB.prepare(`SELECT * FROM ${name} ORDER BY id ASC`).all();
    rows[name] = (res.results || []).map((r) => normalizeRow(name, r as Record<string, any>));
  }
  // Incremental deletes: rows removed from the cloud since deletedSince.
  let deleted: Record<string, { id: number; deleted_at: string }[]> = {};
  if (deletedSince) {
    const res = await env.DB.prepare(
      'SELECT tbl, row_id, deleted_at FROM crm_sync_tombstones WHERE deleted_at > ? ORDER BY deleted_at ASC LIMIT 10000'
    ).bind(deletedSince).all();
    for (const r of (res.results || []) as Record<string, any>[]) {
      const tbl = String(r.tbl || '');
      if (!names.includes(tbl)) continue;
      (deleted[tbl] = deleted[tbl] || []).push({
        id: Number(r.row_id) || 0,
        deleted_at: String(r.deleted_at || ''),
      });
    }
  }
  return json({ rows, deleted, pulledAt: new Date().toISOString() });
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
// admin invoices (bugfix): read-only listing of server-side auto-invoices.
// Admin-only — crm_invoices stays out of SYNC_TABLE_NAMES, so telecallers
// can neither list, push nor pull invoice rows (canAccessTable rejects).
// ---------------------------------------------------------------------
async function handleInvoicesList(env: Env, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const orderId = Number(url.searchParams.get('order_id') || 0) || 0;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100) || 100));
  const res = orderId > 0
    ? await env.DB.prepare('SELECT * FROM crm_invoices WHERE order_id = ? ORDER BY id DESC LIMIT ?').bind(orderId, limit).all()
    : await env.DB.prepare('SELECT * FROM crm_invoices ORDER BY id DESC LIMIT ?').bind(limit).all();
  return json({ invoices: res.results, count: res.results.length });
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
  // DATABASE-LEVEL DEDUP (migration 0005 creates a UNIQUE index on
  // leads(mobile)): the same mobile submitted twice conflicts at the DB
  // layer — no pre-check race window, no duplicate row can ever be written.
  // Idempotent response: the caller receives the existing row id so the
  // landing page never double-counts an enquiry.
  const res = await env.DB.prepare(
    `INSERT INTO leads (id, name, mobile, address, city, state, pincode, product, amount, payment_mode, source, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(mobile) DO NOTHING`
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
  const inserted = Number((res.meta as any)?.changes ?? 0);
  if (inserted > 0) return json({ ok: true, id, duplicate: false });
  // Duplicate mobile — return the existing lead (idempotent), do NOT create a row.
  const existing = await env.DB.prepare(
    'SELECT id, created_at FROM leads WHERE mobile = ? ORDER BY created_at ASC LIMIT 1'
  ).bind(mobile).first<{ id: string; created_at: string }>();
  return json({ ok: true, id: String(existing?.id ?? id), duplicate: true });
}

// ---------------------------------------------------------------------
// settings (commission rate etc.) + telecaller performance/commission
// ---------------------------------------------------------------------
async function handleSettingsGet(env: Env, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const rows = (await env.DB.prepare('SELECT key, value FROM crm_settings').all()).results as Record<string, any>[];
  const settings: Record<string, string> = {};
  for (const r of rows || []) settings[String(r.key)] = String(r.value ?? '');
  return json({ settings });
}

async function handleSettingsPatch(env: Env, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const body = await readJson(request);
  const key = String(body.key || '').trim();
  if (!key) return json({ error: 'key required' }, 400);
  const value = String(body.value ?? '');
  if (key === 'commission_rate') {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return json({ error: 'Commission rate must be between 0-100%' }, 400);
    }
  }
  await env.DB.prepare(
    "INSERT INTO crm_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  )
    .bind(key, value, new Date().toISOString())
    .run();
  return json({ ok: true });
}

// PERFORMANCE + COMMISSION (admin = whole team, telecaller = own view).
// Computed LIVE from crm_orders via SQL — the single source of truth, so the
// numbers here can never drift from Orders / Logistics / Dashboard.
// Commission = Delivered Amount × commission_rate (Delivered orders only).
async function handlePerformance(env: Env, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const rateRow = await env.DB.prepare("SELECT value FROM crm_settings WHERE key = 'commission_rate'").first();
  const commissionRate = Number((rateRow as any)?.value ?? 0) / 100;

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const isAdmin = user?.role === 'admin';
  // Admin: all members. Telecaller: themselves only.
  const members = isAdmin
    ? (await env.DB.prepare("SELECT id, full_name, mobile FROM users WHERE role = 'telecaller' ORDER BY full_name").all()).results as Record<string, any>[]
    : [{ id: user!.id, full_name: user!.full_name, mobile: user!.mobile }];

  const out = [];
  for (const m of members) {
    const uid = String(m.id);
    const agg = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total_orders,
         COALESCE(SUM(CASE WHEN status = 'Delivered' THEN cod_amount ELSE 0 END), 0) AS delivered_amount,
         COALESCE(SUM(CASE WHEN status IN ('Order Booked','Packing','Packed','Ready To Ship','Shipped','In Transit','Out For Delivery') THEN cod_amount ELSE 0 END), 0) AS pending_amount,
         COALESCE(SUM(CASE WHEN status = 'RTO' THEN cod_amount ELSE 0 END), 0) AS rto_amount,
         COALESCE(SUM(CASE WHEN status = 'Cancelled' THEN cod_amount ELSE 0 END), 0) AS cancelled_amount,
         COALESCE(SUM(CASE WHEN status = 'Delivered' AND COALESCE(delivered_at, updated_at) >= ? THEN cod_amount ELSE 0 END), 0) AS daily_amount,
         COALESCE(SUM(CASE WHEN status = 'Delivered' AND COALESCE(delivered_at, updated_at) >= ? THEN cod_amount ELSE 0 END), 0) AS weekly_amount,
         COALESCE(SUM(CASE WHEN status = 'Delivered' AND COALESCE(delivered_at, updated_at) >= ? THEN cod_amount ELSE 0 END), 0) AS monthly_amount
       FROM crm_orders WHERE booked_by = ?`
    )
      .bind(dayStart, weekStart, monthStart, uid)
      .first();
    const a = (agg || {}) as Record<string, any>;
    const deliveredAmount = Number(a.delivered_amount ?? 0);
    const daily = Number(a.daily_amount ?? 0);
    const weekly = Number(a.weekly_amount ?? 0);
    const monthly = Number(a.monthly_amount ?? 0);
    // Calls + follow-ups + conversion from call logs / leads.
    const callsRow = await env.DB.prepare(
      "SELECT COUNT(*) AS calls, COALESCE(SUM(duration_sec), 0) AS total_sec FROM crm_call_logs WHERE telecaller_id = ?"
    ).bind(uid).first();
    const leadRow = await env.DB.prepare(
      "SELECT COUNT(*) AS assigned FROM crm_leads WHERE assigned_to = ?"
    ).bind(uid).first();
    const convertedRow = await env.DB.prepare(
      "SELECT COUNT(*) AS converted FROM crm_leads WHERE assigned_to = ? AND status = 'Order Booked'"
    ).bind(uid).first();
    const assigned = Number((leadRow as any)?.assigned ?? 0);
    const converted = Number((convertedRow as any)?.converted ?? 0);
    out.push({
      telecallerId: uid,
      telecallerName: String(m.full_name || m.id),
      mobile: m.mobile || '',
      assigned,
      calls: Number((callsRow as any)?.calls ?? 0),
      totalCallSeconds: Number((callsRow as any)?.total_sec ?? 0),
      converted,
      conversionPct: assigned ? Math.round((converted / assigned) * 1000) / 10 : 0,
      totalOrders: Number(a.total_orders ?? 0),
      deliveredAmount,
      pendingAmount: Number(a.pending_amount ?? 0),
      rtoAmount: Number(a.rto_amount ?? 0),
      cancelledAmount: Number(a.cancelled_amount ?? 0),
      dailyAmount: daily,
      weeklyAmount: weekly,
      monthlyAmount: monthly,
      commission: Math.round(deliveredAmount * commissionRate * 100) / 100,
      commissionRate: commissionRate * 100,
    });
  }
  return json({ rate: commissionRate * 100, members: out });
}

// ---------------------------------------------------------------------
// startup self-healing (TASK 7 + 9) — admin-only repair sweep
// ---------------------------------------------------------------------
// Called silently on every app startup (and by the DB Health page). Fixes any
// lead whose assigned_to does NOT point at an existing, active, telecaller user:
//   assigned_to = NULL, assigned_agent = NULL, updated_at = NOW()
// The updated_at bump is the critical part — it guarantees every client picks
// up the repair through the normal incremental (delta) sync, so a stale
// assignment can never linger invisibly on another device.
async function handleRepairAssignments(env: Env, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAdmin(user);
  if (denied) return denied;
  const now = new Date().toISOString();
  // Single sweep: sentinel ('', '0') values count as unassigned, and any
  // non-empty assigned_to that does not reference an existing, ACTIVE,
  // telecaller user is an orphan — both are repaired in one statement so the
  // returned count is accurate.
  const res = await env.DB.prepare(
    `UPDATE crm_leads
     SET assigned_to = NULL, assigned_agent = NULL, updated_at = ?
     WHERE assigned_to = '' OR assigned_to = '0'
        OR (assigned_to IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE CAST(u.id AS TEXT) = crm_leads.assigned_to
                AND u.is_active = 1
                AND u.role = 'telecaller'
            ))`
  )
    .bind(now)
    .run();
  return json({ ok: true, repaired: Number((res.meta as any)?.changes ?? 0) });
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
    // FK VALIDATION: assignee must exist, be ACTIVE and be a TELECALLER. Admins,
    // deleted and blocked users can never receive an assignment (HTTP 400).
    const member = await env.DB.prepare("SELECT id, full_name FROM users WHERE id = ? AND is_active = 1 AND role = 'telecaller'")
      .bind(Number(assignToId) || assignToId)
      .first();
    if (!member) return json({ error: 'Assignee not found / inactive / not a telecaller' }, 400);
    name = rawName || String((member as any).full_name || 'Telecaller');
  }

  const reassign = body.reassign === true;
  const now = new Date().toISOString();
  // Without `reassign`, already-assigned leads are skipped (no double work,
  // no accidental overwrite of another telecaller's leads).
  const CHUNK = 90; // D1 caps SQL variables per statement (~100)
  let changed = 0;
  const timelineStmts: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    // Read current state of the candidate leads first: we need customer_id,
    // prior owner and prior assignment state for the timeline, and to decide
    // which rows are actually eligible (skip already-assigned unless reassign).
    const cur = await env.DB.prepare(
      `SELECT id, customer_id, assigned_to, assigned_agent FROM crm_leads WHERE id IN (${placeholders})`
    ).bind(...chunk).all<{ id: number; customer_id: number; assigned_to: string | null; assigned_agent: string | null }>();
    const eligible = reassign
      ? cur.results
      : cur.results.filter((r) => !r.assigned_to || r.assigned_to === '' || r.assigned_to === '0');
    if (eligible.length) {
      const eIds = eligible.map((r) => r.id);
      const ePh = eIds.map(() => '?').join(', ');
      const upd = await env.DB.prepare(
        `UPDATE crm_leads SET assigned_to = ?, assigned_agent = ?, updated_at = ? WHERE id IN (${ePh})`
      ).bind(assignToId, name, now, ...eIds).run();
      changed += Number((upd.meta as any)?.changes ?? 0);
    }
    // ASSIGNMENT HISTORY (bugfix): every assign / reassign / unassign is
    // appended to crm_timeline_logs so the customer timeline shows the full
    // ownership trail on ALL devices (cloud path was missing this — only the
    // local Dexie path logged it before).
    for (const r of eligible) {
      const wasAssigned = !!r.assigned_to && r.assigned_to !== '' && r.assigned_to !== '0';
      const isUnassign = !assignToId || assignToId === '' || assignToId === '0';
      const action = isUnassign ? 'Assignment Removed' : wasAssigned ? 'Lead Reassigned' : 'Lead Assigned';
      const notes = isUnassign
        ? `Removed from ${r.assigned_agent || 'unassigned'}. Lead is back in the pool.`
        : wasAssigned
          ? `Reassigned from ${r.assigned_agent || 'unassigned'} to ${name}.`
          : `Lead assigned to ${name}.`;
      timelineStmts.push(
        env.DB.prepare(
          `INSERT INTO crm_timeline_logs (customer_id, entity_type, entity_id, action, status_from, status_to, notes, agent_name, created_at)
           VALUES (?, 'Lead', ?, ?, ?, ?, ?, ?, ?)`
        ).bind(r.customer_id ?? 0, r.id, action, String(r.assigned_to ?? ''), isUnassign ? '' : assignToId, notes, name || 'Admin', now),
      );
    }
  }
  // Flush timeline entries in batches (D1 batch cap ~100 statements).
  for (let s = 0; s < timelineStmts.length; s += 90) {
    await env.DB.batch(timelineStmts.slice(s, s + 90));
  }

  // Notify the assignee (in-app; surfaced by the NotificationBell).
  if (changed > 0 && name) {
    const title = assignToId ? 'New leads assigned' : 'Leads unassigned';
    const message = `${changed} lead${changed === 1 ? '' : 's'} assigned to you.`;
    await env.DB.prepare(
      "INSERT INTO crm_notifications (title, message, type, is_read, link_to, created_at) VALUES (?, ?, 'lead_assignment', 0, '/leads', ?)"
    )
      .bind(title, message, now)
      .run();
  }
  return json({ ok: true, assigned: changed, skipped: Math.max(0, ids.length - changed), total: ids.length });
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
// fast order-status sync (admin change reaches telecaller My Orders in ~2s)
// ---------------------------------------------------------------------
async function handleOrderStatus(env: Env, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const since = String(url.searchParams.get('since') || '');
  const isAdmin = user!.role === 'admin';
  // Admin watches every order; telecallers watch only orders they booked or
  // whose lead is assigned to them (matches the "My Orders" definition).
  const where = isAdmin
    ? (since ? 'WHERE updated_at > ?' : '')
    : (since
        ? "WHERE (booked_by = ? OR lead_id IN (SELECT id FROM crm_leads WHERE assigned_to = ?)) AND updated_at > ?"
        : "WHERE (booked_by = ? OR lead_id IN (SELECT id FROM crm_leads WHERE assigned_to = ?))");
  const sql = `SELECT id, order_id, status, updated_at, delivered_at FROM crm_orders ${where} ORDER BY updated_at ASC LIMIT 500`;
  const bind = isAdmin
    ? (since ? [since] : [])
    : (since ? [user!.id, user!.id, since] : [user!.id, user!.id]);
  const res = await env.DB.prepare(sql).bind(...bind).all();
  const rows = ((res.results || []) as Record<string, any>[]).map((r) => ({
    id: Number(r.id),
    orderId: String(r.order_id || ''),
    status: String(r.status || ''),
    updatedAt: String(r.updated_at || ''),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : undefined,
  }));
  return json({ rows, serverTime: new Date().toISOString() });
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
      if (path === '/api/invoices' && request.method === 'GET') return handleInvoicesList(env, request, user, url);
      if (path === '/api/orders/status' && request.method === 'GET') return handleOrderStatus(env, request, user, url);

      // ---- lead assignment ----
      if (path === '/api/leads/assign' && request.method === 'POST') return handleLeadsAssign(env, request, user);

      // ---- self-healing repair (admin) ----
      if (path === '/api/admin/repair-assignments' && request.method === 'POST') return handleRepairAssignments(env, request, user);
      if (path === '/api/admin/factory-reset' && request.method === 'POST') return handleFactoryReset(env, request, user);

      // ---- settings + performance ----
      if (path === '/api/settings' && request.method === 'GET') return handleSettingsGet(env, request, user);
      if (path === '/api/settings' && request.method === 'PATCH') return handleSettingsPatch(env, request, user);
      if (path === '/api/performance' && request.method === 'GET') return handlePerformance(env, request, user);

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
