// auth-api-audit.mjs — API-level auth/security audit against LOCAL worker (production source)
// Tests: admin login, telecaller create/login, wrong-role rejection, PIN change,
// block → 401 auto-logout, delete → 401, member guards, mobile change.
const B = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const TC_MOBILE = '91' + UNIQ + '001';  // 10 digits
const TC2_MOBILE = '91' + UNIQ + '002';
const TC3_MOBILE = '91' + UNIQ + '003';

async function main() {
  console.log('\n=== AUTH/SECURITY API AUDIT (uniq ' + UNIQ + ') ===\n');

  // 1. Admin login
  let r = await api('POST', '/api/auth/login', { mobile: '9876543210', pin: '1234', role: 'admin' });
  log('1. Admin login → 200 + JWT', r.status === 200 && !!r.json?.token, r.status + ' role=' + r.json?.profile?.role);
  const adminToken = r.json?.token;

  // 2. Admin /me
  r = await api('GET', '/api/auth/me', null, adminToken);
  log('2. Admin session restore (/me)', r.status === 200 && r.json?.profile?.role === 'admin', r.status);

  // 3. Wrong PIN → 401
  r = await api('POST', '/api/auth/login', { mobile: '9876543210', pin: '9999', role: 'admin' });
  log('3. Wrong PIN rejected → 401', r.status === 401, r.status);

  // 4. Nonexistent user → 401
  r = await api('POST', '/api/auth/login', { mobile: '9999999999', pin: '1234', role: 'admin' });
  log('4. Unknown mobile rejected → 401', r.status === 401, r.status);

  // 5. Register 2 telecallers (admin)
  r = await api('POST', '/api/auth/register', { mobile: TC_MOBILE, name: 'TC Alpha', pin: '4321', role: 'telecaller' }, adminToken);
  log('5. Admin creates telecaller TC Alpha', r.status === 200, r.status + ' ' + JSON.stringify(r.json).slice(0, 80));
  r = await api('POST', '/api/auth/register', { mobile: TC2_MOBILE, name: 'TC Beta', pin: '4321', role: 'telecaller' }, adminToken);
  log('5b. Admin creates telecaller TC Beta', r.status === 200, r.status);

  // 6. Telecaller login
  r = await api('POST', '/api/auth/login', { mobile: TC_MOBILE, pin: '4321', role: 'telecaller' });
  log('6. Telecaller login → 200', r.status === 200 && r.json?.profile?.role === 'telecaller', r.status);
  const tcToken = r.json?.token;

  // 7. Role separation: telecaller → admin endpoints forbidden
  r = await api('GET', '/api/auth/team', null, tcToken);
  log('7. Telecaller blocked from /auth/team → 403', r.status === 403, r.status);
  r = await api('POST', '/api/auth/register', { mobile: TC3_MOBILE, name: 'X', pin: '1234', role: 'telecaller' }, tcToken);
  log('7b. Telecaller blocked from register → 403', r.status === 403, r.status);

  // 8. No token → 401 everywhere
  r = await api('GET', '/api/auth/me', null);
  log('8. No token /me → 401', r.status === 401, r.status);
  r = await api('GET', '/api/sync/pull', null);
  log('8b. No token /sync/pull → 401', r.status === 401, r.status);

  // 9. Tampered JWT → 401
  const bad = adminToken.slice(0, -4) + 'AAAA';
  r = await api('GET', '/api/auth/me', null, bad);
  log('9. Tampered JWT rejected → 401', r.status === 401, r.status);

  // 10. PIN change (self)
  r = await api('POST', '/api/auth/change-pin', { currentPin: '4321', newPin: '7777' }, tcToken);
  log('10. Telecaller PIN change → 200', r.status === 200, r.status);
  r = await api('POST', '/api/auth/login', { mobile: TC_MOBILE, pin: '7777', role: 'telecaller' });
  log('10b. Login with NEW pin → 200', r.status === 200, r.status);
  r = await api('POST', '/api/auth/login', { mobile: TC_MOBILE, pin: '4321', role: 'telecaller' });
  log('10c. Old PIN now rejected → 401', r.status === 401, r.status);
  const tcToken2 = (await api('POST', '/api/auth/login', { mobile: TC_MOBILE, pin: '7777', role: 'telecaller' })).json?.token;

  // 11. Admin changes telecaller mobile number
  const teamList = await api('GET', '/api/auth/team', null, adminToken);
  const tcId = teamList.json?.members?.find((m) => m.mobile === TC_MOBILE)?.id;
  log('11. Team list shows lead_count + mobile', !!tcId, 'tcId=' + tcId);
  r = await api('PATCH', '/api/auth/member/' + tcId, { mobile: '91' + UNIQ + '099' }, adminToken);
  log('11b. Admin changes TC mobile → 200', r.status === 200, r.status);
  r = await api('POST', '/api/auth/login', { mobile: '91' + UNIQ + '099', pin: '7777', role: 'telecaller' });
  log('11c. Login with NEW mobile → 200', r.status === 200, r.status);

  // 12. BLOCK → active session auto-invalidated
  r = await api('PATCH', '/api/auth/member/' + tcId, { is_active: false }, adminToken);
  log('12. Admin blocks TC → 200', r.status === 200, r.status);
  r = await api('GET', '/api/auth/me', null, tcToken2);
  log('12b. Blocked TC session → 401 (auto-logout)', r.status === 401, r.status);
  r = await api('POST', '/api/auth/login', { mobile: '91' + UNIQ + '099', pin: '7777', role: 'telecaller' });
  log('12c. Blocked TC cannot re-login → 403', r.status === 403, r.status);

  // 13. UNBLOCK → can login again
  r = await api('PATCH', '/api/auth/member/' + tcId, { is_active: true }, adminToken);
  r = await api('POST', '/api/auth/login', { mobile: '91' + UNIQ + '099', pin: '7777', role: 'telecaller' });
  log('13. Unblock → login works again → 200', r.status === 200, r.status);
  const tcToken3 = r.json?.token;

  // 14. DELETE telecaller → session invalidated
  const tc2List = await api('GET', '/api/auth/team', null, adminToken);
  const tc2Id = tc2List.json?.members?.find((m) => m.mobile === TC2_MOBILE)?.id;
  const tc2Token = (await api('POST', '/api/auth/login', { mobile: TC2_MOBILE, pin: '4321', role: 'telecaller' })).json?.token;
  r = await api('DELETE', '/api/auth/member/' + tc2Id, null, adminToken);
  log('14. Admin deletes TC Beta → 200', r.status === 200, r.status);
  r = await api('GET', '/api/auth/me', null, tc2Token);
  log('14b. Deleted TC session → 401', r.status === 401, r.status);
  r = await api('POST', '/api/auth/login', { mobile: TC2_MOBILE, pin: '4321', role: 'telecaller' });
  log('14c. Deleted TC cannot re-login → 401', r.status === 401, r.status);

  // 15. Self-protection: admin cannot block/demote self
  const adminId = (await api('GET', '/api/auth/me', null, adminToken)).json?.profile?.id;
  r = await api('PATCH', '/api/auth/member/' + adminId, { is_active: false }, adminToken);
  log('15. Admin cannot block self → 400', r.status === 400, r.status);

  // 16. Telecaller cannot delete users
  r = await api('DELETE', '/api/auth/member/' + adminId, null, tcToken3);
  log('16. Telecaller cannot delete users → 403', r.status === 403, r.status);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}`));
  console.log(`\nAUTH AUDIT: ${passed}/${results.length} passed`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
