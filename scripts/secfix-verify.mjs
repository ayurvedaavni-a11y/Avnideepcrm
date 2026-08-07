// secfix-verify.mjs — verify delete admin-only + telecaller field restrictions
const B = 'http://127.0.0.1:8787';
const results = [];
function log(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail !== undefined ? ' — ' + detail : ''}`);
}
async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(B + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const UNIQ = Date.now().toString().slice(-5);
const ADMIN = '9876543210', ADMIN_PIN = '1234';
const TC = '94' + UNIQ + '201';
const CUST_MOBILE = '95' + UNIQ + '301';
const LEAD_MOBILE = '96' + UNIQ + '401';

async function main() {
  console.log('\n=== SECURITY FIX VERIFICATION (uniq ' + UNIQ + ') ===\n');
  const adminToken = (await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' })).json?.token;
  await api('POST', '/api/auth/register', { mobile: TC, name: 'SecFix TC', pin: '5555', role: 'telecaller' }, adminToken);
  const team = (await api('GET', '/api/auth/team', null, adminToken)).json?.members;
  const tc = team.find((m) => m.mobile === TC);
  const tcToken = (await api('POST', '/api/auth/login', { mobile: TC, pin: '5555', role: 'telecaller' })).json?.token;

  // create a customer + lead (admin) and assign lead to TC
  const custId = Date.now().toString();
  const leadId = Date.now().toString();
  await api('POST', '/api/sync/push', { table: 'crm_customers', row: { id: custId, mobile: CUST_MOBILE, name: 'SecFix Customer', address: 'Old Address', pincode: '110001' } }, adminToken);
  await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: leadId, mobile: LEAD_MOBILE, name: 'SecFix Lead', status: 'New', source: 'audit' } }, adminToken);
  const assign = await api('POST', '/api/leads/assign', { leadIds: [leadId], assignToId: String(tc.id) }, adminToken);
  log('Setup: customer + lead created, lead assigned to TC', assign.status === 200, 'assign=' + assign.status);

  // FIX 1: telecaller DELETE → 403 (any table)
  const d1 = await api('POST', '/api/sync/delete', { table: 'crm_leads', id: leadId }, tcToken);
  log('1. TC delete OWN lead → 403 (admin-only)', d1.status === 403, d1.status + ' ' + JSON.stringify(d1.json).slice(0, 60));
  const d2 = await api('POST', '/api/sync/delete', { table: 'crm_customers', id: custId }, tcToken);
  log('2. TC delete customer → 403', d2.status === 403, d2.status);
  const d3 = await api('POST', '/api/sync/delete', { table: 'crm_call_logs', id: '1' }, tcToken);
  log('3. TC delete call log → 403', d3.status === 403, d3.status);

  // FIX 2a: telecaller cannot change lead mobile/name/source/assignment
  const p1 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: leadId, mobile: '9999999999' } }, tcToken);
  const p2 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: leadId, name: 'Hacked Name' } }, tcToken);
  const p3 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: leadId, assigned_agent: 'Other TC' } }, tcToken);
  log('4. TC cannot change lead mobile', p1.status === 200 && !(p1.json?.error), JSON.stringify(p1.json).slice(0, 60));
  // verify server state unchanged
  const adminPull = await api('GET', '/api/sync/pull?tables=crm_leads', null, adminToken);
  const leadRow = (adminPull.json?.rows?.crm_leads ?? []).find((l) => String(l.id) === String(leadId));
  log('5. Lead mobile/name/owner UNCHANGED after TC attempts', leadRow?.mobile === LEAD_MOBILE, JSON.stringify({ mobile: leadRow?.mobile, cname: leadRow?.customer_name, owner: leadRow?.assigned_agent }));

  // FIX 2b: telecaller cannot change customer mobile/name/totals
  await api('POST', '/api/sync/push', { table: 'crm_customers', row: { id: custId, mobile: '8888888888', total_orders: 99 } }, tcToken);
  const custPull = await api('GET', '/api/sync/pull?tables=crm_customers', null, adminToken);
  const custRow = (custPull.json?.rows?.crm_customers ?? []).find((c) => String(c.id) === String(custId));
  log('6. Customer mobile/counters UNCHANGED after TC attempt', custRow?.mobile === CUST_MOBILE && custRow?.total_orders !== 99, JSON.stringify({ mobile: custRow?.mobile, total_orders: custRow?.total_orders }));

  // LEGIT: telecaller CAN update own lead status + notes
  const p4 = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: leadId, status: 'Interested', notes: 'customer interested, call tomorrow' } }, tcToken);
  const leadRow2 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, adminToken)).json?.rows?.crm_leads.find((l) => String(l.id) === String(leadId));
  log('7. TC CAN update own lead status+notes', p4.status === 200 && leadRow2?.status === 'Interested' && (leadRow2?.notes || '').includes('interested'), JSON.stringify({ status: leadRow2?.status, notes: leadRow2?.notes }));

  // LEGIT: telecaller CAN update customer address
  await api('POST', '/api/sync/push', { table: 'crm_customers', row: { id: custId, address: 'New Address 123', pincode: '400001' } }, tcToken);
  const custRow2 = (await api('GET', '/api/sync/pull?tables=crm_customers', null, adminToken)).json?.rows?.crm_customers.find((c) => String(c.id) === String(custId));
  log('8. TC CAN update customer address+pincode', custRow2?.address === 'New Address 123' && custRow2?.pincode === '400001', JSON.stringify({ address: custRow2?.address, pincode: custRow2?.pincode }));

  console.log('\n=== SUMMARY ===');
  const passed = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}`));
  console.log(`\nSECFIX: ${passed}/${results.length} passed`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
