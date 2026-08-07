# -*- coding: utf-8 -*-
# Production fixes: frontend
#  1) apiClient: getCurrentRole() + api.orderStatus()
#  2) onlineSync: ~2s fast status poll + 15s main interval + visibilitychange
#  3) workflow: deliveredAt stamping in updateOrderStatus
#  4) invoiceEngine: admin-only guards
#  5) OrderPipeline: telecaller invoice hidden + read-only tracking stepper
import io, sys

def load(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()

def save(p, c):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(c)

def patch_file(path, edits):
    content = load(path)
    NL = '\r\n' if '\r\n' in content else '\n'
    for old, new in edits:
        o = old.replace('\n', NL)
        n = new.replace('\n', NL)
        c = content.count(o)
        if c != 1:
            print(f'FAIL [{c}] in {path}: {old.splitlines()[0][:80]}')
            sys.exit(1)
        content = content.replace(o, n)
        print('OK', path.split('/')[-1], '->', old.splitlines()[0][:60])
    save(path, content)

# ==================== apiClient.ts ====================
patch_file('src/db/apiClient.ts', [
("""export function getToken(): string | null {
  return token;
}
""",
"""export function getToken(): string | null {
  return token;
}

/** Current signed-in role, decoded straight from the JWT (no network call).
 *  Used by UI + invoice engine to enforce admin-only features. */
export function getCurrentRole(): 'admin' | 'telecaller' | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    if (!raw) return null;
    const p = raw.split('.')[1];
    if (!p) return null;
    const d = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (d?.role === 'admin' || d?.role === 'telecaller') return d.role;
    return null;
  } catch { return null; }
}
"""),
("""  countTable: (table: string) =>
    request<{ count: number }>(`/api/sync/count?table=${encodeURIComponent(table)}`),
""",
"""  countTable: (table: string) =>
    request<{ count: number }>(`/api/sync/count?table=${encodeURIComponent(table)}`),

  // ---- fast order-status sync (admin change reaches telecaller in ~2s) ----
  orderStatus: (since?: string) => {
    let q = '/api/orders/status';
    if (since) q += `?since=${encodeURIComponent(since)}`;
    return request<{ rows: Array<{ id: number; orderId: string; status: string; updatedAt: string; deliveredAt?: string }>; serverTime: string }>(q);
  },
"""),
])

# ==================== onlineSync.ts ====================
patch_file('src/db/onlineSync.ts', [
("""import { api } from './apiClient';
""",
"""import { api, getToken } from './apiClient';
"""),
("""// ---------- lifecycle ----------
let started = false;
let intervalId: any = null;
""",
"""// ---------- fast order-status poll (admin change → telecaller in ~2s) ----------
const STATUS_CURSOR_PREFIX = 'crm_status_cursor_';

async function pollOrderStatus(userId: string) {
  if (!navigator.onLine) return;
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
  if (!getToken()) return;
  try {
    const since = localStorage.getItem(STATUS_CURSOR_PREFIX + userId) || undefined;
    const res = await api.orderStatus(since);
    if (res.rows && res.rows.length > 0) {
      suppressHooksDepth++;
      try {
        for (const r of res.rows) {
          const localId = await getLocalIdByCloud('orders', Number(r.id));
          if (localId == null) continue;
          const orderPatch: any = { status: r.status, updatedAt: r.updatedAt };
          if (r.deliveredAt) orderPatch.deliveredAt = r.deliveredAt;
          await db.orders.update(localId, orderPatch);
          const order = await db.orders.get(localId);
          // Mirror the linked lead + customer central status exactly like
          // syncOrderToCentralStatus() does on the writer side, so Lead Center
          // and Customer Timeline agree within seconds too.
          if (order?.leadId) {
            await db.leads.update(order.leadId, { status: r.status, updatedAt: r.updatedAt });
          }
          if (order?.customerId) {
            await db.customers.update(order.customerId, { currentStatus: r.status, updatedAt: r.updatedAt });
          }
        }
      } finally {
        suppressHooksDepth--;
      }
    }
    if (res.serverTime) localStorage.setItem(STATUS_CURSOR_PREFIX + userId, res.serverTime);
  } catch { /* transient network issue — next tick retries */ }
}

// ---------- lifecycle ----------
let started = false;
let intervalId: any = null;
let statusIntervalId: any = null;
"""),
("""  // Realtime was replaced by periodic polling (30s) — Supabase Realtime
  // does not exist on D1. Cloud changes arrive on the next tick.
  intervalId = setInterval(async () => {
    await processQueue();
    // Delta pull — only rows changed since the last watermark (+ tombstones).
    await pullFromCloud(activeUserId(), false);
    await processIntakeLeads();
  }, 30000);
""",
"""  // Realtime was replaced by periodic polling — Supabase Realtime does not
  // exist on D1. Cloud changes arrive on the next tick. The main delta pull
  // now runs every 15s (cheap: only rows changed since the last watermark +
  // tombstones) and the lightweight /api/orders/status poll below pushes
  // order status changes (Delivered/RTO/Cancelled) to every device in ~2s.
  intervalId = setInterval(async () => {
    await processQueue();
    await pullFromCloud(activeUserId(), false);
    await processIntakeLeads();
  }, 15000);

  // Fast status poll — the critical path: admin changes an order status and
  // the telecaller's My Orders reflects it within ~2 seconds. Idempotent with
  // the main pull (same fields, just faster + lighter).
  statusIntervalId = setInterval(() => void pollOrderStatus(activeUserId()), 2000);

  // Refetch immediately when the app/tab becomes visible again.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void processQueue();
      void pullFromCloud(activeUserId(), false);
      void pollOrderStatus(activeUserId());
    }
  });
"""),
("""export function stopOnlineSync(): void {
  started = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}
""",
"""export function stopOnlineSync(): void {
  started = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  if (statusIntervalId) { clearInterval(statusIntervalId); statusIntervalId = null; }
}
"""),
])

# ==================== workflow.ts ====================
patch_file('src/db/workflow.ts', [
("""  const now = new Date().toISOString();
  const update: any = { status: newStatus, updatedAt: now };
  if (meta.trackingId != null) update.trackingId = meta.trackingId;
  if (meta.courier != null) update.courier = meta.courier;
  if (meta.shipmentDate != null) update.shipmentDate = meta.shipmentDate;
  await db.orders.update(orderId, update);
""",
"""  const now = new Date().toISOString();
  const update: any = { status: newStatus, updatedAt: now };
  if (meta.trackingId != null) update.trackingId = meta.trackingId;
  if (meta.courier != null) update.courier = meta.courier;
  if (meta.shipmentDate != null) update.shipmentDate = meta.shipmentDate;
  // Authoritative delivery timestamp — mirrors the worker's server-side stamp
  // on crm_orders.delivered_at so the local row stays consistent with D1 and
  // the commission windows always agree. Cleared when reverting from Delivered.
  if (newStatus === 'Delivered') update.deliveredAt = now;
  if (oldStatus === 'Delivered' && newStatus !== 'Delivered') update.deliveredAt = undefined;
  await db.orders.update(orderId, update);
"""),
])

# ==================== invoiceEngine.ts ====================
patch_file('src/db/invoiceEngine.ts', [
("""import { db, Invoice } from './db';
import { toast } from 'react-hot-toast';
""",
"""import { db, Invoice } from './db';
import { getCurrentRole } from './apiClient';
import { toast } from 'react-hot-toast';
"""),
("""import { resolveCustomerState } from './stateResolver';
""",
"""import { resolveCustomerState } from './stateResolver';

// ===== Admin-only invoice guard =====
// Telecallers can neither view, download, print nor generate invoices. This is
// enforced in the UI (button hidden, admin-only routes) AND here, so a
// telecaller device never even creates/holds an invoice row. The worker
// additionally denies crm_invoices access for non-admin roles, and invoice
// rows are not part of the synced table set at all.
function invoiceAllowed(): boolean {
  return getCurrentRole() === 'admin';
}
"""),
("""export async function autoGenerateInvoice(orderId: number, agentName: string = 'System'): Promise<Invoice | null> {
  try {
    if (orderId <= 0) {
""",
"""export async function autoGenerateInvoice(orderId: number, agentName: string = 'System'): Promise<Invoice | null> {
  if (!invoiceAllowed()) {
    console.warn('[InvoiceEngine] Invoice generation blocked — admin only');
    return null;
  }
  try {
    if (orderId <= 0) {
"""),
("""}): Promise<Invoice | null> {
  try {
    const gstCfg = await getGSTConfig();
""",
"""}): Promise<Invoice | null> {
  if (!invoiceAllowed()) {
    console.warn('[InvoiceEngine] Invoice creation blocked — admin only');
    return null;
  }
  try {
    const gstCfg = await getGSTConfig();
"""),
("""export async function downloadInvoicePDF(invoice: Invoice) {
  try {
    const companyCfg = await getCompanyConfig();
""",
"""export async function downloadInvoicePDF(invoice: Invoice) {
  if (!invoiceAllowed()) {
    toast.error('Invoice sirf Admin dekh sakta hai');
    return;
  }
  try {
    const companyCfg = await getCompanyConfig();
"""),
("""export async function printInvoice(invoice: Invoice) {
  try {
    const companyCfg = await getCompanyConfig();
""",
"""export async function printInvoice(invoice: Invoice) {
  if (!invoiceAllowed()) {
    toast.error('Invoice sirf Admin dekh sakta hai');
    return;
  }
  try {
    const companyCfg = await getCompanyConfig();
"""),
])

print('PART 1 OK')
