// =============================================================================
// STALE-OPEN-TAB REGRESSION — entry module (bundled via esbuild, see
// scripts/stale-tab-regression.mjs). Runs the REAL onlineSync engine + REAL
// Dexie (on fake-indexeddb) against a simulated Cloudflare D1 server (fetch
// stub) and reproduces the production bug:
//
//   "Already-open tab keeps showing 1 lead after the server gains 10 new
//    leads (deploy + import), while a fresh tab shows the correct count."
//
// It exercises the exact production paths:
//   - initial full sync (no cursors)            → 1 lead
//   - tab re-focus / visibility full pull       → 11 (the FIX)
//   - incremental cursor pull                   → 13 (cursor correctness)
//   - corrupted/future watermark (stuck cursor) → recovers via full pull
//   - fresh-tab full sync equals same count
// =============================================================================
import 'fake-indexeddb/auto'; // MUST come before Dexie import

// ---- Browser-API polyfills (Node has none of these) ----
const listeners: Record<string, Array<(e?: any) => void>> = {};
(globalThis as any).window = {
  addEventListener: (type: string, fn: any) => { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener: (type: string, fn: any) => { (listeners[type] = listeners[type] || []).splice((listeners[type] || []).indexOf(fn), 1); },
  dispatchEvent: (type: string) => { (listeners[type] || []).slice().forEach((fn) => fn()); },
};
(globalThis as any).document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
};
// Node ≥21 exposes a read-only `navigator` getter on globalThis — must use
// defineProperty to override it.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  writable: true,
  configurable: true,
});

const lsStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)); },
  removeItem: (k: string) => { lsStore.delete(k); },
};

// Fake JWT → activeUserId() decodes `sub` = '42'.
localStorage.setItem(
  'crm_auth_token',
  'e30.' + Buffer.from(JSON.stringify({ sub: '42', role: 'admin' })).toString('base64url') + '.sig'
);

// ---- Simulated D1 server (in-memory), mirroring the Worker's pull contract ----
interface SRow { id: number; [k: string]: any; }
const server: Record<string, SRow[]> = {
  crm_customers: [],
  crm_leads: [],
  crm_orders: [],
  crm_spacel_followups: [],
  crm_timeline_logs: [],
  crm_notifications: [],
  crm_call_logs: [],
};
let serverSeq = 1;
const nowIso = () => new Date().toISOString();
function makeLead(): SRow {
  const id = serverSeq++;
  return {
    id,
    customer_id: 0,
    customer_name: '',
    mobile: '',
    product: 'Test Product ' + id,
    source: 'Test',
    expected_amount: 100,
    priority: 'Medium',
    status: 'New Lead',
    assigned_agent: '',
    assigned_to: '',
    notes: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}
// Seed the server with 1 lead BEFORE the app boots (the "old tab" state).
server.crm_leads.push(makeLead());

(globalThis as any).fetch = async (input: any, init: any) => {
  const url = new URL(String(input));
  const path = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();
  const res = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

  if (path === '/api/sync/pull') {
    const tables = (url.searchParams.get('tables') || '').split(',').filter(Boolean);
    const since = url.searchParams.get('since') || '';
    const rows: Record<string, any[]> = {};
    for (const t of tables) {
      const all = server[t] || [];
      rows[t] = since ? all.filter((r) => String(r.updated_at) > since) : all;
    }
    return res({ rows, deleted: {}, pulledAt: nowIso(), epoch: 0 });
  }
  if (path === '/api/sync/push') {
    const body = JSON.parse(init?.body || '{}');
    const table = String(body.table || '');
    const row = body.row || {};
    const id = row.id != null ? Number(row.id) : serverSeq++;
    const existing = (server[table] || []).find((r) => r.id === id);
    if (existing) Object.assign(existing, row, { id, updated_at: nowIso() });
    else (server[table] = server[table] || []).push({ ...row, id, created_at: nowIso(), updated_at: nowIso() });
    return res({ id });
  }
  if (path === '/api/sync/count') {
    const table = url.searchParams.get('table') || '';
    return res({ count: (server[table] || []).length });
  }
  if (path === '/api/sync/delete') return res({ ok: true });
  if (path === '/api/intake/pending') return res({ data: [] });
  if (path === '/api/orders/status') return res({ rows: [], serverTime: nowIso() });
  return res({ ok: true });
};

// ---- The real engine under test ----
import { startOnlineSync, stopOnlineSync, pullNow, syncNow } from '../src/db/onlineSync';
import { db } from '../src/db/db';

// ---- tiny test harness ----
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
const count = async (table: string) => (db as any)[table].count();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n════════ STALE-OPEN-TAB REGRESSION ════════\n');

  // ---- STEP 1: old tab boots with 1 lead on the server ----
  await startOnlineSync();
  await sleep(50); // let the initial full pull settle
  check('A1: initial full sync → local has 1 lead', (await count('leads')) === 1, `got ${await count('leads')}`);

  // ---- STEP 2: deploy + import — server gains 10 new leads ----
  for (let i = 0; i < 10; i++) server.crm_leads.push(makeLead());
  check('A2: server now has 11 leads', server.crm_leads.length === 11);

  // ---- STEP 3: user returns to the already-open tab (visibility/focus) ----
  await pullNow(true); // exactly what the focus/visibilitychange handler runs
  check('A3: tab re-focus full pull → local has 11 leads (NO manual refresh)',
    (await count('leads')) === 11, `got ${await count('leads')}`);

  // ---- STEP 4: incremental cursor pull must ALSO deliver new rows ----
  server.crm_leads.push(makeLead(), makeLead());
  await pullNow(false); // the 15s interval path (incremental, since watermark)
  check('A4: incremental cursor pull → local has 13 leads',
    (await count('leads')) === 13, `got ${await count('leads')}`);

  // ---- STEP 5: corrupted/future watermark (stuck cursor) self-heals ----
  // A cursor pointing at a FUTURE timestamp makes the server return zero rows
  // (nothing is "newer" than 2099). This documents the stale-state mechanism:
  // the tab keeps whatever it has — but crucially the sync engine survives it.
  const future = '2099-01-01T00:00:00.000Z';
  localStorage.setItem('crm_sync_cursors_42', JSON.stringify({
    tables: { customers: future, leads: future, orders: future, spacelFollowups: future, timelineLogs: future, notifications: future, callLogs: future },
    deletedAt: future,
    fullPulls: 0,
  }));
  await pullNow(false); // incremental with a future watermark → server returns nothing
  check('A5: future watermark → incremental returns nothing (tab keeps its data, no crash)',
    (await count('leads')) === 13, `got ${await count('leads')}`);
  // Self-heal: every pull re-stamps the watermark with the server's pulledAt
  // (server truth), so the corrupted future cursor is overwritten even by the
  // incremental pull itself — no manual intervention needed.
  const healed = JSON.parse(localStorage.getItem('crm_sync_cursors_42') || '{}');
  check('A5b: server re-stamps pulledAt → future watermark overwritten (self-heal)',
    typeof healed.tables?.leads === 'string' && !healed.tables.leads.startsWith('2099'),
    `leads cursor now=${healed.tables?.leads}`);
  await pullNow(true); // full pull converges regardless
  check('A6: full pull → local has 13 leads',
    (await count('leads')) === 13, `got ${await count('leads')}`);

  // ---- STEP 6: fresh tab / hard refresh equivalence (syncNow = full pull) ----
  const r = await syncNow();
  check('A7: fresh-tab full sync (syncNow) → same count 13',
    (await count('leads')) === 13 && r.online, `got ${await count('leads')}`);

  // ---- STEP 7: data integrity — the new rows actually arrived ----
  const allLeads = await db.leads.toArray();
  const newest = allLeads.find((l: any) => l.product === 'Test Product 13');
  check('A8: newly imported lead (Test Product 13) present locally', !!newest);

  await stopOnlineSync();

  console.log(`\n${'─'.repeat(46)}\nRESULT: ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
