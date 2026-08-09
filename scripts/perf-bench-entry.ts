// PERF BENCHMARK - real onlineSync + real Dexie (fake-indexeddb) vs simulated
// D1 server seeded with large data. Measures pull wall-times + change storms.
import 'fake-indexeddb/auto';
const listeners = {};
(globalThis).window = {
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener: (type, fn) => { (listeners[type] || []).splice(listeners[type].indexOf(fn), 1); },
  dispatchEvent: (type) => { (listeners[type] || []).slice().forEach((fn) => fn()); },
};
(globalThis).document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, writable: true, configurable: true });
const lsStore = new Map();
(globalThis).localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
};
localStorage.setItem('crm_auth_token', 'e30.' + Buffer.from(JSON.stringify({ sub: '42', role: 'admin' })).toString('base64url') + '.sig');
const server = { crm_customers: [], crm_leads: [], crm_orders: [], crm_spacel_followups: [], crm_timeline_logs: [], crm_notifications: [], crm_call_logs: [] };
const nowIso = () => new Date().toISOString();
const daysAgo = (d, h) => new Date(Date.now() - d * 86400000 - (h || 0) * 3600000).toISOString();
const N = Number(process.env.BENCH_N || 10000);
for (let i = 1; i <= N; i++) server.crm_customers.push({ id: i, mobile: String(9000000000 + i), name: 'Customer ' + i, city: 'City ' + (i % 50), state: 'State ' + (i % 20), pincode: '11000' + (i % 90), total_orders: i % 5, delivered: i % 3, rto: i % 2, cancelled: i % 2, fake_count: 0, total_spend: (i % 100) * 100, risk_level: 'Low', current_status: 'New Lead', created_at: daysAgo(60 - (i % 60), 0), updated_at: daysAgo(i % 30, i % 24) });
for (let i = 1; i <= N; i++) server.crm_leads.push({ id: i, customer_id: i, customer_name: 'Customer ' + i, mobile: String(9000000000 + i), product: 'Product ' + (i % 10), source: 'Import', expected_amount: 999, priority: 'Medium', status: i % 3 === 0 ? 'Order Booked' : i % 3 === 1 ? 'New Lead' : 'Interested', assigned_agent: '', assigned_to: '', notes: '', created_at: daysAgo(60 - (i % 60), 0), updated_at: daysAgo(i % 30, i % 24) });
for (let i = 1; i <= N / 2; i++) server.crm_orders.push({ id: i, order_id: 'ORD-' + String(100000 + i), lead_id: i * 2 - 1, customer_id: i * 2 - 1, product: 'Product ' + (i % 10), qty: 1, cod_amount: 999, discount: 0, delivery_charge: 0, cod_charge: 0, payment_mode: 'COD', status: i % 4 === 0 ? 'Delivered' : 'Order Booked', order_date: daysAgo(30 - (i % 30), 0), booked_by: '', booked_by_name: '', created_at: daysAgo(30 - (i % 30), 0), updated_at: daysAgo(i % 15, i % 24) });
for (let i = 1; i <= N / 5; i++) server.crm_spacel_followups.push({ id: i, lead_id: i, customer_id: i, action: 'Scheduled', status: 'pending', notes: '', agent_name: 'Agent', created_at: daysAgo(40 - (i % 40), 0) });
for (let i = 1; i <= N + 2000; i++) server.crm_timeline_logs.push({ id: i, customer_id: (i % N) + 1, entity_type: 'Lead', entity_id: i, action: 'Status Updated', notes: '', agent_name: 'Agent', created_at: daysAgo(60 - (i % 60), i % 24) });
for (let i = 1; i <= N / 4; i++) server.crm_notifications.push({ id: i, title: 'N' + i, message: 'msg', type: 'info', is_read: 0, link_to: '/leads', created_at: daysAgo(20 - (i % 20), 0) });
for (let i = 1; i <= N + 5000; i++) server.crm_call_logs.push({ id: i, lead_id: (i % N) + 1, customer_id: (i % N) + 1, telecaller_id: '1', telecaller_name: 'Agent', status: 'Calling', notes: '', duration_sec: 60, created_at: daysAgo(45 - (i % 45), i % 24) });
const serverTotal = Object.values(server).reduce((a, r) => a + r.length, 0);
const UPDATED_COLS = { crm_customers: 'updated_at', crm_leads: 'updated_at', crm_orders: 'updated_at', crm_spacel_followups: 'created_at', crm_timeline_logs: 'created_at', crm_notifications: 'created_at', crm_call_logs: 'created_at' };
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
      rows[t] = since ? all.filter((r) => String(r[UPDATED_COLS[t] || 'updated_at']) > since) : all;
    }
    return res({ rows, deleted: {}, pulledAt: nowIso(), epoch: 0 });
  }
  if (path === '/api/sync/count') return res({ count: (server[url.searchParams.get('table') || ''] || []).length });
  if (path === '/api/intake/pending') return res({ data: [] });
  if (path === '/api/orders/status') return res({ rows: [], serverTime: nowIso() });
  if (path === '/api/sync/push') return res({ id: 1 });
  return res({ ok: true });
};
import { startOnlineSync, stopOnlineSync, pullNow } from '../src/db/onlineSync';
import { db } from '../src/db/db';
let writeOps = 0;
for (const tn of ['customers','leads','orders','spacelFollowups','timelineLogs','notifications','callLogs','syncMap','syncQueue']) { const tt = (db)[tn]; for (const m of ['add','put','bulkPut','bulkAdd','update','delete','bulkDelete']) { const o = tt[m].bind(tt); tt[m] = (...a) => { writeOps++; return o(...a); }; } }
const count = async (t) => (db)[t].count();
const ms = () => performance.now();
(async () => {
  console.log('\n===== PERF BENCHMARK (server rows: ' + serverTotal + ', N=' + N + ') =====\n');
  let t0 = ms();
  await pullNow(false);
  let t1 = ms();
  const evT1 = writeOps; writeOps = 0;
  console.log('T1 initial full pull      : ' + (t1 - t0).toFixed(0) + ' ms  (changes events fired: ' + evT1 + ')');
  console.log('   leads=' + (await count('leads')) + ' customers=' + (await count('customers')) + ' orders=' + (await count('orders')) + ' timelineLogs=' + (await count('timelineLogs')) + ' callLogs=' + (await count('callLogs')));
  for (let i = 1; i <= 5; i++) server.crm_leads[i].updated_at = nowIso();
  server.crm_leads.push({ id: N + 1, customer_id: 1, customer_name: 'New', mobile: '9111111111', product: 'X', source: 'Test', expected_amount: 100, priority: 'Medium', status: 'New Lead', assigned_agent: '', assigned_to: '', notes: '', created_at: nowIso(), updated_at: nowIso() });
  t0 = ms();
  await pullNow(false);
  t1 = ms();
  const evT2 = writeOps; writeOps = 0;
  console.log('T2 incremental pull      : ' + (t1 - t0).toFixed(0) + ' ms  (changes events fired: ' + evT2 + ')');
  console.log('   leads now = ' + (await count('leads')) + ' (expect ' + (N + 1) + ')');
  t0 = ms();
  await pullNow(true);
  t1 = ms();
  const evT3 = writeOps; writeOps = 0;
  console.log('T3 tab-return full pull  : ' + (t1 - t0).toFixed(0) + ' ms  (changes events fired: ' + evT3 + ')');
  console.log('   leads=' + (await count('leads')) + ' customers=' + (await count('customers')) + ' timelineLogs=' + (await count('timelineLogs')) + ' callLogs=' + (await count('callLogs')));
  await stopOnlineSync();
  console.log('\n===== DONE =====\n');
  process.exit(0);
})();
