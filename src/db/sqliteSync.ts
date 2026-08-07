// AVNIDEEP CRM PRO — Write-Through SQLite Sync Adapter
// Mirrors all Dexie writes into the underlying native SQLite database via Electron IPC.
// This guarantees that all data is persisted in true SQLite (Documents/AvnideepCRM/database/crm.sqlite)
// while keeping the renderer's reactive Dexie queries fully functional.

import { toast } from 'react-hot-toast';
import { db, CRMDatabase } from './db';

const electronAPI = (window as any).electron;

// Dexie internal table → SQLite table name map
const TABLE_MAP: Record<string, string> = {
  customers: 'customers',
  leads: 'leads',
  orders: 'orders',
  logistics: 'logistics',
  ndrCases: 'ndr_cases',
  timelineLogs: 'timeline_logs',
  notifications: 'notifications',
  invoices: 'invoices',
  products: 'products',
  inventoryLogs: 'inventory_logs',
  invoiceItems: 'invoice_items',
  payments: 'payments',
  invoiceSettings: 'invoice_settings',
};

/**
 * Sanitize record before passing to SQLite — strip arrays/objects.
 */
function sanitize(record: any): any {
  if (!record) return null;
  const safe: any = {};
  for (const k of Object.keys(record)) {
    const v = record[k];
    if (v === undefined) continue;
    if (Array.isArray(v) || (typeof v === 'object' && v !== null && !(v instanceof Date))) {
      safe[k] = JSON.stringify(v);
    } else if (typeof v === 'boolean') {
      safe[k] = v ? 1 : 0;
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

/**
 * Hydrate Dexie from SQLite on app boot. Ensures the renderer sees existing data.
 */
export async function hydrateFromSQLite() {
  if (!electronAPI?.sqlite) return false;
  
  try {
    const tables = Object.entries(TABLE_MAP);
    for (const [dexieName, sqliteName] of tables) {
      const res = await electronAPI.sqlite.getAll(sqliteName);
      if (res?.ok && Array.isArray(res.data) && res.data.length > 0) {
        const table = (db as any)[dexieName];
        if (!table) continue;
        // Snapshot the CURRENT Dexie rows BEFORE clearing. IndexedDB persists
        // across restarts, so it may hold fields that the SQLite table lacks
        // (e.g. leads.assignedTo on databases created before the v4 migration
        // added the columns). We preserve those so assignments survive boot.
        const priorRows = await table.toArray();
        const priorById = new Map((priorRows as any[]).map((r: any) => [Number(r.id), r]));
        // Replace local Dexie cache with SQLite truth
        await table.clear();
        // Map row data, parsing JSON-encoded fields
        const cleaned = res.data.map((row: any) => {
          const out: any = { ...row };
          // Re-parse known JSON-encoded fields
          if (sqliteName === 'ndr_cases' && typeof out.attempts === 'string') {
            try { out.attempts = JSON.parse(out.attempts); } catch (e) { out.attempts = []; }
          }
          // Convert booleans
          if (sqliteName === 'notifications' && typeof out.isRead === 'number') {
            out.isRead = out.isRead === 1;
          }
          // Keep fields that SQLite doesn't carry — SQLite wins on shared keys,
          // prior Dexie fills the gaps (assignments, call counters, reminders).
          const prior = priorById.get(Number(row.id));
          if (prior) {
            for (const [k, v] of Object.entries(prior)) {
              if (out[k] === undefined && v !== undefined) out[k] = v;
            }
          }
          return out;
        });
        await table.bulkPut(cleaned);
      }
    }
    console.log('[SQLite Sync] Hydration complete');
    return true;
  } catch (err) {
    console.error('[SQLite Sync] Hydration failed:', err);
    return false;
  }
}

// ── Throttled error reporter ──────────────────────────────────────────
// Prevents toast spam when rapid Dexie operations fail on the same table.
const _lastToast: Record<string, number> = {};
function reportSyncError(op: string, table: string, err: unknown) {
  const key = `${table}:${op}`;
  const now = Date.now();
  // Only show 1 toast per operation/table every 10 seconds
  if (_lastToast[key] && now - _lastToast[key] < 10_000) return;
  _lastToast[key] = now;

  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[SQLite Sync] ${op} → ${table} failed:`, err);
  toast.error(`SQLite sync error (${table}:${op}): ${msg}`, { duration: 4000 });
}

/**
 * Wire Dexie hooks to mirror writes into SQLite via IPC.
 * Runs lazily — does nothing when not in Electron context.
 */
export function attachWriteThroughSync(database: CRMDatabase) {
  if (!electronAPI?.sqlite) {
    console.log('[SQLite Sync] No Electron context — running in browser-only mode');
    return;
  }

  Object.entries(TABLE_MAP).forEach(([dexieName, sqliteName]) => {
    const table = (database as any)[dexieName];
    if (!table) return;

    // CREATE — Mirror to SQLite after Dexie write
    table.hook('creating', function (this: any, _primKey: any, obj: any) {
      this.onsuccess = (primKey: any) => {
        try {
          const record = sanitize({ ...obj, id: primKey });
          electronAPI.sqlite.insert(sqliteName, record).catch((err: unknown) =>
            reportSyncError('insert', sqliteName, err)
          );
        } catch (e) {
          reportSyncError('insert', sqliteName, e);
        }
      };
    });

    // UPDATE — Mirror changes
    table.hook('updating', function (this: any, changes: any, primKey: any) {
      this.onsuccess = () => {
        try {
          const safe = sanitize(changes);
          if (safe && Object.keys(safe).length > 0) {
            electronAPI.sqlite.update(sqliteName, primKey, safe).catch((err: unknown) =>
              reportSyncError('update', sqliteName, err)
            );
          }
        } catch (e) {
          reportSyncError('update', sqliteName, e);
        }
      };
    });

    // DELETE — Mirror removal
    table.hook('deleting', function (this: any, primKey: any) {
      this.onsuccess = () => {
        try {
          electronAPI.sqlite.delete(sqliteName, primKey).catch((err: unknown) =>
            reportSyncError('delete', sqliteName, err)
          );
        } catch (e) {
          reportSyncError('delete', sqliteName, e);
        }
      };
    });
  });

  console.log('[SQLite Sync] Write-through bridge attached for', Object.keys(TABLE_MAP).length, 'tables');
}

/**
 * Search globally using SQLite indexes (fast).
 */
export async function searchGlobalSQLite(term: string) {
  if (!electronAPI?.sqlite) return null;
  const res = await electronAPI.sqlite.searchCustomer(term);
  return res?.ok ? res.data : null;
}

/**
 * Trigger manual SQLite backup.
 */
export async function triggerSQLiteBackup() {
  if (!electronAPI?.sqlite) return { ok: false, error: 'Not in Electron' };
  return await electronAPI.sqlite.backup();
}

/**
 * Restore SQLite database from a backup file selected by the user.
 */
export async function restoreSQLiteFromDialog() {
  if (!electronAPI?.sqlite) return { ok: false, error: 'Not in Electron' };
  const res = await electronAPI.sqlite.restoreFromDialog();
  if (res?.ok) {
    // Rehydrate Dexie cache after restore
    await hydrateFromSQLite();
  }
  return res;
}
