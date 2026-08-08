// OrderPipeline filter regression — mirrors the EXACT filter chain now used in
// src/pages/OrderPipeline.tsx (global date filter first, then search, then
// page filters, then stats from the FILTERED set).
// Run: node scripts/orders-filter-regression.mjs

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};

// ---- fixture: 10 orders across dates/statuses/telecallers ----
const DAY = 86400000;
const now = Date.now();
const d = (offsetDays) => new Date(now + offsetDays * DAY).toISOString();
const orders = [
  { id: 1,  orderId: 'AVN-000001', leadId: 11, status: 'Order Booked',  orderDate: d(0),  codAmount: 500,  product: 'Product A', courier: 'BlueDart' },
  { id: 2,  orderId: 'AVN-000002', leadId: 12, status: 'Packing',       orderDate: d(0),  codAmount: 700,  product: 'Product B', courier: 'DTDC' },
  { id: 3,  orderId: 'AVN-000003', leadId: 13, status: 'Packed',        orderDate: d(-1), codAmount: 900,  product: 'Product A', courier: 'BlueDart' },
  { id: 4,  orderId: 'AVN-000004', leadId: 14, status: 'Ready To Ship', orderDate: d(-1), codAmount: 300,  product: 'Product C', courier: 'DTDC' },
  { id: 5,  orderId: 'AVN-000005', leadId: 15, status: 'Shipped',       orderDate: d(-2), codAmount: 1200, product: 'Product B', courier: 'BlueDart' },
  { id: 6,  orderId: 'AVN-000006', leadId: 16, status: 'In Transit',    orderDate: d(-2), codAmount: 450,  product: 'Product A', courier: 'Delhivery' },
  { id: 7,  orderId: 'AVN-000007', leadId: 17, status: 'Delivered',     orderDate: d(-3), codAmount: 800,  product: 'Product C', courier: 'BlueDart' },
  { id: 8,  orderId: 'AVN-000008', leadId: 18, status: 'Delivered',     orderDate: d(-3), codAmount: 1500, product: 'Product B', courier: 'DTDC' },
  { id: 9,  orderId: 'AVN-000009', leadId: 19, status: 'RTO',           orderDate: d(-4), codAmount: 650,  product: 'Product A', courier: 'Delhivery' },
  { id: 10, orderId: 'AVN-000010', leadId: 20, status: 'Cancelled',     orderDate: d(-4), codAmount: 400,  product: 'Product C', courier: 'DTDC' },
];
// leadId -> assignedAgent (what leadMap.get() would return)
const agentOf = { 11: 'Rahul', 12: 'Rahul', 13: 'Priya', 14: 'Priya', 15: 'Priya', 16: 'Amit', 17: 'Amit', 18: 'Amit', 19: 'Sneha', 20: 'Sneha' };

// ---- reimplementation of DateFilterContext.filterByDate + isInRange ----
function isInRange(dateValue, range) {
  if (!range.start && !range.end) return true;
  const t = new Date(dateValue).getTime();
  if (!isFinite(t)) return false;
  if (range.start && t < range.start.getTime()) return false;
  if (range.end && t > range.end.getTime()) return false;
  return true;
}
const filterByDate = (items, range) => (range.start || range.end) ? items.filter(o => isInRange(o.orderDate, range)) : items;

// ---- EXACT chain from OrderPipeline.tsx (filteredOrders memo) ----
function applyFilters(orders, { searchTerm = '', filters = {}, range = { start: null, end: null } }) {
  const term = searchTerm.trim().toLowerCase();
  let list = filterByDate(orders, range);
  if (term) {
    list = list.filter(o => o.orderId.toLowerCase().includes(term) || o.product.toLowerCase().includes(term) || String(o.codAmount).includes(term));
  }
  if (filters.telecaller) list = list.filter(o => agentOf[o.leadId] === filters.telecaller);
  if (filters.status) list = list.filter(o => o.status === filters.status);
  if (filters.payment === 'COD') list = list.filter(o => (o.codAmount || 0) > 0);
  if (filters.payment === 'Prepaid') list = list.filter(o => (o.codAmount || 0) <= 0);
  if (filters.courier) list = list.filter(o => o.courier === filters.courier);
  if (filters.product) list = list.filter(o => o.product === filters.product);
  if (filters.minAmount) list = list.filter(o => (o.codAmount || 0) >= Number(filters.minAmount));
  if (filters.maxAmount) list = list.filter(o => (o.codAmount || 0) <= Number(filters.maxAmount));
  if (filters.dateFrom || filters.dateTo) {
    list = list.filter(o => {
      const dt = new Date(o.orderDate).getTime();
      if (filters.dateFrom && dt < new Date(filters.dateFrom + 'T00:00:00').getTime()) return false;
      if (filters.dateTo && dt > new Date(filters.dateTo + 'T23:59:59').getTime()) return false;
      return true;
    });
  }
  return list;
}

// ---- stats from FILTERED set (the fix) ----
function computeStats(filtered) {
  const pending = filtered.filter(o => o.status === 'Order Booked').length;
  const packing = filtered.filter(o => o.status === 'Packing').length;
  const cancelled = filtered.filter(o => o.status === 'Cancelled').length;
  const revenue = filtered.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.codAmount, 0);
  return { total: filtered.length, pending, packing, cancelled, revenue };
}

console.log('\n[1] No filters -> all 10 orders, stats full');
{
  const f = applyFilters(orders, {});
  ok(f.length === 10, `list = 10 (got ${f.length})`);
  const s = computeStats(f);
  ok(s.pending === 1 && s.packing === 1 && s.cancelled === 1, `stats pending=1 packing=1 cancelled=1 (got ${s.pending}/${s.packing}/${s.cancelled})`);
  ok(s.revenue === 2300, `delivered revenue = 2300 (got ${s.revenue})`);
}

console.log('\n[2] Status filter');
{
  const f = applyFilters(orders, { filters: { status: 'Delivered' } });
  ok(f.length === 2, `Delivered = 2 (got ${f.length})`);
  const s = computeStats(f);
  ok(s.revenue === 2300 && s.pending === 0, `stats recalc from filtered set: revenue=2300 pending=0 (got ${s.revenue}/${s.pending})`);
}

console.log('\n[3] Telecaller filter (Rahul -> leads 11,12)');
{
  const f = applyFilters(orders, { filters: { telecaller: 'Rahul' } });
  ok(f.length === 2, `Rahul = 2 (got ${f.length})`);
  ok(f.every(o => [11, 12].includes(o.leadId)), 'only Rahul-owned orders');
}

console.log('\n[4] Payment = COD (codAmount>0)');
{
  const f = applyFilters(orders, { filters: { payment: 'COD' } });
  ok(f.length === 10, `COD = 10 (all have amount) (got ${f.length})`);
}

console.log('\n[5] Courier + Product combined');
{
  const f = applyFilters(orders, { filters: { courier: 'BlueDart', product: 'Product A' } });
  ok(f.length === 2, `BlueDart+ProductA = 2 (got ${f.length})`);
}

console.log('\n[6] Min amount >= 1000');
{
  const f = applyFilters(orders, { filters: { minAmount: '1000' } });
  ok(f.length === 2, `>=1000 = 2 (got ${f.length})`);
}

console.log('\n[7] Search');
{
  const f = applyFilters(orders, { searchTerm: 'avn-' });
  ok(f.length === 10, `search 'avn-' = 10 (got ${f.length})`);
  const g = applyFilters(orders, { searchTerm: 'product b' });
  ok(g.length === 3, `search 'product b' = 3 (got ${g.length})`);
}

console.log('\n[8] Global date range (last 2 days incl today)');
{
  const start = new Date(d(-1)); start.setHours(0, 0, 0, 0);
  const end = new Date(d(0)); end.setHours(23, 59, 59, 999);
  const f = applyFilters(orders, { range: { start, end } });
  ok(f.length === 4, `last-2-days = 4 (got ${f.length})`);
  const s = computeStats(f);
  ok(s.pending === 1 && s.packing === 1, `stats respect date filter (pending=1 packing=1, got ${s.pending}/${s.packing})`);
}

console.log('\n[9] Reset filters -> original set back');
{
  const f = applyFilters(orders, { filters: { status: 'Delivered', telecaller: 'Amit' } });
  ok(f.length === 2, `Delivered+Amit = 2 (got ${f.length})`);
  const reset = applyFilters(orders, { filters: {} });
  ok(reset.length === 10, `reset = 10 (got ${reset.length})`);
}

console.log('\n[10] Telecaller permission boundary (scope then filter, never filter then scope)');
{
  // A telecaller's scoped set — a global filter must never leak others' orders
  const mine = orders.filter(o => agentOf[o.leadId] === 'Priya'); // 3 orders
  const f = applyFilters(mine, { filters: { status: 'Packed' } });
  ok(f.length === 1 && f[0].leadId === 13, `scoped+status = 1 (got ${f.length})`);
  const g = applyFilters(mine, {});
  ok(g.length === 3, `scoped no filter = 3 (got ${g.length})`);
  ok(g.every(o => agentOf[o.leadId] === 'Priya'), 'no foreign orders leaked');
}

console.log('\n[11] Combined: date + status + telecaller');
{
  const start = new Date(d(-3)); start.setHours(0, 0, 0, 0);
  const end = new Date(d(0)); end.setHours(23, 59, 59, 999);
  const f = applyFilters(orders, { filters: { status: 'Delivered', telecaller: 'Amit' }, range: { start, end } });
  ok(f.length === 2 && f.every(o => [7, 8].includes(o.id)), `date+Delivered+Amit = 2 (ids 7,8; got ${f.length})`);
}

console.log(`\n==================`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
