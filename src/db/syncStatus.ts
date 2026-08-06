// Tiny external store for the online-sync status badge (Sidebar etc.).
import { useSyncExternalStore } from 'react';

export interface SyncStatus {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt?: string;
  error?: string;
}

let status: SyncStatus = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pending: 0,
  syncing: false,
};

const listeners = new Set<(s: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function setSyncStatus(partial: Partial<SyncStatus>): SyncStatus {
  status = { ...status, ...partial };
  listeners.forEach((fn) => fn(status));
  return status;
}

export function subscribeSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}
