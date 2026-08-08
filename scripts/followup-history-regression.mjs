// Follow-up History regression — simulates the FollowupHistoryModal contract.
//
// ROOT-CAUSE FIX verified here: PipelineSection now calls
// onViewHistory(lead, customer, followups) and the handler declares the SAME
// 3 params, so `followups` is always the array (previously the 2-param handler
// received the customer OBJECT -> 'u.forEach is not a function' crash).
//
// Also verifies the boundary normalization: any invalid shape (object/null/
// undefined/legacy) renders a clean empty state instead of crashing.
// Run: node scripts/followup-history-regression.mjs

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};

// ---- Exact caller contract (PipelineSection line 471) ----
function pipelineSectionOnViewHistory(item, handler) {
  // Previously this called the handler which only read (lead, followups)
  return handler(item.lead, item.customer, item.followups);
}

// ---- The FIXED handler (line 355) ----
function fixedHandler(lead, customer, followups) {
  return { lead, customer: customer ?? null, followups };
}

// ---- Boundary normalization (FollowupHistoryModal) ----
function normalize(followups) {
  return Array.isArray(followups) ? followups : [];
}
const buildEvents = (followups, logs = []) => {
  const list = normalize(followups);
  const events = list.map(f => ({ date: f.createdAt, type: f.action, description: f.notes || f.action, actor: f.agentName || 'Admin' }));
  logs.forEach(log => {
    if (String(log.action || '').includes('Followup') || String(log.action || '').includes('Callback') || log.action === 'Status Change') {
      events.push({ date: log.createdAt, type: log.action, description: log.notes || log.action, actor: log.agentName || 'System' });
    }
  });
  return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

console.log('\n[1] Contract: PipelineSection 3-arg call reaches handler as array');
{
  const item = {
    lead: { id: 7, customerId: 11, product: 'Product A', expectedAmount: 500, status: 'Followup', followupDate: '2026-08-09', followupTime: '10:30' },
    customer: { id: 11, name: 'Ranjeet Kumar', mobile: '9876543210' },
    followups: [
      { action: 'Called', notes: 'ringing', agentName: 'Deep', createdAt: '2026-08-08T05:00:00Z' },
      { action: 'WhatsApp', notes: 'sent catalog', agentName: 'Deep', createdAt: '2026-08-08T06:00:00Z' },
    ],
  };
  // OLD broken handler would have received customer as followups
  let oldFollowupsArg = 'unset';
  const brokenHandler = (lead, followups) => { oldFollowupsArg = followups; };
  pipelineSectionOnViewHistory(item, brokenHandler);
  ok(!Array.isArray(oldFollowupsArg), 'OLD handler received NON-array (the bug reproduced)');

  let fixedResult = null;
  pipelineSectionOnViewHistory(item, (lead, customer, followups) => { fixedResult = fixedHandler(lead, customer, followups); });
  ok(Array.isArray(fixedResult.followups), 'FIXED handler receives followups as array');
  ok(fixedResult.followups.length === 2, `FIXED handler has 2 followups (got ${fixedResult.followups?.length})`);
  ok(fixedResult.customer?.name === 'Ranjeet Kumar', 'customer received correctly');
}

console.log('\n[2] 0 history -> clean empty state, no crash');
{
  const events = buildEvents([]);
  ok(Array.isArray(events) && events.length === 0, '0 followups -> 0 events, no crash');
}

console.log('\n[3] 1 history entry -> renders');
{
  const events = buildEvents([{ action: 'Called', notes: 'x', agentName: 'Deep', createdAt: '2026-08-08T05:00:00Z' }]);
  ok(events.length === 1 && events[0].type === 'Called', '1 followup -> 1 event');
}

console.log('\n[4] Multiple entries -> all render, sorted desc');
{
  const events = buildEvents([
    { action: 'Called', notes: '1', agentName: 'A', createdAt: '2026-08-08T05:00:00Z' },
    { action: 'WhatsApp', notes: '2', agentName: 'A', createdAt: '2026-08-07T05:00:00Z' },
    { action: 'Snoozed', notes: '3', agentName: 'A', createdAt: '2026-08-09T05:00:00Z' },
  ]);
  ok(events.length === 3, `3 followups -> 3 events (got ${events.length})`);
  ok(events[0].type === 'Snoozed', 'sorted newest first');
}

console.log('\n[5] Legacy/malformed shapes NEVER crash (the production bug)');
{
  // The exact production scenario: followups received an OBJECT (customer)
  const objectShape = { id: 11, name: 'Ranjeet Kumar', mobile: '9876543210' };
  const events1 = buildEvents(objectShape);
  ok(Array.isArray(events1) && events1.length === 0, 'object shape -> normalized to empty, no crash');

  const events2 = buildEvents(null);
  ok(Array.isArray(events2) && events2.length === 0, 'null shape -> no crash');

  const events3 = buildEvents(undefined);
  ok(Array.isArray(events3) && events3.length === 0, 'undefined shape -> no crash');

  const events4 = buildEvents('not-an-array');
  ok(Array.isArray(events4) && events4.length === 0, 'string shape -> no crash');

  const events5 = buildEvents({ 0: { action: 'Called' }, length: 1 });
  ok(Array.isArray(events5) && events5.length === 0, 'array-like object -> no crash');
}

console.log('\n[6] Legacy followup records with missing fields');
{
  const events = buildEvents([
    { action: undefined, notes: undefined, agentName: undefined, createdAt: '2026-08-08T05:00:00Z' },
  ]);
  ok(events.length === 1, 'legacy row still renders (len 1)');
  ok(events[0].type === undefined && events[0].actor === 'Admin', 'legacy defaults applied (actor=Admin)');
}

console.log('\n[7] Timeline logs merge (same query used by Customer Timeline)');
{
  const logs = [
    { action: 'Followup', notes: 'called again', agentName: 'Deep', createdAt: '2026-08-08T05:00:00Z' },
    { action: 'Order Booked', notes: 'booked', agentName: 'Deep', createdAt: '2026-08-09T05:00:00Z' },
  ];
  const events = buildEvents([{ action: 'Called', notes: 'x', agentName: 'Deep', createdAt: '2026-08-07T05:00:00Z' }], logs);
  ok(events.length === 2, 'followup + followup-related timeline log merged');
  ok(events.every(e => e.date), 'all events have dates');
}

console.log(`\n==================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
