// lead-api-audit2.mjs — lead assignment/ownership/isolation API audit (local worker)
const B = process.env.API_BASE || 'http://127.0.0.1:8787';
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
const TC1 = '92' + UNIQ + '101';
const TC2 = '92' + UNIQ + '102';

async function main() {
  console.log('\n=== LEAD ASSIGNMENT / OWNERSHIP API AUDIT v2 (uniq ' + UNIQ + ') ===\n');
  const adminToken = (await api('POST', '/api/auth/login', { mobile: ADMIN, pin: ADMIN_PIN, role: 'admin' })).json?.token;

  await api('POST', '/api/auth/register', { mobile: TC1, name: 'Lead TC One', pin: '5555', role: 'telecaller' }, adminToken);
  await api('POST', '/api/auth/register', { mobile: TC2, name: 'Lead TC Two', pin: '5555', role: 'telecaller' }, adminToken);
  const team = (await api('GET', '/api/auth/team', null, adminToken)).json?.members;
  const tc1 = team.find((m) => m.mobile === TC1);
  const tc2 = team.find((m) => m.mobile === TC2);
  const tc1Token = (await api('POST', '/api/auth/login', { mobile: TC1, pin: '5555', role: 'telecaller' })).json?.token;
  const tc2Token = (await api('POST', '/api/auth/login', { mobile: TC2, pin: '5555', role: 'telecaller' })).json?.token;
  log('Setup: 2 telecallers', !!tc1 && !!tc2 && !!tc1Token && !!tc2Token, 'tc1=' + tc1?.id + ' tc2=' + tc2?.id);

  const leadMobiles = ['93' + UNIQ + '01', '93' + UNIQ + '02', '93' + UNIQ + '03', '93' + UNIQ + '04'];
  const leadIds = [];
  for (const mob of leadMobiles) {
    const r = await api('POST', '/api/sync/push', {
      table: 'crm_leads', row: { id: Date.now().toString(), mobile: mob, customer_name: 'Lead ' + mob, status: 'New', source: 'audit', assigned_to: null, assigned_agent: null },
    }, adminToken);
    if (r.status === 200) leadIds.push(r.json?.id);
  }
  log('1. Admin pushes 4 new leads', leadIds.length === 4, 'ids=' + leadIds.join(','));

  const r1 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[0]], assignToId: String(tc1.id) }, adminToken);
  log('2. Single assign lead#1 → TC1', r1.status === 200 && r1.json?.assigned === 1, JSON.stringify(r1.json).slice(0, 80));

  const r2 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[1], leadIds[2]], assignToId: String(tc2.id) }, adminToken);
  log('3. Bulk assign 2 leads → TC2', r2.status === 200 && r2.json?.assigned === 2, JSON.stringify(r2.json).slice(0, 80));

  const r3 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[0], leadIds[3]], assignToId: String(tc2.id) }, adminToken);
  log('4. Skip already-assigned (lead#1 skip, lead#4 assign)', r3.status === 200 && r3.json?.assigned === 1 && r3.json?.skipped === 1, JSON.stringify(r3.json).slice(0, 100));

  const r4 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[0]], assignToId: String(tc2.id), reassign: true }, adminToken);
  log('5. Explicit reassign lead#1 → TC2', r4.status === 200 && r4.json?.assigned === 1, JSON.stringify(r4.json).slice(0, 80));

  // reassign history in timeline
  const tl = (await api('GET', '/api/sync/pull?tables=crm_timeline_logs', null, adminToken)).json?.rows?.crm_timeline_logs ?? [];
  const assignLogs = tl.filter((x) => (x.action || '').toLowerCase().includes('assign'));
  log('5b. Assignment history logged in timeline', assignLogs.length >= 3, 'timeline assign entries=' + assignLogs.length);

  const leads1 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, tc1Token)).json?.rows?.crm_leads ?? [];
  const leads2 = (await api('GET', '/api/sync/pull?tables=crm_leads', null, tc2Token)).json?.rows?.crm_leads ?? [];
  const mobs1 = leads1.map((l) => l.mobile);
  const mobs2 = leads2.map((l) => l.mobile);
  log('6. TC1 pulls ONLY own leads (empty after reassign)', mobs1.length === 0 || mobs1.every((m) => m === leadMobiles[0] && false), 'TC1 sees: [' + mobs1.join(',') + ']');
  // NOTE: after test #5 explicitly REASSIGNED lead#1 to TC2, TC2 legitimately
  // owns ALL 4 leads (lead#1, #2, #3, #4). Expecting only 3 was a test-logic
  // bug (documented in the audit) — the app behavior is correct.
  log('7. TC2 pulls ONLY own leads (4 after reassign)', mobs2.length === 4 && mobs2.every((m) => leadMobiles.includes(m)), 'TC2 sees: [' + mobs2.join(',') + ']');

  const r5 = await api('POST', '/api/leads/assign', { leadIds: [leadIds[3]], assignToId: String(tc1.id) }, tc1Token);
  log('8. TC cannot use assign API → 403', r5.status === 403, r5.status);

  const r6 = await api('POST', '/api/sync/delete', { table: 'crm_leads', id: leadIds[0] }, tc1Token);
  log('9. TC cannot delete lead → 403 (admin-only fix)', r6.status === 403, r6.status + ' ' + JSON.stringify(r6.json).slice(0, 50));

  // duplicate prevention: intake same mobile twice
  // Intake key comes from the environment (CI/regression) or falls back to the
  // local dev key from worker/.dev.vars — a hardcoded production key can never
  // be used in local tests.
  const intakeKey = process.env.INTAKE_KEY || 'local-intake-key';
  const mob2 = '97' + UNIQ + '501';
  const intake = (mob, name) => fetch(B + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Key': intakeKey }, body: JSON.stringify({ mobile: mob, name, source: 'audit' }) }).then((r) => r.json().catch(() => ({})));
  const i1 = await intake(mob2, 'First Enquiry');
  const i2 = await intake(mob2, 'Second Enquiry');
  // Idempotency: second call returns the SAME lead id (no duplicate row).
  log('10. Duplicate intake → same lead id (no dup row)', !!i1?.id && i1.id === i2.id && i2?.duplicate === true, JSON.stringify({ a: i1, b: i2 }).slice(0, 140));

  console.log('\n=== SUMMARY ===');
  const passed = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}`));
  console.log(`\nLEAD AUDIT v2: ${passed}/${results.length} passed`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
