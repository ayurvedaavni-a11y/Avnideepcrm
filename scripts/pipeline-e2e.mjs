#!/usr/bin/env node
/* ============================================================================
 * PIPELINE E2E — Actual CRM: Leads → Telecaller → Order → Logistics →
 * Delivered / RTO / Cancelled → Invoice (complete journey, 3 outcomes)
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
const test = { users: [], leads: [], orders: [], customers: [], invoices: [] };

(async () => {
  console.log('\n════════ PIPELINE E2E — FULL JOURNEY (uniq ' + UNIQ + ') ════════\n');

  // ═══ STEP 0: ADMIN LOGIN ═══
  const admin = await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' });
  const AT = admin.json?.token;
  log('S0: Admin login', admin.status === 200 && !!AT);

  // ═══ STEP 1: LEADS (4 leads — 1 for TC working demo, 3 for the 3 outcomes) ═══
  const L = [];
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_leads', row: {
      mobile: '94' + UNIQ + String(40 + i), customer_name: `Pipe Lead ${i + 1}`,
      product: i === 3 ? 'Air Fryer' : 'Kitchen Set', source: 'pipeline-e2e',
      status: 'New Lead', expected_amount: 3000 + i * 250, priority: 'Medium',
      assigned_to: null, assigned_agent: null,
    } }, AT);
    if (r.json?.id) { L.push(Number(r.json.id)); test.leads.push(Number(r.json.id)); }
  }
  log('S1: 4 leads created (2 products)', L.length === 4);

  // ═══ STEP 2: TELECALLER ═══
  const tc = await api('POST', '/api/auth/register', { mobile: '93' + UNIQ + '999', name: 'Pipe_TC', pin: '1111', role: 'telecaller' }, AT);
  test.users.push(tc.json?.userId || tc.json?.id);
  const TC_ID = String(tc.json?.userId || tc.json?.id || '');
  const tcLogin = await api('POST', '/api/auth/login', { mobile: '93' + UNIQ + '999', pin: '1111', role: 'telecaller' });
  const TT = tcLogin.json?.token;
  log('S2: Telecaller created + logged in', !!TC_ID && !!TT, TC_ID);

  const asg = await api('POST', '/api/leads/assign', { leadIds: L, assignToId: TC_ID }, AT);
  log('S3: All 4 leads assigned to telecaller', asg.json?.assigned === 4, `assigned=${asg.json?.assigned}`);

  // ═══ STEP 3: TELECALLER WORKS LEADS (status path) ═══
  const t1Pull = await api('GET', '/api/sync/pull?tables=crm_leads', null, TT);
  const myLeads = t1Pull.json?.rows?.crm_leads ?? [];
  log('S4: TC sees only own 4 leads', myLeads.length === 4 && myLeads.every(l => String(l.assigned_to) === TC_ID));

  // Lead 1: New → Calling → Interested (full telecaller journey)
  const w1 = myLeads.find(l => l.id === L[0]);
  const w2 = myLeads.find(l => l.id === L[1]);
  const w3 = myLeads.find(l => l.id === L[2]);
  const w4 = myLeads.find(l => l.id === L[3]);

  const c1 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w1.id, status: 'Calling', notes: 'first call ringing' } }, TT);
  const c2 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w1.id, status: 'Interested', notes: 'price agreed, wants delivery' } }, TT);
  const chk = await api('GET', '/api/sync/pull?tables=crm_leads', null, AT);
  const chkLeads = chk.json?.rows?.crm_leads ?? [];
  log('S5: TC status path New→Calling→Interested saved in D1', (chkLeads.find(l => l.id === w1.id)?.status) === 'Interested', (chkLeads.find(l => l.id === w1.id)?.status));

  // Lead 2 → Follow-up set
  await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w2.id, status: 'Followup', followup_date: new Date().toISOString().slice(0, 10), followup_time: '17:30', notes: 'call back tomorrow' } }, TT);
  // Lead 4 → Interested (will be the RTO order)
  await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w4.id, status: 'Interested' } }, TT);

  // ═══ STEP 4: ORDERS BOOKED BY TELECALLER (3 orders) ═══
  const mkOrder = async (lead, tag, amount) => {
    const r = await api('POST', '/api/sync/push', { table: 'crm_orders', row: {
      order_id: `ORD-PIPE-${UNIQ}-${tag}`, lead_id: lead.id, customer_id: 0,
      product: lead.product, qty: 1, cod_amount: amount, status: 'Delivered', // TC tries to force Delivered
    } }, TT);
    return Number(r.json?.id || 0);
  };
  const O1 = await mkOrder(w1, 'D', 350000); // → Delivered
  const O2 = await mkOrder(w4, 'R', 450000); // → RTO
  const O3 = await mkOrder(w3, 'C', 200000); // → Cancelled
  test.orders.push(O1, O2, O3);
  log('S6: TC books 3 orders (status forced to Order Booked)', O1 > 0 && O2 > 0 && O3 > 0, `${O1},${O2},${O3}`);

  const ordChk = await api('GET', '/api/sync/pull?tables=crm_orders', null, AT);
  const ordRows = ordChk.json?.rows?.crm_orders ?? [];
  const o1row = ordRows.find(o => o.id === O1);
  log('S6b: Order status = Order Booked (not Delivered) + booked_by=TC', o1row?.status === 'Order Booked' && (String(o1row?.booked_by) === TC_ID || o1row?.booked_by_name === 'Pipe_TC'), `${o1row?.status} / ${o1row?.booked_by_name}`);
  log('S6c: Order fields correct (product/qty/cod)', o1row?.product === 'Kitchen Set' && Number(o1row?.qty) === 1 && Number(o1row?.cod_amount) === 350000);

  // Lead status → Order Booked after conversion
  const leadAfter = await api('GET', '/api/sync/pull?tables=crm_leads', null, AT);
  log('S6d: Converted leads now Order Booked (not in active pipeline)', (leadAfter.json?.rows?.crm_leads ?? []).filter(l => [w1.id, w3.id, w4.id].includes(l.id)).every(l => l.status === 'Order Booked'));

  // ═══ STEP 5: LOGISTICS — 3 outcomes ═══
  // O1 → Delivered (full 7-stage flow)
  const flow = ['Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery', 'Delivered'];
  let flowOk = true;
  for (const s of flow) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: O1, status: s, courier: 'Delhivery', tracking_id: 'DLH-PIPE-' + UNIQ } }, AT);
    if (r.status !== 200) flowOk = false;
  }
  const o1Final = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === O1);
  log('S7: Logistics full flow → Delivered', flowOk && o1Final?.status === 'Delivered', `status=${o1Final?.status}`);

  // O2 → RTO (admin-only, reason required on worker? here push-based)
  const rtoFlow = ['Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery'];
  let rtoOk = true;
  for (const s of rtoFlow) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: O2, status: s } }, AT);
    if (r.status !== 200) rtoOk = false;
  }
  const rtoDone = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: O2, status: 'RTO' } }, AT);
  const o2Final = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === O2);
  log('S8: Logistics → RTO', rtoOk && o2Final?.status === 'RTO', `status=${o2Final?.status}`);

  // O3 → Cancelled (admin)
  const canDone = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: O3, status: 'Cancelled' } }, AT);
  const o3Final = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === O3);
  log('S9: Logistics → Cancelled', o3Final?.status === 'Cancelled', `status=${o3Final?.status}`);

  // ═══ STEP 6: INVOICES ═══
  const inv1 = await api('GET', '/api/invoices?order_id=' + O1, null, AT);
  const inv2 = await api('GET', '/api/invoices?order_id=' + O2, null, AT);
  const inv3 = await api('GET', '/api/invoices?order_id=' + O3, null, AT);
  [inv1, inv2, inv3].forEach(i => (i.json?.invoices ?? []).forEach(x => test.invoices.push(x.id)));
  log('S10: Auto-invoice for ALL 3 orders (admin)', inv1.json?.invoices?.length >= 1 && inv2.json?.invoices?.length >= 1 && inv3.json?.invoices?.length >= 1, `D:${inv1.json?.invoices?.length} R:${inv2.json?.invoices?.length} C:${inv3.json?.invoices?.length}`);
  const invVal = inv1.json?.invoices?.[0];
  log('S10b: Invoice values correct (total=cod_amount)', invVal && Number(invVal.total) === 350000, `total=${invVal?.total}`);
  const invTC = await api('GET', '/api/invoices', null, TT);
  log('S10c: TC invoice access → 403', invTC.status === 403, `status=${invTC.status}`);

  // ═══ STEP 7: TC SEES FINAL STATES READ-ONLY ═══
  const tcOrders = (await api('GET', '/api/sync/pull?tables=crm_orders', null, TT)).json?.rows?.crm_orders ?? [];
  const tcO1 = tcOrders.find(o => o.id === O1);
  const tcO2 = tcOrders.find(o => o.id === O2);
  const tcO3 = tcOrders.find(o => o.id === O3);
  log('S11: TC sees Delivered/RTO/Cancelled + tracking (read-only)', tcO1?.status === 'Delivered' && tcO1?.tracking_id === 'DLH-PIPE-' + UNIQ && tcO2?.status === 'RTO' && tcO3?.status === 'Cancelled');

  // TC cannot change any of them
  const tcfail = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: O1, status: 'Cancelled' } }, TT);
  const o1after = (await api('GET', '/api/sync/pull?tables=crm_orders', null, AT)).json?.rows?.crm_orders?.find(o => o.id === O1);
  log('S12: TC cannot change Delivered → Cancelled (stripped)', o1after?.status === 'Delivered', `status=${o1after?.status}`);

  // ═══ STEP 8: DATA INTEGRITY (customers auto-created? + timeline) ═══
  const tl = (await api('GET', '/api/sync/pull?tables=crm_timeline_logs', null, AT)).json?.rows?.crm_timeline_logs ?? [];
  // Server auto-link writes Lead timeline entries with action 'Order Booked'
  // for every order created (one per conversion) — the worker-owned audit trail.
  const orderLogs = tl.filter(x => String(x.action || '') === 'Order Booked');
  log('S13: Timeline has order-booking activity (server auto-link)', orderLogs.length >= 3, `entries=${orderLogs.length}`);
  const assignLogs = tl.filter(x => String(x.action || '').toLowerCase().includes('assign'));
  log('S13b: Assignment logged in timeline', assignLogs.length >= 1, `entries=${assignLogs.length}`);

  // Persistence
  const relog = await api('POST', '/api/auth/login', { mobile: '93' + UNIQ + '999', pin: '1111', role: 'telecaller' });
  const repull = (await api('GET', '/api/sync/pull?tables=crm_orders', null, relog.json?.token)).json?.rows?.crm_orders ?? [];
  log('S14: TC re-login → all 3 orders persist with final statuses', repull.filter(o => [O1, O2, O3].includes(o.id)).length === 3);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.ok).length;
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`));
  console.log(`\nPIPELINE E2E: ${passed}/${results.length} passed`);
  console.log('CLEANUP=' + JSON.stringify({ users: test.users, leads: test.leads, orders: test.orders, invoices: test.invoices }));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
