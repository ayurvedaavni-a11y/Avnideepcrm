// =====================================================================
// pushClient.ts — client side of the callback-reminder Web Push system.
//
// Responsibilities:
//   * Request the Notification permission (first time, clearly).
//   * Subscribe this device (PushManager) with the server VAPID public key.
//   * Register / unregister the subscription with the Worker.
//   * Upsert a server-side reminder whenever a lead gets a follow-up/callback
//     date+time (reschedule overwrites the old one server-side by lead id).
//   * Cancel the server reminder when a callback is done / status leaves the
//     follow-up family.
//   * Re-sync all local follow-up reminders after login / refresh so the
//     configuration always survives a browser restart.
// =====================================================================
import { api } from './apiClient';
import { db } from './db';
import type { TeamProfile } from './auth';

// Public VAPID key (safe to ship — it's the browser's subscription key).
// Must match the worker's VAPID_PUBLIC_KEY secret.
export const VAPID_PUBLIC_KEY =
  'BBkghzRaYVNusAQG4fmOQr5qECBasNpMJXkIXTE316_ES2PL5tzzO9Qp9ptiBOHl1Fzv8esmhkvvybmjvCF8aVo';

const SUB_KEY = 'crm_push_subscribed_user';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Asia/Kolkata — follow-up date (yyyy-MM-dd) + time (HH:mm) are entered by an
 * India-based user in local IST time. Build an ISO-8601 UTC timestamp so the
 * server cron can compare it against UTC clock safely.
 */
export function followupToUtc(date: string, time: string): string | null {
  if (!date) return null;
  const t = time || '09:00';
  const ist = `${date}T${t}:00+05:30`; // IST = UTC+05:30, no DST
  const d = new Date(ist);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** True when the given status is a scheduled-reminder status. */
export function isReminderStatus(status?: string): boolean {
  return (
    status === 'Followup' ||
    status === 'Callback' ||
    status === 'Callback Requested' ||
    status === 'Not Reachable' ||
    status === 'Busy'
  );
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure this device is subscribed AND registered server-side for the given
 * user. Returns true when the device will receive push notifications.
 */
export async function ensurePushSubscription(profile: TeamProfile): Promise<boolean> {
  if (!pushSupported() || !profile?.id) return false;
  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;

    const reg = await getRegistration();
    if (!reg) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const json = sub.toJSON();
    const endpoint = json.endpoint;
    const p256dh = (json.keys as any)?.p256dh;
    const auth = (json.keys as any)?.auth;
    if (!endpoint || !p256dh || !auth) return false;

    try {
      await api.pushSubscribe({ endpoint, keys: { p256dh, auth } });
      localStorage.setItem(SUB_KEY, String(profile.id));
    } catch {
      // Offline / worker down — subscription exists locally; retry on next sync.
    }
    return true;
  } catch (err) {
    console.error('[push] subscribe failed:', err);
    return false;
  }
}

/** Remove this device's subscription (logout / revoke). */
export async function unregisterPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await api.pushUnsubscribe(sub.endpoint);
        } catch { /* server may be offline */ }
        await sub.unsubscribe();
      }
    }
  } catch { /* noop */ }
  try { localStorage.removeItem(SUB_KEY); } catch { /* noop */ }
}

/**
 * Sync EVERY local follow-up/callback lead into a server-side reminder
 * (upsert by lead id — rescheduling naturally replaces the old one). Run
 * after login and on refresh so reminders persist across browser restarts.
 */
export async function syncCallbackReminders(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const leads = await db.leads
      .filter((l) => isReminderStatus(l.status) && !!l.followupDate)
      .toArray();
    const customers = await db.customers.toArray();
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const activeLeadIds = new Set(leads.map((l) => l.id!));

    for (const lead of leads) {
      const remindAt = followupToUtc(lead.followupDate || '', lead.followupTime || '');
      if (!remindAt) continue;
      const customer = custMap.get(lead.customerId);
      try {
        await api.pushReminderUpsert({
          leadId: lead.id!,
          customerId: lead.customerId,
          customerName: customer?.name || 'Customer',
          product: lead.product,
          followupDate: lead.followupDate,
          followupTime: lead.followupTime,
          remindAt,
        });
      } catch { /* offline — next sync retries */ }
    }

    // Reconcile: cancel any server reminder whose lead is no longer in the
    // reminder family locally (closed/deleted elsewhere) — prevents stale
    // notifications after cross-device changes.
    try {
      const { reminders } = await api.pushReminderList();
      for (const r of reminders || []) {
        if (!activeLeadIds.has(r.leadId)) {
          try { await api.pushReminderCancel(r.leadId); } catch { /* offline */ }
        }
      }
    } catch { /* offline — next sync retries */ }
  } catch (err) {
    console.error('[push] sync reminders failed:', err);
  }
}

/** Schedule (or reschedule) the server reminder for ONE lead. */
export async function scheduleLeadReminder(lead: any): Promise<void> {
  if (!pushSupported()) return;
  if (!isReminderStatus(lead.status) || !lead.followupDate) return;
  const remindAt = followupToUtc(lead.followupDate, lead.followupTime || '');
  if (!remindAt) return;
  let customerName = 'Customer';
  try {
    const c = await db.customers.get(lead.customerId);
    if (c?.name) customerName = c.name;
  } catch { /* noop */ }
  try {
    await api.pushReminderUpsert({
      leadId: lead.id!,
      customerId: lead.customerId,
      customerName,
      product: lead.product,
      followupDate: lead.followupDate,
      followupTime: lead.followupTime,
      remindAt,
    });
  } catch { /* offline — syncCallbackReminders will pick it up later */ }
}

/** Cancel the server reminder for ONE lead (callback done / closed). */
export async function cancelLeadReminder(leadId: number): Promise<void> {
  if (!pushSupported() || !leadId) return;
  try {
    await api.pushReminderCancel(leadId);
  } catch { /* offline — server will skip; next status change re-cancels */ }
}
