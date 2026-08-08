// =====================================================================
// Web Push for callback reminders — real OS-level device notifications.
//
// Why server-side push (not a JS timer): a browser timer dies when the
// tab is closed or the PWA is backgrounded for long. Web Push is delivered
// by the OS/browser push service (FCM/APNs/Mozilla) even when the app is
// fully closed, so this is the only reliable production architecture.
//
// Scheduled trigger (cron, every minute) scans crm_callback_reminders for
// pending rows whose remind_at <= now, then pushes to EVERY subscription of
// the reminder's user. The status flips pending -> sent atomically before
// sending so a re-run can never double-fire the same reminder. Each device
// subscription gets exactly one notification (multi-device = one per device,
// no uncontrolled duplicates).
// =====================================================================
import webpush from 'web-push';

export interface PushEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requireAuth(user: Record<string, any> | null): Response | null {
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return null;
}

function configureVapid(env: PushEnv): boolean {
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || 'mailto:admin@avnideep.in';
  if (!pub || !priv || !pub.startsWith('B')) {
    console.warn('[push] VAPID keys not configured — push disabled');
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

/** POST /api/push/subscribe — register this device/browser for this user. */
export async function handlePushSubscribe(env: PushEnv, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as any;
  const endpoint = String(body?.endpoint || '');
  const p256dh = String(body?.keys?.p256dh || '');
  const auth = String(body?.keys?.auth || '');
  if (!endpoint || !p256dh || !auth) return json({ error: 'endpoint + keys.p256dh + keys.auth required' }, 400);
  const userId = String(user!.id);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO crm_push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_p256dh = excluded.keys_p256dh, keys_auth = excluded.keys_auth, updated_at = excluded.updated_at`
  ).bind(userId, endpoint, p256dh, auth, now, now).run();
  return json({ ok: true });
}

/** POST /api/push/unsubscribe — remove this device (logout / revoke). */
export async function handlePushUnsubscribe(env: PushEnv, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as any;
  const endpoint = String(body?.endpoint || '');
  if (!endpoint) return json({ error: 'endpoint required' }, 400);
  await env.DB.prepare('DELETE FROM crm_push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return json({ ok: true });
}

/**
 * POST /api/push/reminders — upsert a callback reminder for a lead.
 * One reminder per lead: re-scheduling overwrites the previous one (the old
 * pending reminder is cancelled), so a reschedule can never double-fire.
 */
export async function handleReminderUpsert(env: PushEnv, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as any;
  const leadId = Number(body?.leadId);
  if (!leadId) return json({ error: 'leadId required' }, 400);

  // Route the reminder to the lead's assigned telecaller — never to whoever
  // happens to be logged in on this device. Unassigned/admin-owned leads
  // (assigned_to is '' or '0') go to the current user (the admin).
  // NOTE: '0' is the app's unassigned marker — it is a truthy string, so it
  // must be excluded explicitly or reminders would route to a dead user '0'.
  const leadRow = await env.DB.prepare('SELECT assigned_to, status FROM crm_leads WHERE id = ?').bind(leadId).first() as any;
  let userId = String(user!.id);
  if (leadRow?.assigned_to && String(leadRow.assigned_to) !== '0') userId = String(leadRow.assigned_to);
  const leadStatus = String(leadRow?.status || '');

  const remindAt = String(body?.remindAt || '');
  if (!remindAt) return json({ error: 'remindAt (ISO) required' }, 400);
  const now = new Date().toISOString();

  // Cancel any previously scheduled reminder for this lead (reschedule rule).
  await env.DB.prepare(
    `UPDATE crm_callback_reminders SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND status = 'pending'`
  ).bind(now, leadId).run();

  await env.DB.prepare(
    `INSERT INTO crm_callback_reminders
       (lead_id, user_id, customer_id, customer_name, product, lead_status, followup_date, followup_time, remind_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    leadId, userId,
    Number(body?.customerId || 0),
    String(body?.customerName || ''),
    String(body?.product || ''),
    leadStatus,
    String(body?.followupDate || ''),
    String(body?.followupTime || ''),
    remindAt, now, now
  ).run();
  return json({ ok: true });
}

/** DELETE /api/push/reminders?leadId= — cancel a lead's reminder (callback done/closed).
 *  Ownership-scoped: only the reminder's user (the lead's assigned telecaller)
 *  or an admin may cancel it. */
export async function handleReminderCancel(env: PushEnv, _request: Request, user: Record<string, any> | null, url: URL): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const leadId = Number(url.searchParams.get('leadId'));
  if (!leadId) return json({ error: 'leadId required' }, 400);
  const reminder = await env.DB.prepare(
    'SELECT user_id FROM crm_callback_reminders WHERE lead_id = ?'
  ).bind(leadId).first() as any;
  if (!reminder) return json({ ok: true }); // nothing to cancel
  const isAdmin = user!.role === 'admin';
  if (!isAdmin && String(reminder.user_id) !== String(user!.id)) {
    return json({ error: 'Forbidden — not your reminder' }, 403);
  }
  await env.DB.prepare(
    `UPDATE crm_callback_reminders SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND status = 'pending'`
  ).bind(new Date().toISOString(), leadId).run();
  return json({ ok: true });
}

/** GET /api/push/reminders — list pending reminders for the current user (restore after refresh). */
export async function handleReminderList(env: PushEnv, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const res = await env.DB.prepare(
    `SELECT id, lead_id, customer_id, customer_name, product, lead_status, followup_date, followup_time, remind_at
     FROM crm_callback_reminders
     WHERE user_id = ? AND status = 'pending' AND remind_at > ?
     ORDER BY remind_at ASC`
  ).bind(String(user!.id), new Date().toISOString()).all();
  return json({ reminders: (res.results as any[]) || [] });
}

/**
 * Scheduled trigger (cron every minute) — the reliable "fires even when the
 * app is closed" delivery path.
 */
export async function sendDueReminders(env: PushEnv): Promise<void> {
  if (!configureVapid(env)) return;
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT * FROM crm_callback_reminders WHERE status = 'pending' AND remind_at <= ? ORDER BY remind_at ASC LIMIT 100`
  ).bind(now).all();
  const rows = (due.results as any[]) || [];

  const MAX_RETRIES = 5;
  for (const r of rows) {
    // Atomic claim: only ONE cron run may send this reminder (no duplicates
    // even if the previous run was still in flight when this one started).
    const claim = await env.DB.prepare(
      `UPDATE crm_callback_reminders SET status = 'sent', fired_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`
    ).bind(now, now, r.id).run();
    const claimed = Number((claim.meta as any)?.changes ?? 0) > 0;
    if (!claimed) continue;

    const subs = await env.DB.prepare(
      'SELECT endpoint, keys_p256dh, keys_auth FROM crm_push_subscriptions WHERE user_id = ?'
    ).bind(String(r.user_id)).all();
    const subscriptions = (subs.results as any[]) || [];
    if (!subscriptions.length) continue;

    const payload = JSON.stringify({
      title: 'Callback Reminder',
      body: `${r.customer_name || 'Customer'} • ${r.followup_time || ''}`.trim(),
      // Lead status is part of the requested notification data.
      leadStatus: r.lead_status || '',
      data: { leadId: Number(r.lead_id), customerId: Number(r.customer_id) },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      // No custom sound file shipped — browsers play their default OS sound.
    });

    let transientFailure = false;
    for (const s of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.keys_p256dh, auth: s.keys_auth } },
          payload,
          { TTL: 3600 }
        );
      } catch (err: any) {
        // 404/410 = subscription dead → drop it so we stop wasting cron runs.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          try {
            await env.DB.prepare('DELETE FROM crm_push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
          } catch { /* best effort */ }
        } else {
          // Transient (network / 500 / 429) — retry on a later cron tick.
          transientFailure = true;
        }
        console.error('[push] send failed', err?.statusCode || err?.message || err);
      }
    }

    // Retry transient failures (bounded) instead of losing the reminder.
    if (transientFailure && (r.retry_count || 0) < MAX_RETRIES) {
      await env.DB.prepare(
        `UPDATE crm_callback_reminders SET status = 'pending', retry_count = retry_count + 1, updated_at = ? WHERE id = ?`
      ).bind(now, r.id).run();
    } else if (transientFailure) {
      await env.DB.prepare(
        `UPDATE crm_callback_reminders SET status = 'failed', updated_at = ? WHERE id = ?`
      ).bind(now, r.id).run();
    }
  }
}
