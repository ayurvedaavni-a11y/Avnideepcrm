// =====================================================================
// onlineSync.ts — Bidirectional multi-user sync engine
// Local (Dexie) stays the reactive cache; the Cloudflare D1 Worker is the
// shared source of truth. Every local write is queued and pushed via the
// Worker API; every cloud change (from any team member) flows back via a
// 30-second refresh (Supabase Realtime was replaced by polling — the
// periodic pull already existed and is now the only refresh path).
// Local int ids are mapped to cloud INTEGER ids in syncMap.
// =====================================================================
import { db } from './db';
import { api, getToken } from './apiClient';
import { setSyncStatus } from './syncStatus';

// ---------- table config ----------
interface SyncTableConfig {
  cloud: string;
  dexie: string;
  dedup?: string;               // local unique field → cloud UNIQUE column
  fks?: Record<string, string>; // local FK field → parent dexie table
  order: number;                // pull order (parents first)
}

const SYNC_TABLES: Record<string, SyncTableConfig> = {
  customers:       { cloud: 'crm_customers', dexie: 'customers', dedup: 'mobile', order: 1 },
  leads:           { cloud: 'crm_leads', dexie: 'leads', fks: { customerId: 'customers' }, order: 2 },
  orders:          { cloud: 'crm_orders', dexie: 'orders', dedup: 'orderId', fks: { customerId: 'customers', leadId: 'leads' }, order: 3 },
  spacelFollowups: { cloud: 'crm_spacel_followups', dexie: 'spacelFollowups', fks: { customerId: 'customers', leadId: 'leads' }, order: 4 },
  timelineLogs:    { cloud: 'crm_timeline_logs', dexie: 'timelineLogs', fks: { customerId: 'customers' }, order: 5 },
  notifications:   { cloud: 'crm_notifications', dexie: 'notifications', order: 6 },
  callLogs:        { cloud: 'crm_call_logs', dexie: 'callLogs', fks: { leadId: 'leads', customerId: 'customers' }, order: 7 },
};

const ORDERED_KEYS = Object.keys(SYNC_TABLES).sort((a, b) => SYNC_TABLES[a].order - SYNC_TABLES[b].order);

// ---------- key mapping (camelCase ↔ snake_case) ----------
const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());


// ---------- local id ↔ cloud id mapping ----------
async function getCloudId(localTable: string, localId: number): Promise<number | undefined> {
  const e = await db.syncMap.where('[localTable+localId]').equals([localTable, localId]).first();
  return e?.cloudId;
}

async function getLocalIdByCloud(localTable: string, cloudId: number): Promise<number | undefined> {
  const e = await db.syncMap.where('[localTable+cloudId]').equals([localTable, cloudId]).first();
  return e?.localId;
}

async function setMap(localTable: string, localId: number, cloudId: number) {
  const existing = await db.syncMap.where('[localTable+localId]').equals([localTable, localId]).first();
  if (existing && existing.id != null) await db.syncMap.update(existing.id, { cloudId });
  else await db.syncMap.add({ localTable, localId, cloudId });
}

async function deleteMapByLocal(localTable: string, localId: number) {
  await db.syncMap.where('[localTable+localId]').equals([localTable, localId]).delete();
}
// ---------- outbound queue ----------
let suppressHooksDepth = 0; // >0 while applying cloud changes locally

async function enqueue(table: string, action: 'insert' | 'update' | 'delete', localId?: number, record?: any) {
  if (localId != null) {
    // keep only the newest entry per (table, localId) for non-deletes
    await db.syncQueue
      .where('table').equals(table)
      .filter((q) => q.localId === localId && q.action !== 'delete')
      .delete();
  }
  await db.syncQueue.add({
    table, action, localId,
    record: record ? JSON.parse(JSON.stringify(record)) : undefined,
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
  setSyncStatus({ pending: await db.syncQueue.count() });
  void kick();
}

export function attachOnlineSyncHooks() {
  for (const key of ORDERED_KEYS) {
    const cfg = SYNC_TABLES[key];
    const table = (db as any)[cfg.dexie];
    if (!table) continue;

    table.hook('creating', function (this: any, _primKey: any, obj: any) {
      this.onsuccess = (primKey: number) => {
        if (suppressHooksDepth > 0) return;
        const snapshot = { ...obj, id: primKey };
        setTimeout(() => void enqueue(key, 'insert', primKey, snapshot), 0);
      };
    });

    table.hook('updating', function (this: any, _changes: any, primKey: number) {
      this.onsuccess = () => {
        if (suppressHooksDepth > 0) return;
        setTimeout(() => void enqueue(key, 'update', primKey), 0);
      };
    });

    table.hook('deleting', function (this: any, primKey: number) {
      this.onsuccess = () => {
        if (suppressHooksDepth > 0) return;
        setTimeout(() => void enqueue(key, 'delete', primKey), 0);
      };
    });
  }
}

// ---------- outbound processor ----------
let processing = false;

async function processEntry(entry: any) {
  const cfg = SYNC_TABLES[entry.table];
  if (!cfg) return;
  const localTable = (db as any)[cfg.dexie];

  if (entry.action === 'delete') {
    const cloudId = await getCloudId(cfg.dexie, entry.localId);
    if (cloudId != null) {
      await api.deleteRow(cfg.cloud, cloudId);
    }
    await deleteMapByLocal(cfg.dexie, entry.localId);
    return;
  }

  // read the CURRENT local record (full snapshot → full upsert to cloud)
  const local = entry.action === 'insert' && entry.record
    ? entry.record
    : await localTable.get(entry.localId);
  if (!local) return; // record gone — nothing to push

  const cloudRow: Record<string, any> = {};
  for (const k of Object.keys(local)) {
    const v = local[k];
    if (v === undefined || k === 'id') continue;
    let out = v;
    if (cfg.fks && cfg.fks[k]) {
      const parentLocalId = Number(v) || 0;
      const parentCloudId = parentLocalId ? await getCloudId(cfg.fks[k], parentLocalId) : undefined;
      if (parentCloudId == null && parentLocalId !== 0) {
        throw new Error(`parent ${cfg.fks[k]} #${parentLocalId} not synced yet`);
      }
      out = parentCloudId ?? 0;
    }
    cloudRow[camelToSnake(k)] = out;
  }

  let cloudId = await getCloudId(cfg.dexie, local.id);
  let result: { id?: number | string | null };
  // Leads enrichment: the crm_leads table has customer_name + mobile as
  // NOT NULL columns. Local leads only carry customerId, so look up the
  // local customer (by LOCAL id, not cloud id) and attach its name/mobile —
  // otherwise every push fails and leads never reach the cloud.
  if (entry.table === 'leads' && local.customerId) {
    const customer = await db.customers.get(Number(local.customerId) || 0);
    if (customer) {
      if (customer.name) cloudRow.customer_name = customer.name;
      if (customer.mobile) cloudRow.mobile = customer.mobile;
    }
  }
  if (cloudRow.customer_name == null) cloudRow.customer_name = '';
  if (cloudRow.mobile == null) cloudRow.mobile = '';

  if (cloudId != null) {
    result = await api.pushRow(cfg.cloud, { ...cloudRow, id: cloudId }, 'id');
  } else if (cfg.dedup && cloudRow[camelToSnake(cfg.dedup)]) {
    result = await api.pushRow(cfg.cloud, cloudRow, camelToSnake(cfg.dedup));
  } else {
    result = await api.pushRow(cfg.cloud, cloudRow);
  }
  if (result?.id != null) await setMap(cfg.dexie, local.id, Number(result.id));
}

async function processQueue() {
  if (processing) return;
  if (!navigator.onLine) { setSyncStatus({ online: false }); return; }
  processing = true;
  try {
    const entries = await db.syncQueue.orderBy('createdAt').toArray();
    if (entries.length === 0) { setSyncStatus({ pending: 0 }); return; }
    const now = Date.now();
    for (const entry of entries) {
      // Exponential backoff per entry — a failing row retries on its own
      // schedule and can NEVER block the rows behind it in the queue.
      if (entry.dead) continue; // dead-lettered permanent failure — skipped forever
      const attempts = entry.attempts || 0;
      if (entry.lastAttemptAt) {
        const backoffMs = Math.min(30_000, 2_000 * Math.pow(2, Math.min(attempts, 5)));
        if (now - new Date(entry.lastAttemptAt).getTime() < backoffMs) continue;
      }
      try {
        await processEntry(entry);
        if (entry.id != null) await db.syncQueue.delete(entry.id);
      } catch (err: any) {
        const next = attempts + 1;
        // PERMANENT failures (4xx = the server rejected the row: invalid lead
        // status, forbidden table, bad FK, unknown table) can never succeed by
        // retrying — dead-letter them so they stop inflating "items sync
        // pending" forever. Transient errors (network / 5xx) retry with
        // backoff and only die after 6 attempts.
        const s = Number((err as any)?.status || 0);
        // Validation rejections can never succeed by retrying. Auth errors
        // (401/403), throttling (429), 5xx and network (0) are transient —
        // dead-lettering them would silently drop pending pushes after a
        // re-login. They still die after 6 attempts to cap queue growth.
        const permanent = s === 400 || s === 404 || s === 422;
        const dead = permanent || next >= 6;
        if (entry.id != null) {
          await db.syncQueue.update(entry.id, {
            attempts: next,
            dead: dead ? 1 : 0,
            lastAttemptAt: new Date().toISOString(),
            lastError: String(err?.message || err).slice(0, 300),
          });
        }
        if (next <= 2) console.warn('[OnlineSync] push failed, will retry:', entry.table, err?.message);
        // CRITICAL FIX: never break here. A single permanently-failing row used
        // to stall the WHOLE queue (stuck assignments + unsynced imports).
      }
    }
    setSyncStatus({ pending: await db.syncQueue.filter((q) => !q.dead).count() });
  } finally {
    processing = false;
  }
}
// ---------- dead-letter helpers + local reset state ----------

/** Permanently delete dead-lettered (4xx / too-many-retries) sync entries. */
export async function clearFailedSyncEntries(): Promise<number> {
  const dead = await db.syncQueue.filter((q) => !!q.dead).toArray();
  const ids = dead.map((d) => d.id).filter((x): x is number => x != null);
  if (ids.length) await db.syncQueue.bulkDelete(ids);
  setSyncStatus({ pending: await db.syncQueue.filter((q) => !q.dead).count() });
  return dead.length;
}

/** Count dead-lettered (permanently failed) sync entries. */
export async function countFailedSyncEntries(): Promise<number> {
  try { return await db.syncQueue.filter((q) => !!q.dead).count(); } catch { return 0; }
}

/** After a factory reset: wipe local sync cursors + epoch so the next pull is
 *  a fresh full sync of the (now empty) cloud — no stale delta pulls. */
export function resetLocalSyncState(): void {
  const uid = activeUserId();
  if (!uid) return;
  localStorage.removeItem(CURSOR_PREFIX + uid);
  localStorage.removeItem(STATUS_CURSOR_PREFIX + uid);
  localStorage.removeItem(EPOCH_PREFIX + uid);
}

// ---------- inbound: apply a cloud row into the local cache ----------
type DeferredRow = [string, Record<string, any>];

async function applyRemoteRow(key: string, cloudRow: Record<string, any>, deferred: DeferredRow[]): Promise<void> {
  const cfg = SYNC_TABLES[key];
  if (!cfg) return;
  const localTable = (db as any)[cfg.dexie];
  const local: Record<string, any> = {};
  let cloudId = 0;

  for (const [ck, cv] of Object.entries(cloudRow)) {
    const camel = snakeToCamel(ck);
    if (camel === 'id') { cloudId = Number(cv) || 0; continue; }
    // Never let a NULL cloud value wipe a LOCAL assignment that may not have
    // reached the cloud yet (offline / pending push). Cloud wins only when it
    // actually carries a value. An explicit '' (un-assignment) still propagates.
    if ((camel === 'assignedTo' || camel === 'assignedAgent') && cv == null) {
      continue;
    }
    let v = cv;
    const fkParent = cfg.fks
      ? Object.entries(cfg.fks).find(([localFk]) => camelToSnake(localFk) === ck)
      : undefined;
    if (fkParent) {
      const parentCloudId = Number(v) || 0;
      const parentLocalId = parentCloudId ? await getLocalIdByCloud(fkParent[1], parentCloudId) : undefined;
      if (parentLocalId == null && parentCloudId !== 0) {
        deferred.push([key, cloudRow]); // parent not local yet — retry after other tables
        return;
      }
      v = parentLocalId ?? 0;
    }
    local[camel] = v;
  }
  if (!cloudId) return;

  // find existing local row (by cloud id, then by dedup key)
  let localId = await getLocalIdByCloud(key, cloudId);
  if (localId == null && cfg.dedup && local[cfg.dedup]) {
    const dup = await (localTable as any).where(cfg.dedup).equals(local[cfg.dedup]).first();
    if (dup) localId = dup.id;
  }

  if (localId != null) {
    await localTable.update(localId, local);
    await setMap(key, localId, cloudId);
  } else {
    const newId = await localTable.add(local);
    if (newId != null) await setMap(key, newId, cloudId);
  }
}

// ---------- incremental pull (cursor-based delta sync) ----------
// Every 30s the client no longer downloads the WHOLE cloud. After the first
// full sync it stores per-user cursors (server watermark `pulledAt`) and only
// fetches rows changed since then + tombstones for cloud-side deletes. A full
// re-sync runs every 10th pull (~5 min) as a self-healing safety net, and
// `syncNow()` (manual refresh) always does a full pull. Login is never
// blocked — this runs in the background; the UI reads the local Dexie cache.
const CURSOR_PREFIX = 'crm_sync_cursors_';
interface SyncCursors { tables: Record<string, string>; deletedAt: string; fullPulls: number; }

function loadCursors(userId: string): SyncCursors | null {
  try {
    const raw = localStorage.getItem(CURSOR_PREFIX + userId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveCursors(userId: string, c: SyncCursors) {
  try { localStorage.setItem(CURSOR_PREFIX + userId, JSON.stringify(c)); } catch { /* ignore */ }
}

async function pullFromCloud(userId: string, forceFull = false): Promise<{ ok: boolean; error?: string }> {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  suppressHooksDepth++;
  try {
    const cursors = loadCursors(userId);
    const ready = cursors && ORDERED_KEYS.every((k) => typeof cursors.tables[k] === 'string');
    // Full re-sync every 5th pull (~75s worst case) instead of every 10th
    // (~2.5 min): a stuck/invalid incremental cursor heals twice as fast, so a
    // stale open tab converges quickly even if a watermark ever goes stale.
    const incremental = ready && !forceFull && (cursors!.fullPulls % 5 !== 4);
    const cloudNames = ORDERED_KEYS.map((k) => SYNC_TABLES[k].cloud);
    const deferred: DeferredRow[] = [];
    let pulledAt = '';
    const res = incremental
      ? await api.pullAll(cloudNames, {
          since: cursors!.tables[ORDERED_KEYS[0]],
          deletedSince: cursors!.deletedAt || undefined,
        })
      : await api.pullAll(cloudNames);
    // FACTORY-RESET EPOCH INVALIDATION: the server bumps sync_epoch on every
    // reset. A mismatch means the whole data set was wiped — purge the local
    // cache + sync queue + id maps + cursors so a stale pending push can never
    // resurrect old data, then immediately re-pull everything fresh.
    const serverEpoch = Number(res.epoch ?? 0);
    const epochKey = EPOCH_PREFIX + userId;
    const storedEpoch = Number(localStorage.getItem(epochKey) || '0');
    // Mismatch covers upgrading devices too: a client that synced under the
    // OLD code has no stored epoch (0) but may hold stale local data + a
    // pending queue — it must purge exactly like everyone else. Fresh
    // installs purge an empty DB harmlessly (equality check still prevents
    // purging when no reset ever happened: both epochs stay 0).
    if (serverEpoch > 0 && storedEpoch !== serverEpoch) {
      for (const k of ORDERED_KEYS) await (db as any)[SYNC_TABLES[k].dexie].clear();
      await db.syncQueue.clear();
      await db.syncMap.clear();
      localStorage.removeItem(CURSOR_PREFIX + userId);
      localStorage.removeItem(STATUS_CURSOR_PREFIX + userId);
      localStorage.removeItem(epochKey);
      return pullFromCloud(userId, true);
    }
    if (serverEpoch > 0) localStorage.setItem(epochKey, String(serverEpoch));
    pulledAt = res.pulledAt || new Date().toISOString();
    for (const key of ORDERED_KEYS) {
      const cfg = SYNC_TABLES[key];
      for (const row of res.rows[cfg.cloud] || []) await applyRemoteRow(key, row, deferred);
    }
    // prune locally-deleted cloud rows via tombstones (incremental only)
    if (incremental) {
      const deleted = res.deleted || {};
      for (const key of ORDERED_KEYS) {
        const cfg = SYNC_TABLES[key];
        for (const t of deleted[cfg.cloud] || []) {
          const cloudId = Number(t.id) || 0;
          const localId = cloudId ? await getLocalIdByCloud(key, cloudId) : undefined;
          if (localId != null) {
            await (db as any)[cfg.dexie].delete(localId);
            await deleteMapByLocal(key, localId);
          }
        }
      }
    }
    // retry orphaned rows (missing parents) a few times
    for (let pass = 0; pass < 3 && deferred.length > 0; pass++) {
      const remaining: DeferredRow[] = [];
      for (const [k, r] of deferred) await applyRemoteRow(k, r, remaining);
      deferred.length = 0;
      deferred.push(...remaining);
    }
    const next: SyncCursors = {
      tables: {},
      deletedAt: pulledAt,
      fullPulls: incremental ? (cursors!.fullPulls + 1) : 0,
    };
    for (const key of ORDERED_KEYS) next.tables[key] = pulledAt;
    saveCursors(userId, next);
    setSyncStatus({ lastSyncAt: new Date().toISOString(), error: undefined });
    return { ok: true };
  } catch (err: any) {
    setSyncStatus({ error: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err) };
  } finally {
    suppressHooksDepth--;
  }
}

// Backward-compatible alias used by manual/manual-ish callers.
export async function pullAllFromCloud(): Promise<{ ok: boolean; error?: string }> {
  return pullFromCloud(activeUserId(), true);
}

/**
 * Pull cloud changes for the current user now.
 * - `forceFull = true`  → full pull (fresh, cursor-independent). Used when the
 *   tab becomes visible again, regains focus, or comes back online — the exact
 *   moments a stale open tab must converge on the latest server data.
 * - `forceFull = false` → normal incremental cursor pull (the 15s interval).
 */
export async function pullNow(forceFull: boolean): Promise<{ ok: boolean; error?: string }> {
  return pullFromCloud(activeUserId(), forceFull);
}

function activeUserId(): string {
  try {
    const raw = localStorage.getItem('crm_auth_token') || '';
    if (raw) {
      const p = raw.split('.')[1];
      if (p) {
        const d = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
        if (d?.sub) return String(d.sub);
      }
    }
  } catch { /* fall through */ }
  return 'default';
}

// ---------- one-time export: push existing local data when cloud is empty ----------
async function exportLocalIfCloudEmpty() {
  for (const key of ORDERED_KEYS) {
    const cfg = SYNC_TABLES[key];
    const localCount = await (db as any)[key].count();
    if (!localCount) continue;
    const { count } = await api.countTable(cfg.cloud);
    if (count) continue; // cloud already has data — skip
    const rows = await (db as any)[key].toArray();
    for (const r of rows) await enqueue(key, 'insert', r.id, r);
  }
  await processQueue();
}

// ---------- landing-page intake (public `leads` table via the Worker) ----------
export async function processIntakeLeads(): Promise<{ success: boolean; count: number; error?: string }> {
  if (!navigator.onLine) return { success: false, count: 0, error: 'offline' };
  try {
    const { data: pending } = await api.intakePending();
    let count = 0;
    for (const lead of pending || []) {
      try {
        const mobile = String(lead.mobile || '').replace(/\D/g, '');
        const custUpsert = await api.pushRow('crm_customers', {
          mobile, name: lead.name || 'Lead',
          address: lead.address, city: lead.city, state: lead.state, pincode: lead.pincode,
          total_orders: 0, delivered: 0, rto: 0, cancelled: 0, fake_count: 0, total_spend: 0,
          risk_level: 'Low', current_status: 'Order Booked',
          created_at: lead.created_at ? new Date(lead.created_at).toISOString() : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, 'mobile');
        const cloudCustomerId = Number(custUpsert.id);

        await api.pushRow('crm_leads', {
          customer_id: cloudCustomerId,
          product: lead.product || 'Inquiry',
          source: lead.source || 'Landing Page',
          expected_amount: Number(lead.amount) || 0,
          priority: 'High', status: 'Order Booked', assigned_agent: 'Auto Sync',
          notes: `Landing Page ID: ${lead.id} | Mode: ${lead.payment_mode || 'COD'}`,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });

        await api.pushRow('crm_timeline_logs', {
          customer_id: cloudCustomerId, entity_type: 'Lead', action: 'Synced from Online',
          notes: `Lead automatically synced from landing page. Payment: ${lead.payment_mode || 'COD'}`,
          agent_name: 'SyncEngine', created_at: new Date().toISOString(),
        });

        await api.pushRow('leads', {
          id: lead.id, sync_status: 'synced', synced_at: new Date().toISOString(),
        }, 'id');
        count++;
      } catch (e: any) {
        await api
          .pushRow('leads', { id: lead.id, sync_status: 'failed', sync_error: String(e?.message || e).slice(0, 300) }, 'id')
          .catch(() => {});
      }
    }
    if (count > 0) console.log('[OnlineSync] intake converted', count, 'landing-page leads');
    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: String(err?.message || err) };
  }
}

// ---------- fast order-status poll (admin change → telecaller in ~2s) ----------
const STATUS_CURSOR_PREFIX = 'crm_status_cursor_';
const EPOCH_PREFIX = 'crm_sync_epoch_';

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
          let order: any = null;
          if (localId != null) {
            const orderPatch: any = { status: r.status, updatedAt: r.updatedAt };
            if (r.deliveredAt) orderPatch.deliveredAt = r.deliveredAt;
            await db.orders.update(localId, orderPatch);
            order = await db.orders.get(localId);
          }
          // Mirror the linked lead + customer central status exactly like
          // syncOrderToCentralStatus() does on the writer side, so Lead Center
          // and Customer Timeline agree within seconds too.
          if (order?.leadId) {
            await db.leads.update(order.leadId, { status: r.status as any, updatedAt: r.updatedAt });
          }
          if (order?.customerId) {
            await db.customers.update(order.customerId, { currentStatus: r.status as any, updatedAt: r.updatedAt });
          }
          // NEW: mirror via CLOUD ids as well. Fixes the stale-lead case where
          // the local order row is missing (booked on another device / never
          // pulled): a Delivered/RTO/Cancelled order still updates the linked
          // lead + customer locally within ~2s, so the telecaller's Lead Center
          // can never keep showing that customer as an active 'New Lead'.
          if (r.leadId && !order?.leadId) {
            const lid = await getLocalIdByCloud('leads', Number(r.leadId));
            if (lid != null) await db.leads.update(lid, { status: r.status as any, updatedAt: r.updatedAt });
          }
          if (r.customerId && !order?.customerId) {
            const cid = await getLocalIdByCloud('customers', Number(r.customerId));
            if (cid != null) await db.customers.update(cid, { currentStatus: r.status as any, updatedAt: r.updatedAt });
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

function kick() { void processQueue(); }

// ---------- return-to-tab refresh ----------
// Stale-open-tab fix: when the tab becomes visible / regains focus / comes
// back online we refresh IMMEDIATELY instead of waiting for the 15s tick.
// Two safeguards keep this production-safe:
//  1. processQueue() is AWAITED first — a pending local edit reaches the
//     server before the pull applies cloud rows, so a full pull can never
//     overwrite a not-yet-pushed local change with older server state.
//  2. Full pulls are gated to at most once per FULL_PULL_GAP_MS: returning to
//     the tab is exactly the stale-tab moment that needs a fresh snapshot,
//     but re-downloading every table on every focus flicker would be wasteful
//     for large datasets — consecutive returns within the gap use the cheap
//     incremental cursor pull instead (the 5th-pull cadence still forces
//     fulls as a background self-heal).
const FULL_PULL_GAP_MS = 60_000;
let lastFullPullAt = 0;

async function refreshOnTabReturn(forceFull: boolean) {
  await processQueue();
  if (forceFull || Date.now() - lastFullPullAt > FULL_PULL_GAP_MS) {
    lastFullPullAt = Date.now();
    await pullNow(true);
  } else {
    await pullNow(false);
  }
}

export async function startOnlineSync(): Promise<void> {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    setSyncStatus({ online: true });
    // Connection restored → full pull so any changes made elsewhere while
    // offline arrive immediately (no waiting for the 15s tick).
    void refreshOnTabReturn(true);
  });
  window.addEventListener('offline', () => setSyncStatus({ online: false, error: undefined }));

  attachOnlineSyncHooks();
  setSyncStatus({ syncing: true });
  try {
    await exportLocalIfCloudEmpty();
    // First sync: full (no cursors yet) or delta (fast app re-open).
    await pullFromCloud(activeUserId(), false);
    await processIntakeLeads();
    await processQueue();
  } catch (e) {
    console.error('[OnlineSync] initial sync failed:', e);
  } finally {
    setSyncStatus({ syncing: false, online: true });
  }

  // Realtime was replaced by periodic polling — Supabase Realtime does not
  // exist on D1. Cloud changes arrive on the next tick. The main delta pull
  // now runs every 15s (cheap: only rows changed since the last watermark +
  // tombstones) and the lightweight /api/orders/status poll below pushes
  // order status changes (Delivered/RTO/Cancelled) to every device in ~2s.
  intervalId = setInterval(async () => {
    await processQueue();
    await pullNow(false);
    await processIntakeLeads();
  }, 15000);

  // Fast status poll — the critical path: admin changes an order status and
  // the telecaller's My Orders reflects it within ~2 seconds. Idempotent with
  // the main pull (same fields, just faster + lighter).
  statusIntervalId = setInterval(() => void pollOrderStatus(activeUserId()), 2000);

  // Refetch immediately when the app/tab becomes visible again — and force a
  // FULL pull (not incremental) so a tab that sat open while another device
  // (or a deploy + import) changed the data converges on the first moment the
  // user looks at it again. This is the primary fix for the stale-open-tab
  // scenario: return to the tab → fresh data, no manual refresh needed.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Queue flushed first, then a (gated) full pull — see refreshOnTabReturn.
      void refreshOnTabReturn(false);
      void pollOrderStatus(activeUserId());
    }
  });
  // Same guarantee when the window regains focus (covers browsers/OS where
  // focus fires without a visibilitychange, and single-tab returns).
  window.addEventListener('focus', () => {
    void refreshOnTabReturn(false);
  });
}

export function stopOnlineSync(): void {
  started = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  if (statusIntervalId) { clearInterval(statusIntervalId); statusIntervalId = null; }
  try { localStorage.removeItem(STATUS_CURSOR_PREFIX + activeUserId()); } catch { /* noop */ }
}

export async function syncNow(): Promise<{ online: boolean; pending: number; error?: string }> {
  setSyncStatus({ syncing: true });
  try {
    await processQueue();
    // Manual sync = full pull (self-healing, heals any clock-skew drift).
    await pullFromCloud(activeUserId(), true);
    await processIntakeLeads();
  } catch (e: any) {
    setSyncStatus({ error: String(e?.message || e) });
    return { online: false, pending: 0, error: String(e?.message || e) };
  } finally {
    setSyncStatus({ syncing: false });
  }
  const s = await db.syncQueue.count();
  setSyncStatus({ pending: s });
  return { online: true, pending: s };
}
