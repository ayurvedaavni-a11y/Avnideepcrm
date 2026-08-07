// iso-check.mjs — deterministic: two telecallers with SAME full_name must not
// see each other's leads (name-collision isolation after the fix).
const B = 'http://127.0.0.1:8787';
const results = [];
function log(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail !== undefined ? ' — ' + detail : ''}`);
}
async function api(m, p, b, t) {
  const h = { 'Content-Type': 'application/json' };
  if (t) h.Authorization = 'Bearer ' + t;
  const r = await fetch(B + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const UNIQ = Date.now().toString().slice(-5);
const ADMIN = '9876543210', ADMIN_PIN = '1234';

async function main() {
  console.log('\n=== ISOLATION (same-name) CHECK (uniq ' + UNIQ + ') ===\n');
  const adminToken = (await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' })).json?.token;

  // two telecallers with the SAME name
  const M1 = '98' + UNIQ + '701';
  const M2 = '98' + UNIQ + '702';
  await api('POST', '/api/auth/register', { mobile: M1, name: 'Same Name TC', pin: '5555', role: 'telecaller' }, adminToken);
  await api('POST', '/api/auth/register', { mobile: M2, name: 'Same Name TC', pin: '5555', role: 'telecaller' }, adminToken);
  const team = (await api('GET', '/api/auth/team', null, adminToken)).json?.members;
  const u1 = team.find((m) => m.mobile === M1);
  const u2 = team.find((m) => m.mobile === M2);
  const t1 = (await api('POST', '/api/auth/login', { mobile: M1, pin: '5555', role: 'telecaller' })).json?.token;
  const t2 = (await api('POST', '/api/auth/login', { mobile: M2, pin: '5555', role: 'telecaller' })).json?.token;
  log('Setup: 2 same-name telecallers', !!u1 && !!u2 && !!t1 && !!t2, 'u1=' + u1?.id + ' u2=' + u2?.id);

  // two leads: one for u1, one for u2
  const L1 = '99' + UNIQ + '801';
  const L2 = '99' + UNIQ + '802';
  const id1 = Date.now().toString();
  const id2 = (Date.now() + 1).toString();
  await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: id1, mobile: L1, customer_name: 'Lead for U1', status: 'New' } }, adminToken);
  await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: id2, mobile: L2, customer_name: 'Lead for U2', status: 'New' } }, adminToken);
  await api('POST', '/api/leads/assign', { leadIds: [id1], assignToId: String(u1.id) }, adminToken);
  await api('POST', '/api/leads/assign', { leadIds: [id2], assignToId: String(u2.id) }, adminToken);

  const sees1 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, t1)).json?.rows?.crm_leads ?? [];
  const sees2 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, t2)).json?.rows?.crm_leads ?? [];
  const mobs1 = sees1.map((l) => l.mobile);
  const mobs2 = sees2.map((l) => l.mobile);

  log('1. U1 sees OWN lead only (NOT U2\'s)', mobs1.includes(L1) && !mobs1.includes(L2), 'U1 sees: [' + mobs1.join(',') + ']');
  log('2. U2 sees OWN lead only (NOT U1\'s)', mobs2.includes(L2) && !mobs2.includes(L1), 'U2 sees: [' + mobs2.join(',') + ']');

  // U1 cannot edit U2's lead (same name — must still be blocked by id)
  const edit = await api('POST', '/api/sync/push', { table: 'crm_leads', row: { id: id2, status: 'Hacked' } }, t1);
  const pull2 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, adminToken)).json?.rows?.crm_leads;
  const row2 = pull2.find((l) => String(l.id) === String(id2));
  log('3. U1 cannot edit U2\'s lead (same name)', edit.status === 403 && row2?.status !== 'Hacked', edit.status + ' status=' + row2?.status);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}`));
  console.log(`ISOLATION: ${passed}/${results.length} passed`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
