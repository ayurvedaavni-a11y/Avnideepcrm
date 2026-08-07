# -*- coding: utf-8 -*-
# Production fixes: worker/src/index.ts
#  1) server-authoritative updated_at on status writes (kills incremental-sync
#     clock-skew misses) + aligned delivered_at
#  2) new fast endpoint GET /api/orders/status (admin: all / telecaller: own)
import io, sys

path = 'worker/src/index.ts'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    content = f.read()
NL = '\r\n' if '\r\n' in content else '\n'
def rep(old, new, count=1):
    global content
    o = old.replace('\n', NL)
    n = new.replace('\n', NL)
    c = content.count(o)
    if c != count:
        print(f'FAIL [{c}/{count}] for: {old.splitlines()[0][:70]}')
        sys.exit(1)
    content = content.replace(o, n)
    print('OK:', old.splitlines()[0][:70])

# --- 1) timestamp authority on status writes ---------------------------------
rep(
'''  const nowIso = new Date().toISOString();
  if (def.columns.includes('created_at') && data.created_at == null) data.created_at = nowIso;
  if (def.columns.includes('updated_at') && data.updated_at == null) data.updated_at = nowIso;
''',
'''  const nowIso = new Date().toISOString();
  if (def.columns.includes('created_at') && data.created_at == null) data.created_at = nowIso;
  if (def.columns.includes('updated_at') && data.updated_at == null) data.updated_at = nowIso;
  // STATUS-WRITE TIMESTAMP AUTHORITY: whenever a write carries a STATUS change,
  // stamp updated_at with the SERVER clock. Incremental pulls compare
  // updated_at > watermark where the watermark is server time (pulledAt); a
  // client clock running behind the server would push an OLDER timestamp and
  // the change would be invisible to other devices until the next full pull.
  // Server-stamping status writes makes every status change newer than any
  // prior watermark, so Delivered / RTO / Cancelled reach every device on the
  // very next pull (~2s via the fast /api/orders/status poll).
  if (def.columns.includes('updated_at')) {
    const statusField =
      table === 'crm_orders' || table === 'crm_leads' ? 'status'
      : table === 'crm_customers' ? 'current_status'
      : null;
    if (statusField && data[statusField] !== undefined && data[statusField] !== null) {
      data.updated_at = new Date().toISOString();
    }
  }
  // delivered_at rides the same server clock so commission windows and the
  // order row always agree (the earlier rules block may have stamped it with
  // the client timestamp - align it to the authoritative updated_at).
  if (table === 'crm_orders' && data.status === 'Delivered' && !data.delivered_at) {
    data.delivered_at = data.updated_at || new Date().toISOString();
  }
''')

# --- 2) fast order-status handler -------------------------------------------
rep(
'''// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------
''',
'''// ---------------------------------------------------------------------
// fast order-status sync (admin change reaches telecaller My Orders in ~2s)
// ---------------------------------------------------------------------
async function handleOrderStatus(env: Env, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const since = String(url.searchParams.get('since') || '');
  const isAdmin = user!.role === 'admin';
  // Admin watches every order; telecallers watch only orders they booked or
  // whose lead is assigned to them (matches the "My Orders" definition).
  const where = isAdmin
    ? (since ? 'WHERE updated_at > ?' : '')
    : (since
        ? "WHERE (booked_by = ? OR lead_id IN (SELECT id FROM crm_leads WHERE assigned_to = ?)) AND updated_at > ?"
        : "WHERE (booked_by = ? OR lead_id IN (SELECT id FROM crm_leads WHERE assigned_to = ?))");
  const sql = `SELECT id, order_id, status, updated_at, delivered_at FROM crm_orders ${where} ORDER BY updated_at ASC LIMIT 500`;
  const bind = isAdmin
    ? (since ? [since] : [])
    : (since ? [user!.id, user!.id, since] : [user!.id, user!.id]);
  const res = await env.DB.prepare(sql).bind(...bind).all();
  const rows = ((res.results || []) as Record<string, any>[]).map((r) => ({
    id: Number(r.id),
    orderId: String(r.order_id || ''),
    status: String(r.status || ''),
    updatedAt: String(r.updated_at || ''),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : undefined,
  }));
  return json({ rows, serverTime: new Date().toISOString() });
}

// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------
''')

# --- 3) route -----------------------------------------------------------------
rep(
'''      if (path === '/api/sync/count' && request.method === 'GET') return handleCount(env, request, user, url);
''',
'''      if (path === '/api/sync/count' && request.method === 'GET') return handleCount(env, request, user, url);
      if (path === '/api/orders/status' && request.method === 'GET') return handleOrderStatus(env, request, user, url);
''')

with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(content)
print('worker/src/index.ts patched OK')
