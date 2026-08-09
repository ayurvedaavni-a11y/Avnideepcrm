// MERGE-SEMANTICS REGRESSION: proves the batched pull preserves local-only
// fields (callCount, firstCallAt, lastCallAt, reminderDate/Time/Reason) when a
// cloud update lands on an existing local lead - i.e. the batched flush behaves
// exactly like the old per-row update() and never wipes local data.
import 'fake-indexeddb/auto';
const listeners = {};
(globalThis).window = { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener: (t, f) => { (listeners[t] || []).splice(listeners[t].indexOf(f), 1); }, dispatchEvent: (t) => { (listeners[t] || []).slice().forEach((f) => f()); } };
(globalThis).document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, writable: true, configurable: true });
const lsStore = new Map();
(globalThis).localStorage = { getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => { lsStore.set(k, String(v)); }, removeItem: (k) => { lsStore.delete(k); } };
localStorage.setItem('crm_auth_token', 'e30.' + Buffer.from(JSON.stringify({ sub: '42', role: 'admin' })).toString('base64url') + '.sig');

const server = { crm_customers: [], crm_leads: [], crm_orders: [], crm_spacel_followups: [], crm_timeline_logs: [], crm_notifications: [], crm_call_logs: [] };
const nowIso = () => new Date().toISOString();
server.crm_customers.push({ id: 1, mobile: '9000000001', name: 'Cust One', total_orders: 0, delivered: 0, rto: 0, cancelled: 0, fake_count: 0, total_spend: 0, risk_level: 'Low', current_status: 'New Lead', created_at: nowIso(), updated_at: nowIso() });
server.crm_leads.push({ id: 1, customer_id: 1, customer_name: 'Cust One', mobile: '9000000001', product: 'Oil', source: 'Test', expected_amount: 100, priority: 'Medium', status: 'New Lead', assigned_agent: '', assigned_to: '', notes: '', created_at: nowIso(), updated_at: nowIso() });
(globalThis).fetch = async (input, init) => {
  const url = new URL(String(input));
  const path = url.pathname;
  const res = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/sync/pull') {
    const tables = (url.searchParams.get('tables') || '').split(',').filter(Boolean);
    const since = url.searchParams.get('since') || '';
    const rows = {};
    for (const t of tables) {
      const all = server[t] || [];
      rows[t] = since ? all.filter((r) => String(r.updated_at || r.created_at || '') > since) : all;
    }
    return res({ rows, deleted: {}, pulledAt: nowIso(), epoch: 0 });
  }
  if (path === '/api/sync/count') return res({ count: 0 });
  if (path === '/api/intake/pending') return res({ data: [] });
  if (path === '/api/orders/status') return res({ rows: [], serverTime: nowIso() });
  return res({ ok: true });
};
import { startOnlineSync, stopOnlineSync, pullNow } from '../src/db/onlineSync';
import { db } from '../src/db/db';
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  OK ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')); } };
(async () => {
  console.log('\n===== MERGE-PRESERVE REGRESSION =====\n');
  await startOnlineSync();
  await new Promise((r) => setTimeout(r, 50));
  const lead = await db.leads.toCollection().first();
  const lid = Number(lead.id);
  check('initial pull: local lead exists', !!lead);
  // simulate a telecaller's local activity - fields the cloud never carries
  await db.leads.update(lid, { callCount: 7, firstCallAt: '2026-08-01T10:00:00Z', lastCallAt: '2026-08-08T18:30:00Z', reminderDate: '2026-08-20', reminderTime: '11:00', reminderReason: 'Demo', assignedAt: '2026-08-08T09:00:00Z' });
  // cloud changes the status + notes
  server.crm_leads[0].status = 'Interested';
  server.crm_leads[0].notes = 'very interested';
  server.crm_leads[0].updated_at = nowIso();
  await pullNow(false);
  await new Promise((r) => setTimeout(r, 50));
  const after = await db.leads.get(lid);
  check('cloud status applied', after.status === 'Interested', String(after.status));
  check('cloud notes applied', after.notes === 'very interested', String(after.notes));
  check('LOCAL callCount preserved', after.callCount === 7, String(after.callCount));
  check('LOCAL firstCallAt preserved', after.firstCallAt === '2026-08-01T10:00:00Z', String(after.firstCallAt));
  check('LOCAL lastCallAt preserved', after.lastCallAt === '2026-08-08T18:30:00Z', String(after.lastCallAt));
  check('LOCAL reminderDate preserved', after.reminderDate === '2026-08-20', String(after.reminderDate));
  check('LOCAL reminderTime preserved', after.reminderTime === '11:00', String(after.reminderTime));
  check('LOCAL reminderReason preserved', after.reminderReason === 'Demo', String(after.reminderReason));
  check('LOCAL assignedAt preserved', after.assignedAt === '2026-08-08T09:00:00Z', String(after.assignedAt));
  check('LOCAL customerId intact', Number(after.customerId) === 1, String(after.customerId));
  // no-change full pull must not touch anything
  const preFull = JSON.stringify(after);
  await pullNow(true);
  const afterFull = await db.leads.get(lid);
  check('full pull: status still Interested', afterFull.status === 'Interested');
  check('full pull: callCount still 7', afterFull.callCount === 7, String(afterFull.callCount));
  check('full pull: reminderDate still preserved', afterFull.reminderDate === '2026-08-20', String(afterFull.reminderDate));
  await stopOnlineSync();
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail > 0 ? 1 : 0;
})();
