// ============================================================================
// bugfix-regression.mjs — regression tests for the 5 production-audit bugs
//
//  BUG 1: intake mobile dedup (DB-level uniqueness + idempotent response)
//  BUG 2: assignment/reassignment logged to crm_timeline_logs (cloud path)
//  BUG 3: bulk-assign response includes `skipped` count
//  BUG 4: worker starts locally (compatibility_date) — verified by script
//         runner + CI workflow; here we assert the health endpoint works
//         (worker booted = compatibility OK).
//  BUG 5: server-side auto-invoice for telecaller-created orders, with
//         invoice access kept admin-only.
//
// Run:  node scripts/bugfix-regression.mjs   (worker must be on :8788)
// ============================================================================
const B = process.env.API_BASE || 'http://127.0.0.1:8788';
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail !== undefined ? ' — ' + detail : ''}`); };

async function api(method, path, body, token, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

(async () => {
  const UNIQ = Date.now().toString().slice(-5);
  const ADMIN = '9876543210', ADMIN_PIN = '1234';
  const INTAKE_KEY = process.env.INTAKE_KEY || 'local-intake-key';
  console.log('\n=== BUGFIX REGRESSION (uniq ' + UNIQ + ') ===\n');

  // ── BUG 4: worker boots (health) — compatibility_date fix ──
  const health = await fetch(B + '/api/health').then((r) => r.json().catch(() => ({})));
  log('[BUG4] worker boots locally (compatibility_date OK)', health?.ok === true);

  const admin = await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' });
  log('[setup] admin login', admin.status === 200 && !!admin.json?.token);
  const AT = admin.json.token;

  // ── BUG 1: intake dedup ──
  const mob = '96' + UNIQ + '101';
  const i1 = await api('POST', '/api/intake', { mobile: mob, name: 'First', source: 'reg' }, null, { 'X-Intake-Key': INTAKE_KEY });
  const i2 = await api('POST', '/api/intake', { mobile: mob, name: 'Second', source: 'reg' }, null, { 'X-Intake-Key': INTAKE_KEY });
  log('[BUG1] intake idempotent — same id on duplicate', !!i1.json?.id && i1.json.id === i2.json.id && i1.json.duplicate === false && i2.json.duplicate === true, JSON.stringify({ a: i1.json, b: i2.json }).slice(0, 120));
  const dbCount = await api('GET', '/api/sync/count?table=leads', null, AT);
  // count table leads includes intake rows; we verify via count endpoint that
  // intake table access works — exact row check happens in lead-api-audit2.
  log('[BUG1] intake table queryable (admin)', dbCount.status === 200);

  // ── BUG 2 + 3: assignment timeline + skipped count ──
  const TC = '94' + UNIQ + '202';
  await api('POST', '/api/auth/register', { mobile: TC, name: 'Reg TC', pin: '5555', role: 'telecaller' }, AT);
  const team = (await api('GET', '/api/auth/team', null, AT)).json?.members;
  const tc = team.find((m) => m.mobile === TC);
  const tcToken = (await api('POST', '/api/auth/login', { mobile: TC, pin: '5555', role: 'telecaller' })).json?.token;

  const leadIds = [];
  for (let i = 0; i < 3; i++) {
    const r = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: Date.now().toString() + i, mobile: '93' + UNIQ + '2' + i, customer_name: 'Reg Lead ' + i, status: 'New', source: 'reg', assigned_to: null, assigned_agent: null } }, AT);
    if (r.status === 200) leadIds.push(r.json.id);
  }
  // first: assign lead0+lead1 to TC; second: try lead0 again + lead2 → skip lead0
  const a1 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[0], leadIds[1]], assignToId: String(tc.id) }, AT);
  const a2 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[0], leadIds[2]], assignToId: String(tc.id) }, AT);
  log('[BUG3] bulk-assign response has skipped count', a2.json?.skipped === 1 && a2.json?.assigned === 1, JSON.stringify(a2.json).slice(0, 100));

  const tl = (await api('GET', '/api/sync/pull?tables=crm_timeline_logs', null, AT)).json?.rows?.crm_timeline_logs ?? [];
  const assignLogs = tl.filter((x) => String(x.action || '').toLowerCase().includes('assign'));
  log('[BUG2] assignment history in timeline (cloud)', assignLogs.length >= 3, 'timeline entries=' + assignLogs.length);

  // reassign → 'Lead Reassigned' entry exists
  const beforeRe = assignLogs.length;
  await api('POST', '/api/leads/assign', { leadIds: [leadIds[0]], assignToId: String(tc.id), reassign: true }, AT);
  const tl2 = (await api('GET', '/api/sync/pull?tables=crm_timeline_logs', null, AT)).json?.rows?.crm_timeline_logs ?? [];
  const reLogs = tl2.filter((x) => String(x.action || '').includes('Reassigned'));
  log('[BUG2] reassignment logged as "Lead Reassigned"', reLogs.length >= 1, 'entries=' + reLogs.length);

  // ── BUG 5: server-side auto-invoice, admin-only access ──
  // Telecaller creates an order (status forced to Order Booked server-side)
  const orderRow = {
    order_id: 'ORD-REG-' + UNIQ, lead_id: Number(leadIds[0]) || 0, customer_id: 1,
    product: 'Regression Product', qty: 1, cod_amount: 1500, status: 'Order Booked',
    booked_by: String(tc.id), booked_by_name: 'Reg TC', order_date: new Date().toISOString(),
  };
  const order = await api('POST', '/api/sync/push', { table: 'crm_orders', row: orderRow }, tcToken);
  log('[BUG5] telecaller creates order', order.status === 200 && !!order.json?.id, 'order id=' + order.json?.id);

  // invoice auto-created in cloud (admin view)
  const invList = await api('GET', '/api/invoices?order_id=' + order.json.id, null, AT);
  log('[BUG5] auto-invoice created server-side for TC order', invList.status === 200 && invList.json?.invoices?.length === 1, JSON.stringify(invList.json?.invoices?.[0]?.invoice_number));
  const inv = invList.json?.invoices?.[0];
  log('[BUG5] invoice values sane', inv && Number(inv.total) === 1500 && inv.payment_status === 'Pending' && inv.status === 'Issued', JSON.stringify({ total: inv?.total, payment: inv?.payment_status, status: inv?.status }));

  // re-push same order → no duplicate invoice (idempotent)
  await api('POST', '/api/sync/push', { table: 'crm_orders', row: { ...orderRow, id: order.json.id } }, tcToken);
  const invList2 = await api('GET', '/api/invoices?order_id=' + order.json.id, null, AT);
  log('[BUG5] re-push does NOT duplicate invoice', invList2.json?.invoices?.length === 1, 'invoices=' + invList2.json?.invoices?.length);

  // admin-only: telecaller must be denied
  const tcInvoices = await api('GET', '/api/invoices', null, tcToken);
  log('[BUG5] telecaller blocked from invoices (admin-only)', tcInvoices.status === 403, 'status=' + tcInvoices.status);
  const tcPush = await api('POST', '/api/sync/push', { table: 'crm_invoices', row: { invoice_number: 'INV-HACK', order_id: order.json.id } }, tcToken);
  log('[BUG5] telecaller cannot push invoice rows', tcPush.status === 403, 'status=' + tcPush.status);
  const tcPull = await api('GET', '/api/sync/pull?tables=crm_invoices', null, tcToken);
  log('[BUG5] telecaller cannot pull invoice rows', tcPull.status === 403, 'status=' + tcPull.status);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter((r) => r.ok).length;
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`));
  console.log(`\nBUGFIX REGRESSION: ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
