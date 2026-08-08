// src/db/notificationEngine.ts — Auto-checks that surface admin alerts:
//  1. Follow-ups due / overdue
//  2. Leads pending assignment (unassigned for > 24h)
//  3. Inactive telecallers (no call logged for > 48h)
// Runs periodically from App.tsx. Deduped — won't spam the same alert twice.
import { db } from './db';
import { listTeamMembers } from './auth';
import { FOLLOWUP_STATUSES } from './telecallerStats';

export async function hasUnreadNotification(title: string): Promise<boolean> {
  const existing = await db.notifications
    .where('title')
    .equals(title)
    .filter(n => !n.isRead)
    .first();
  return !!existing;
}

export async function runNotificationChecks(): Promise<number> {
  let created = 0;
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const since = (hours: number) => new Date(now.getTime() - hours * 3600000).toISOString();

  try {
    // ---- 1) Follow-ups due / overdue ----
    const leads = await db.leads.toArray();
    for (const l of leads) {
      if (!FOLLOWUP_STATUSES.includes(l.status)) continue;
      if (!l.followupDate || l.followupDate > today) continue;
      const title = `Follow-up Due: #${l.id}`;
      if (await hasUnreadNotification(title)) continue;
      await db.notifications.add({
        title,
        message: `Lead #${l.id} (${l.assignedAgent || 'Unassigned'}) follow-up due on ${l.followupDate}.`,
        type: 'info',
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      created++;
    }

    // ---- 2) Leads pending assignment (> 24h old, still New Lead) ----
    const cutoff = since(24);
    let pendingCount = 0;
    for (const l of leads) {
      if (l.status !== 'New Lead') continue;
      if (l.assignedAgent || l.assignedTo) continue;
      if (l.createdAt && l.createdAt >= cutoff) continue;
      pendingCount++;
    }
    if (pendingCount > 0 && !(await hasUnreadNotification('Lead Pending Assignment'))) {
      await db.notifications.add({
        title: 'Lead Pending Assignment',
        message: `${pendingCount} new lead(s) 24+ hours old are still unassigned. Assign them to telecallers.`,
        type: 'alert',
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      created++;
    }

    // ---- 3) Inactive telecallers (no call in 48h) ----
    const members = await listTeamMembers();
    const activeMembers = members.filter(m => m.is_active);
    for (const m of activeMembers) {
      const lastLog = await db.callLogs
        .where('telecallerId')
        .equals(m.id)
        .reverse()
        .first();
      if (lastLog && lastLog.createdAt >= since(48)) continue;
      const title = `Inactive Telecaller: ${m.full_name}`;
      if (await hasUnreadNotification(title)) continue;
      await db.notifications.add({
        title,
        message: lastLog
          ? `${m.full_name} has not logged any call in 48+ hours.`
          : `${m.full_name} has not logged any call yet.`,
        type: 'alert',
        isRead: false,
        createdAt: new Date().toISOString(),
      });
      created++;
    }
  } catch (err) {
    console.error('[NotificationEngine] check failed:', err);
  }
  return created;
}
