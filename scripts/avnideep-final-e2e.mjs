#!/usr/bin/env node
/* ============================================================================
 * FINAL E2E — Avnideep CRM (GitHub wala)
 * 2 TEST telecallers × 50 leads, full workflow + permissions + sync + cleanup
 * ==========================================================================*/
const B = process.env.API_BASE || 'http://127.0.0.1:8788';
const UNIQ = Date.now().toString().slice(-5);
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail !== undefined ? ' — ' + detail : ''}`); };
async function api(method, path, body, token, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const ADMIN = '9876543210', ADMIN_PIN = '1234';
const INTAKE_KEY = process.env.INTAKE_KEY || 'local-intake-key';

(async () => {
  console.log('\n════════ AVNIDEEP CRM — FINAL E2E (uniq ' + UNIQ + ') ════════\n');
  const test = { users: [], leads: [], orders: [], customers: [], invoices: [] };

  // ── Setup ──
  const health = await fetch(B + '/api/health').then(r => r.json().catch(() => ({})));
  log('S1: worker health', health?.ok === true);

  const admin = await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' });
  const AT = admin.json?.token;
  log('S2: admin login (9876543210/1234)', admin.status === 200 && !!AT);

  const mkTC = async (name, phone) => {
    const r = await api('POST', '/api/auth/register', { mobile: phone, name, pin: '5555', role: 'telecaller' }, AT);
    const lg = await api('POST', '/api/auth/login', { mobile: phone, pin: '5555', role: 'telecaller' });
    test.users.push(r.json?.userId || r.json?.id);
    return { id: String(r.json?.userId || r.json?.id || ''), phone, token: lg.json?.token, name };
  };
  const TC1 = await mkTC('E2E_TC_1', '97' + UNIQ + '111');
  const TC2 = await mkTC('E2E_TC_2', '97' + UNIQ + '222');
  log('S3: TEST_TC_1 + TEST_TC_2 created & logged in', !!TC1.id && !!TC2.id && !!TC1.token && !!TC2.token, TC1.id + ' / ' + TC2.id);

  // ── 100 leads (push via sync) ──
  const pushLead = async (i, tag) => {
    const mobile = '96' + UNIQ.slice(0, 2) + String(100 + i).padStart(2, '0') + tag;
    const r = await api('POST', '/api/sync/push', { table: 'crm_leads', row: {
      mobile, customer_name: 'E2E Lead ' + tag + ' #' + String(i + 1).padStart(2, '0'), product: 'E2E Product',
      source: 'e2e', status: 'New Lead', expected_amount: 1500 + i * 10, priority: 'Medium', assigned_to: null, assigned_agent: null,
    } }, AT);
    return r.json?.id ? { id: Number(r.json.id), mobile } : null;
  };
  const L1 = [], L2 = [];
  for (let i = 0; i < 50; i++) { const l = await pushLead(i, 'A'); if (l) L1.push(l); }
  for (let i = 0; i < 50; i++) { const l = await pushLead(i, 'B'); if (l) L2.push(l); }
  test.leads.push(...L1.map(l => l.id), ...L2.map(l => l.id));
  log('P1: 100 leads created via sync push', L1.length === 50 && L2.length === 50, `${L1.length}+${L2.length}`);

  // ── Assign 50/50 (bulk assign with skipped count — bugfix 3) ──
  const a1 = await api('POST', '/api/leads/assign', { leadIds: L1.map(l => l.id), assignToId: TC1.id }, AT);
  const a2 = await api('POST', '/api/leads/assign', { leadIds: L2.map(l => l.id), assignToId: TC2.id }, AT);
  log('P2: bulk assign 50 → TC1, 50 → TC2 (skipped=0)', a1.json?.assigned === 50 && a1.json?.skipped === 0 && a2.json?.assigned === 50, JSON.stringify({ a: a1.json?.assigned, s: a1.json?.skipped, b: a2.json?.assigned }));

  // ── Isolation: TC pulls ONLY own 50 ──
  const t1Pull = await api('GET', '/api/sync/pull?tables=crm_leads', null, TC1.token);
  const t2Pull = await api('GET', '/api/sync/pull?tables=crm_leads', null, TC2.token);
  const t1Leads = t1Pull.json?.rows?.crm_leads ?? [];
  const t2Leads = t2Pull.json?.rows?.crm_leads ?? [];
  const own1 = t1Leads.filter(l => String(l.assigned_to) === TC1.id).length;
  const own2 = t2Leads.filter(l => String(l.assigned_to) === TC2.id).length;
  log('P3: TC1 pulls exactly 50 own leads', t1Leads.length === 50 && own1 === 50, `total=${t1Leads.length} own=${own1}`);
  log('P3: TC2 pulls exactly 50 own leads', t2Leads.length === 50 && own2 === 50, `total=${t2Leads.length} own=${own2}`);
  const t1m = new Set(t1Leads.map(l => l.mobile)), t2m = new Set(t2Leads.map(l => l.mobile));
  let overlap = 0; t1m.forEach(m => { if (t2m.has(m)) overlap++; });
  log('P3: ZERO cross-over between TC1/TC2', overlap === 0, `overlap=${overlap}`);

  // ── TC1 works own lead: status + notes ──
  const w1 = t1Leads[0], w2 = t1Leads[1];
  const st1 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w1.id, status: 'Interested', notes: 'E2E: customer interested' } }, TC1.token);
  log('P4: TC1 updates own lead status → Interested', st1.status === 200);
  const chk = await api('GET', '/api/sync/pull?tables=crm_leads', null, AT);
  const w1after = (chk.json?.rows?.crm_leads ?? []).find(l => l.id === w1.id);
  log('P4: status saved in D1 (admin pull sees Interested + notes)', w1after?.status === 'Interested' && String(w1after?.notes || '').includes('interested'), `${w1after?.status}`);

  // ── TC2 lead access control ──
  const other = t2Leads[0];
  const o1 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: other.id, status: 'Fake Lead' } }, TC1.token);
  const otherAfter = (await api('GET', '/api/sync/pull?tables=crm_leads', null, AT)).json?.rows?.crm_leads?.find(l => l.id === other.id);
  log('P5: TC1 cannot change TC2 lead (status unchanged)', otherAfter?.status !== 'Fake Lead', `status=${otherAfter?.status}`);

  const o2 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: other.id, mobile: '9999999999' } }, TC1.token);
  const otherAfter2 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, AT)).json?.rows?.crm_leads?.find(l => l.id === other.id);
  log('P5: TC1 cannot change TC2 lead mobile (unchanged)', otherAfter2?.mobile !== '9999999999');

  // TC1 tries mobile edit on OWN lead → blocked (field restriction)
  const o3 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w2.id, mobile: '8888888888' } }, TC1.token);
  const w2after = (await api('GET', '/api/sync/pull?tables=crm_leads', null, AT)).json?.rows?.crm_leads?.find(l => l.id === w2.id);
  log('P5: TC1 cannot change mobile on OWN lead either (server strips)', w2after?.mobile !== '8888888888', `mobile=${w2after?.mobile}`);

  const o4 = await api('POST', '/api/sync/delete', { table: 'crm_leads', id: w1.id }, TC1.token);
  log('P5: TC cannot delete lead → 403 (admin-only)', o4.status === 403, `status=${o4.status}`);

  // ── Order booking by TC1 (server forces Order Booked + booked_by) ──
  const ord = await api('POST', '/api/sync/push', { table: 'crm_orders', row: {
    order_id: 'ORD-E2E-' + UNIQ + '-1', lead_id: w1.id, customer_id: 0, product: 'E2E Product',
    qty: 1, cod_amount: 150000, status: 'Delivered', // TC tries to force Delivered!
  } }, TC1.token);
  const ordId = Number(ord.json?.id || 0);
  test.orders.push(ordId);
  const ordAfter = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === ordId);
  log('P6: TC order created but status forced to Order Booked (not Delivered)', ordAfter?.status === 'Order Booked', `status=${ordAfter?.status}`);
  log('P6: booked_by = TC1 (commission attribution)', String(ordAfter?.booked_by) === TC1.id || ordAfter?.booked_by_name === 'E2E_TC_1', `${ordAfter?.booked_by_name}`);

  // ── TC cannot change order shipment status ──
  const o5 = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: ordId, status: 'Delivered', courier: 'FAKE', tracking_id: 'FAKE-AWB' } }, TC1.token);
  const ordAfter2 = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === ordId);
  log('P7: TC cannot set Delivered/courier/AWB on order (stripped)', ordAfter2?.status === 'Order Booked' && !ordAfter2?.courier, `status=${ordAfter2?.status} courier=${ordAfter2?.courier}`);

  // ── Admin full shipment workflow ──
  const flow = ['Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery', 'Delivered'];
  let flowOk = true;
  for (const s of flow) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: ordId, status: s, courier: 'Delhivery', tracking_id: 'DLH-E2E-' + UNIQ } }, AT);
    if (r.status !== 200) flowOk = false;
  }
  const ordFinal = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === ordId);
  log('P8: Admin full workflow → Delivered', flowOk && ordFinal?.status === 'Delivered', `status=${ordFinal?.status}`);

  // ── TC sees delivered read-only (sync) ──
  const t1Orders = (await api('GET', '/api/sync/pull?tables=crm_orders', null, TC1.token)).json?.rows?.crm_orders ?? [];
  const myOrd = t1Orders.find(o => o.id === ordId);
  log('P8: TC sees Delivered + tracking read-only', myOrd?.status === 'Delivered' && myOrd?.tracking_id === 'DLH-E2E-' + UNIQ, `${myOrd?.status} ${myOrd?.tracking_id}`);

  // ── Invoice: admin-only ──
  const invAdm = await api('GET', '/api/invoices?order_id=' + ordId, null, AT);
  log('P9: admin sees invoice for order (auto-invoice bugfix 5)', invAdm.status === 200 && (invAdm.json?.invoices ?? []).length >= 1, `invoices=${invAdm.json?.invoices?.length}`);
  const invTC = await api('GET', '/api/invoices', null, TC1.token);
  log('P9: TC invoice access → 403', invTC.status === 403, `status=${invTC.status}`);
  const tcPushInv = await api('POST', '/api/sync/push', { table: 'crm_invoices', row: { invoice_number: 'HACK', order_id: ordId } }, TC1.token);
  log('P9: TC cannot push invoice rows → 403', tcPushInv.status === 403);

  // ── Reassign 5 leads TC1 → TC2 (bugfix 2 + 3) ──
  const five = L1.slice(0, 5).map(l => l.id);
  const ra = await api('POST', '/api/leads/assign', { leadIds: five, assignToId: TC2.id, reassign: true }, AT);
  const after1 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, TC1.token)).json?.rows?.crm_leads ?? [];
  const after2 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, TC2.token)).json?.rows?.crm_leads ?? [];
  const fiveOwnedBy2 = after2.filter(l => five.includes(l.id)).length;
  log('P10: reassign 5 → TC2 (assigned=5)', ra.json?.assigned === 5, `assigned=${ra.json?.assigned} skipped=${ra.json?.skipped}`);
  log('P10: counts immediately correct (TC1=45, TC2=55)', after1.length === 45 && after2.length === 55, `TC1=${after1.length} TC2=${after2.length}`);
  log('P10: ownership of reassigned = TC2', fiveOwnedBy2 === 5, `owned=${fiveOwnedBy2}`);

  // ── Timeline history (bugfix 2) ──
  const tl = (await api('GET', '/api/sync/pull?tables=crm_timeline_logs', null, AT)).json?.rows?.crm_timeline_logs ?? [];
  const assignLogs = tl.filter(x => String(x.action || '').toLowerCase().includes('assign'));
  log('P11: assignment history in timeline (105 assigns logged)', assignLogs.length >= 105, `entries=${assignLogs.length}`);

  // ── Duplicate protection (bugfix 1: intake dedup + customer dedup) ──
  const dupMob = '98' + UNIQ + '999';
  const i1 = await fetch(B + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Key': INTAKE_KEY }, body: JSON.stringify({ mobile: dupMob, name: 'Dup Test' }) }).then(r => r.json());
  const i2 = await fetch(B + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Key': INTAKE_KEY }, body: JSON.stringify({ mobile: dupMob, name: 'Dup Test 2' }) }).then(r => r.json());
  log('P12: intake dedup — same mobile → same id, duplicate:true', i1?.id && i1.id === i2?.id && i2?.duplicate === true, JSON.stringify({ a: i1?.id, b: i2?.id, dup: i2?.duplicate }));

  const c1 = await api('POST', '/api/sync/push', { table: 'crm_customers', row: { mobile: '95' + UNIQ + '001', name: 'Dup Cust' } }, AT);
  const c2 = await api('POST', '/api/sync/push', { table: 'crm_customers', row: { mobile: '95' + UNIQ + '001', name: 'Dup Cust 2' } }, AT);
  log('P12: customer dedup — same mobile → same cloud id', c1.json?.id === c2.json?.id, `${c1.json?.id} vs ${c2.json?.id}`);

  // ── Persistence: re-login + re-pull ──
  const relog = await api('POST', '/api/auth/login', { mobile: TC1.phone, pin: '5555', role: 'telecaller' });
  const repull = (await api('GET', '/api/sync/pull?tables=crm_leads', null, relog.json?.token)).json?.rows?.crm_leads ?? [];
  log('P13: re-login → leads still present (45)', repull.length === 45, `count=${repull.length}`);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.ok).length;
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`));
  console.log(`\nAVNIDEEP FINAL E2E: ${passed}/${results.length} passed`);
  console.log('TEST IDS (for cleanup):', JSON.stringify({ uniq: UNIQ, users: test.users, tc1_phone: TC1.phone, tc2_phone: TC2.phone, tc1_id: TC1.id, tc2_id: TC2.id, leads: test.leads.slice(0, 5) + '...', orders: test.orders }));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
