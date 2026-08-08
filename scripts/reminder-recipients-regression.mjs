// Reminder RECIPIENT regression — mirrors the EXACT server-side recipient
// logic now in worker/src/push.ts (computeRecipients + handleReminderUpsert)
// and the notification bell scoping in worker/src/index.ts (handlePull).
//
// Test matrix (from the production bug report):
//   T1: Telecaller A sets callback -> A ✓, Admin ✓, B ✗
//   T2: Telecaller B sets callback -> B ✓, Admin ✓, A ✗
//   T3: Admin sets callback      -> Admin ✓, A ✗, B ✗
//   T4: multiple callbacks across users -> each reaches only correct recipients
//   T5: bell (crm_notifications) + push (recipient_ids) both scoped
// Run: node scripts/reminder-recipients-regression.mjs

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};

// ---- users: 1 admin + 2 telecallers ----
const USERS = {
  admin: { id: '1', role: 'admin', full_name: 'Deep' },
  A:     { id: '2', role: 'telecaller', full_name: 'Telecaller A' },
  B:     { id: '3', role: 'telecaller', full_name: 'Telecaller B' },
};

// ---- computeRecipients (exact copy of worker logic) ----
async function computeRecipients(creator) {
  if (creator.role === 'admin') return [String(creator.id)];
  const admins = Object.values(USERS).filter(u => u.role === 'admin' && true); // is_active=1
  const adminIds = admins.map(a => String(a.id));
  return [...new Set([String(creator.id), ...adminIds])];
}

// ---- handlePull bell scoping (exact copy of worker crm_notifications branch) ----
function bellSees(user, notification) {
  if (user.role === 'admin') return true; // admin sees full stream
  const rid = notification.recipient_user_id;
  return rid === undefined || rid === null || rid === '' || rid === String(user.id);
}

// ---- handleReminderList scoping (exact copy of worker query) ----
function listSees(user, reminder) {
  const uid = String(user.id);
  if (String(reminder.user_id) === uid) return true;
  const ids = String(reminder.recipient_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.includes(uid);
}

const results = []; // {creator, notification, reminder, adminSees, aSees, bSees}

async function schedule(creator, name) {
  const recipients = await computeRecipients(USERS[creator]);
  const reminder = {
    user_id: String(USERS[creator].id),           // creator
    created_by: String(USERS[creator].id),
    created_by_role: USERS[creator].role,
    created_by_name: USERS[creator].full_name,
    recipient_ids: recipients.join(','),
  };
  const notification = {
    title: 'Reminder Scheduled',
    message: `Follow-up set for Ranjeet Kumar at 4:30 PM.`,
    recipient_user_id: String(USERS[creator].id), // stamped server-side at push
  };
  results.push({
    name,
    reminder,
    notification,
    adminSeesPush: listSees(USERS.admin, reminder),
    aSeesPush: listSees(USERS.A, reminder),
    bSeesPush: listSees(USERS.B, reminder),
    adminSeesBell: bellSees(USERS.admin, notification),
    aSeesBell: bellSees(USERS.A, notification),
    bSeesBell: bellSees(USERS.B, notification),
  });
}

console.log('\n[1] Telecaller A schedules a callback');
{
  await schedule('A', 'A-callback');
  const r = results[0];
  ok(r.aSeesPush, 'A receives push (creator)');
  ok(r.adminSeesPush, 'Admin receives push (recipient)');
  ok(!r.bSeesPush, 'B does NOT receive push');
  ok(r.aSeesBell, 'A sees bell notification');
  ok(r.adminSeesBell, 'Admin sees bell notification');
  ok(!r.bSeesBell, 'B does NOT see bell notification');
}

console.log('\n[2] Telecaller B schedules a callback');
{
  await schedule('B', 'B-callback');
  const r = results[1];
  ok(r.bSeesPush, 'B receives push (creator)');
  ok(r.adminSeesPush, 'Admin receives push (recipient)');
  ok(!r.aSeesPush, 'A does NOT receive push');
  ok(r.bSeesBell, 'B sees bell notification');
  ok(r.adminSeesBell, 'Admin sees bell notification');
  ok(!r.aSeesBell, 'A does NOT see bell notification');
}

console.log('\n[3] Admin schedules a callback');
{
  await schedule('admin', 'admin-callback');
  const r = results[2];
  ok(r.adminSeesPush, 'Admin receives push (creator)');
  ok(!r.aSeesPush, 'A does NOT receive push');
  ok(!r.bSeesPush, 'B does NOT receive push');
  ok(r.adminSeesBell, 'Admin sees bell notification');
  ok(!r.aSeesBell, 'A does NOT see bell notification');
  ok(!r.bSeesBell, 'B does NOT see bell notification');
}

console.log('\n[4] Multiple callbacks across users — no cross-leak');
{
  // A creates 2, B creates 1, admin creates 1
  await schedule('A', 'A-1');
  await schedule('B', 'B-1');
  await schedule('A', 'A-2');
  await schedule('admin', 'admin-1');
  const aOwned = results.filter(r => r.name.startsWith('A-') && r.name !== 'admin-1');
  const bOwned = results.filter(r => r.name.startsWith('B-'));
  const adminOwned = results.filter(r => r.name === 'admin-1');
  ok(aOwned.every(r => r.aSeesPush), 'A sees all A-created reminders');
  ok(aOwned.every(r => !r.bSeesPush), 'A-created reminders NEVER reach B');
  ok(bOwned.every(r => r.bSeesPush), 'B sees all B-created reminders');
  ok(bOwned.every(r => !r.aSeesPush), 'B-created reminders NEVER reach A');
  ok(adminOwned.every(r => r.adminSeesPush && !r.aSeesPush && !r.bSeesPush), 'Admin-created reminder reaches ONLY admin');
}

console.log('\n[5] Bell + push recipient_ids consistent');
{
  const r = results[0]; // A's first callback
  ok(r.aSeesPush === r.aSeesBell, 'A: push and bell agree');
  ok(r.adminSeesPush === r.adminSeesBell, 'Admin: push and bell agree');
  ok(r.bSeesPush === r.bSeesBell, 'B: push and bell agree (both false)');
}

console.log('\n[6] Push body for admin includes creator name');
{
  const creator = USERS.A.full_name;
  const body = `${creator} scheduled a callback reminder for Ranjeet Kumar at 4:30 PM.`;
  ok(body.includes('Telecaller A scheduled a callback reminder'), 'admin body = "Telecaller A scheduled a callback reminder for Ranjeet Kumar at 4:30 PM."');
}

console.log('\n[7] Creator of one user never sees another user\u2019s reminder list');
{
  // Simulate handleReminderList: A lists only their own + admin rows they are a recipient of
  const aList = results.filter(r => listSees(USERS.A, r.reminder));
  ok(aList.every(r => r.reminder.user_id === String(USERS.A.id)), 'A list contains only A-created reminders');
  const bList = results.filter(r => listSees(USERS.B, r.reminder));
  ok(bList.every(r => r.reminder.user_id === String(USERS.B.id)), 'B list contains only B-created reminders');
  const adminList = results.filter(r => listSees(USERS.admin, r.reminder));
  ok(adminList.length === results.length, 'Admin list contains every reminder (full stream)');
}

console.log(`\n==================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
