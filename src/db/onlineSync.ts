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
import { api } from './apiClient';
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
        if (entry.id != null) {
          await db.syncQueue.update(entry.id, {
            attempts: next,
            lastAttemptAt: new Date().toISOString(),
            lastError: String(err?.message || err).slice(0, 300),
          });
        }
        if (next <= 2) console.warn('[OnlineSync] push failed, will retry:', entry.table, err?.message);
        // CRITICAL FIX: never break here. A single permanently-failing row used
        // to stall the WHOLE queue (stuck assignments + unsynced imports).
      }
    }
    setSyncStatus({ pending: await db.syncQueue.count() });
  } finally {
    processing = false;
  }
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

// ---------- full pull (login + periodic safety net) ----------
export async function pullAllFromCloud(): Promise<{ ok: boolean; error?: string }> {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  suppressHooksDepth++;
  try {
    const deferred: DeferredRow[] = [];
    const cloudNames = ORDERED_KEYS.map((k) => SYNC_TABLES[k].cloud);
    const { rows } = await api.pullAll(cloudNames);
    for (const key of ORDERED_KEYS) {
      const cfg = SYNC_TABLES[key];
      for (const row of rows[cfg.cloud] || []) await applyRemoteRow(key, row, deferred);
    }
    // retry orphaned rows (missing parents) a few times
    for (let pass = 0; pass < 3 && deferred.length > 0; pass++) {
      const remaining: DeferredRow[] = [];
      for (const [k, r] of deferred) await applyRemoteRow(k, r, remaining);
      deferred.length = 0;
      deferred.push(...remaining);
    }
    setSyncStatus({ lastSyncAt: new Date().toISOString(), error: undefined });
    return { ok: true };
  } catch (err: any) {
    setSyncStatus({ error: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err) };
  } finally {
    suppressHooksDepth--;
  }
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

// ---------- lifecycle ----------
let started = false;
let intervalId: any = null;

function kick() { void processQueue(); }

export async function startOnlineSync(): Promise<void> {
  if (started) return;
  started = true;
  window.addEventListener('online', () => { setSyncStatus({ online: true }); void kick(); });
  window.addEventListener('offline', () => setSyncStatus({ online: false, error: undefined }));

  attachOnlineSyncHooks();
  setSyncStatus({ syncing: true });
  try {
    await exportLocalIfCloudEmpty();
    await pullAllFromCloud();
    await processIntakeLeads();
    await processQueue();
  } catch (e) {
    console.error('[OnlineSync] initial sync failed:', e);
  } finally {
    setSyncStatus({ syncing: false, online: true });
  }

  // Realtime was replaced by periodic polling (30s) — Supabase Realtime
  // does not exist on D1. Cloud changes arrive on the next tick.
  intervalId = setInterval(async () => {
    await processQueue();
    await pullAllFromCloud();
    await processIntakeLeads();
  }, 30000);
}

export function stopOnlineSync(): void {
  started = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

export async function syncNow(): Promise<{ online: boolean; pending: number; error?: string }> {
  setSyncStatus({ syncing: true });
  try {
    await processQueue();
    await pullAllFromCloud();
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
