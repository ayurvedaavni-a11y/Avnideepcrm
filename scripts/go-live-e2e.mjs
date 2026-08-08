#!/usr/bin/env node
/* ============================================================================
 * GO-LIVE E2E — Avnideep CRM: admin + telecaller readiness verification
 * Realistic flows for BOTH roles + persistence + cleanup markers.
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
const test = { users: [], leads: [], orders: [] };

(async () => {
  console.log('\n════════ GO-LIVE E2E (uniq ' + UNIQ + ') ════════\n');

  // ─────────── ADMIN FLOW ───────────
  const admin = await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' });
  const AT = admin.json?.token;
  log('A1: Admin login (9876543210/1234)', admin.status === 200 && !!AT);

  const me = await api('GET', '/api/auth/me', null, AT);
  log('A2: Admin session restore (/auth/me)', me.status === 200 && me.json?.profile?.role === 'admin', me.json?.profile?.role);

  // Admin: create 2 telecallers (real team members)
  const mkTC = async (name, phone) => {
    const r = await api('POST', '/api/auth/register', { mobile: phone, name, pin: '5678', role: 'telecaller' }, AT);
    test.users.push(r.json?.userId || r.json?.id);
    const lg = await api('POST', '/api/auth/login', { mobile: phone, pin: '5678', role: 'telecaller' });
    return { id: String(r.json?.userId || r.json?.id || ''), phone, token: lg.json?.token, name };
  };
  const TC1 = await mkTC('GoLive_TC1', '91' + UNIQ + '101');
  const TC2 = await mkTC('GoLive_TC2', '91' + UNIQ + '202');
  log('A3: Admin creates 2 telecallers + they log in', !!TC1.id && !!TC2.id && !!TC1.token && !!TC2.token, `${TC1.name}/${TC2.name}`);

  const team = await api('GET', '/api/auth/team', null, AT);
  log('A4: Admin sees team list with both TCs', (team.json?.members ?? []).some(m => m.mobile === TC1.phone) && (team.json?.members ?? []).some(m => m.mobile === TC2.phone));

  // Admin: block + unblock telecaller (account management)
  const blk = await api('PATCH', '/api/auth/member/' + TC2.id, { is_active: 0 }, AT);
  const blkLogin = await api('POST', '/api/auth/login', { mobile: TC2.phone, pin: '5678', role: 'telecaller' });
  const unblk = await api('PATCH', '/api/auth/member/' + TC2.id, { is_active: 1 }, AT);
  const unblkLogin = await api('POST', '/api/auth/login', { mobile: TC2.phone, pin: '5678', role: 'telecaller' });
  log('A5: Admin block TC2 → login blocked; unblock → login works', blk.status === 200 && blkLogin.status === 403 && unblk.status === 200 && unblkLogin.status === 200, `blocked=${blkLogin.status} unblocked=${unblkLogin.status}`);

  // Admin: settings + commission rate
  const set = await api('PATCH', '/api/settings', { key: 'commission_rate', value: '10' }, AT);
  const setGet = await api('GET', '/api/settings', null, AT);
  log('A6: Admin settings (commission_rate=10%) works', set.status === 200 && setGet.json?.settings?.commission_rate === '10');

  // Admin: intake config + push 6 leads
  const L = [];
  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_leads', row: {
      mobile: '92' + UNIQ + String(30 + i), customer_name: 'GoLive Lead ' + (i + 1), product: 'Kitchen Set',
      source: 'go-live', status: 'New Lead', expected_amount: 2500 + i * 100, priority: 'Medium', assigned_to: null, assigned_agent: null,
    } }, AT);
    if (r.json?.id) { L.push(Number(r.json.id)); test.leads.push(Number(r.json.id)); }
  }
  log('A7: Admin creates 6 leads', L.length === 6);

  const a1 = await api('POST', '/api/leads/assign', { leadIds: [L[0], L[1], L[2]], assignToId: TC1.id }, AT);
  const a2 = await api('POST', '/api/leads/assign', { leadIds: [L[3], L[4], L[5]], assignToId: TC2.id }, AT);
  log('A8: Admin assigns 3 leads to each TC', a1.json?.assigned === 3 && a2.json?.assigned === 3, `TC1:${a1.json?.assigned} TC2:${a2.json?.assigned}`);

  // ─────────── TELECALLER FLOW ───────────
  const t1Pull = await api('GET', '/api/sync/pull?tables=crm_leads', null, TC1.token);
  const t1Leads = t1Pull.json?.rows?.crm_leads ?? [];
  log('T1: TC1 sees ONLY own 3 leads', t1Leads.length === 3 && t1Leads.every(l => String(l.assigned_to) === TC1.id), `count=${t1Leads.length}`);

  // TC1: work the leads (status updates + call log)
  const w = t1Leads[0];
  const s1 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w.id, status: 'Interested', notes: 'customer wants red color' } }, TC1.token);
  const s2 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: t1Leads[1].id, status: 'Followup', followup_date: new Date().toISOString().slice(0,10), followup_time: '18:00' } }, TC1.token);
  const chk = await api('GET', '/api/sync/pull?tables=crm_leads', null, AT);
  const chkLeads = chk.json?.rows?.crm_leads ?? [];
  log('T2: TC1 status updates saved in D1 (Interested + Followup)', (chkLeads.find(l => l.id === w.id)?.status) === 'Interested' && (chkLeads.find(l => l.id === t1Leads[1].id)?.status) === 'Followup');

  // TC1: mobile edit blocked
  const mobTry = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: w.id, mobile: '9999999999' } }, TC1.token);
  const chk2 = await api('GET', '/api/sync/pull?tables=crm_leads', null, AT);
  log('T3: TC1 mobile edit blocked (server strips)', (chk2.json?.rows?.crm_leads ?? []).find(l => l.id === w.id)?.mobile !== '9999999999');

  // TC2 lead access control
  const t2w = t1Leads.length ? null : null;
  const t2Pull = await api('GET', '/api/sync/pull?tables=crm_leads', null, TC2.token);
  const t2Lead = (t2Pull.json?.rows?.crm_leads ?? [])[0];
  const cross = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: t2Lead.id, status: 'Fake Lead' } }, TC1.token);
  const chk3 = await api('GET', '/api/sync/pull?tables=crm_leads', null, AT);
  log('T4: TC1 cannot touch TC2 lead (status unchanged)', (chk3.json?.rows?.crm_leads ?? []).find(l => l.id === t2Lead.id)?.status !== 'Fake Lead');

  // TC1: book an order (server forces Order Booked + booked_by)
  const ord = await api('POST', '/api/sync/push', { table: 'crm_orders', row: {
    order_id: 'ORD-GOLIVE-' + UNIQ, lead_id: w.id, customer_id: 0, product: 'Kitchen Set', qty: 1,
    cod_amount: 250000, status: 'Delivered',
  } }, TC1.token);
  const ordId = Number(ord.json?.id || 0);
  test.orders.push(ordId);
  const ordChk = await api('GET', '/api/sync/pull?tables=crm_orders', null, AT);
  const ordRow = (ordChk.json?.rows?.crm_orders ?? []).find(o => o.id === ordId);
  log('T5: TC1 books order → forced Order Booked + booked_by=TC1', ordRow?.status === 'Order Booked' && (String(ordRow?.booked_by) === TC1.id || ordRow?.booked_by_name === 'GoLive_TC1'), `status=${ordRow?.status} booked_by=${ordRow?.booked_by_name}`);

  // TC1: cannot change shipment status/courier/AWB
  const shipTry = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: ordId, status: 'Delivered', courier: 'FAKE', tracking_id: 'FAKE-AWB' } }, TC1.token);
  const ordChk2 = await api('GET', '/api/sync/pull?tables=crm_orders', null, AT);
  const ordRow2 = (ordChk2.json?.rows?.crm_orders ?? []).find(o => o.id === ordId);
  log('T6: TC1 shipment/courier/AWB change STRIPPED', ordRow2?.status === 'Order Booked' && !ordRow2?.courier, `status=${ordRow2?.status}`);

  // Admin: full shipment workflow
  const flow = ['Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery', 'Delivered'];
  let flowOk = true;
  for (const s of flow) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_orders', row: { id: ordId, status: s, courier: 'Delhivery', tracking_id: 'DLH-GL-' + UNIQ } }, AT);
    if (r.status !== 200) flowOk = false;
  }
  const ordFinal = await api('GET', '/api/sync/pull?tables=crm_orders', null, AT);
  log('A9: Admin full shipment workflow → Delivered', flowOk && (ordFinal.json?.rows?.crm_orders ?? []).find(o => o.id === ordId)?.status === 'Delivered');

  // TC1 sees delivered read-only
  const t1Orders = (await api('GET', '/api/sync/pull?tables=crm_orders', null, TC1.token)).json?.rows?.crm_orders ?? [];
  const myOrd = t1Orders.find(o => o.id === ordId);
  log('T7: TC1 sees Delivered + tracking read-only', myOrd?.status === 'Delivered' && myOrd?.tracking_id === 'DLH-GL-' + UNIQ);

  // Invoice: admin sees, TC blocked
  const invAdm = await api('GET', '/api/invoices?order_id=' + ordId, null, AT);
  log('A10: Admin sees auto-invoice for order', invAdm.status === 200 && (invAdm.json?.invoices ?? []).length >= 1, `invoices=${invAdm.json?.invoices?.length}`);
  const invTC = await api('GET', '/api/invoices', null, TC1.token);
  log('T8: TC invoice access → 403', invTC.status === 403, `status=${invTC.status}`);

  // ─────────── PERSISTENCE / LOGOUT-LOGIN ───────────
  const relog = await api('POST', '/api/auth/login', { mobile: TC1.phone, pin: '5678', role: 'telecaller' });
  const repull = (await api('GET', '/api/sync/pull?tables=crm_leads', null, relog.json?.token)).json?.rows?.crm_leads ?? [];
  log('P1: TC1 logout→login → leads persist', repull.length === 3, `count=${repull.length}`);

  const repullO = (await api('GET', '/api/sync/pull?tables=crm_orders', null, relog.json?.token)).json?.rows?.crm_orders ?? [];
  log('P2: TC1 orders persist after re-login (Delivered order visible)', repullO.some(o => o.id === ordId && o.status === 'Delivered'));

  const adminRelog = await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' });
  const repullA = (await api('GET', '/api/sync/pull?tables=crm_leads', null, adminRelog.json?.token)).json?.rows?.crm_leads ?? [];
  log('P3: Admin re-login → all leads + activity persist', repullA.length >= 6);

  const tl = (await api('GET', '/api/sync/pull?tables=crm_timeline_logs', null, AT)).json?.rows?.crm_timeline_logs ?? [];
  const assignLogs = tl.filter(x => String(x.action || '').toLowerCase().includes('assign'));
  log('A11: Assignment history logged (admin audit trail)', assignLogs.length >= 6, `entries=${assignLogs.length}`);

  // ─────────── DUPLICATE PROTECTION ───────────
  const dupMob = '93' + UNIQ + '777';
  const i1 = await fetch(B + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Key': process.env.INTAKE_KEY || 'local-intake-key' }, body: JSON.stringify({ mobile: dupMob, name: 'GL Dup' }) }).then(r => r.json());
  const i2 = await fetch(B + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Key': process.env.INTAKE_KEY || 'local-intake-key' }, body: JSON.stringify({ mobile: dupMob, name: 'GL Dup 2' }) }).then(r => r.json());
  log('D1: Intake duplicate → same id + duplicate:true', i1?.id && i1.id === i2?.id && i2?.duplicate === true);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.ok).length;
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`));
  console.log(`\nGO-LIVE E2E: ${passed}/${results.length} passed`);
  console.log('CLEANUP_IDS=' + JSON.stringify({ users: test.users, leads: test.leads, orders: test.orders, tc1: TC1.phone, tc2: TC2.phone }));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
