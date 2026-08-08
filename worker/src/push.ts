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
 * Compute the explicit recipient list for a reminder CREATED BY `creator`.
 * Server-side recipient rules (the single source of truth — the frontend
 * can never broadcast):
 *   Telecaller creator  -> creator telecaller + ALL active admins
 *   Admin creator       -> admin only
 */
async function computeRecipients(env: PushEnv, creator: Record<string, any>): Promise<string[]> {
  if (creator.role === 'admin') return [String(creator.id)];
  const admins = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
  ).all();
  const adminIds = ((admins.results as any[]) || []).map((a) => String(a.id));
  // Creator first, admins after — deduped, ordered (stable recipient list).
  return [...new Set([String(creator.id), ...adminIds])];
}

/**
 * POST /api/push/reminders — upsert a callback reminder for a lead.
 * One reminder per lead: re-scheduling overwrites the previous one (the old
 * pending reminder is cancelled), so a reschedule can never double-fire.
 *
 * RECIPIENT = CREATOR (current logged-in user), explicitly computed
 * server-side. The lead's assigned_to is NOT assumed to be the creator —
 * the recipient list is stored on the row so the cron delivers to exactly
 * the right users and nobody else.
 */
export async function handleReminderUpsert(env: PushEnv, request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as any;
  const leadId = Number(body?.leadId);
  if (!leadId) return json({ error: 'leadId required' }, 400);

  const leadRow = await env.DB.prepare('SELECT status FROM crm_leads WHERE id = ?').bind(leadId).first() as any;
  const leadStatus = String(leadRow?.status || '');

  const remindAt = String(body?.remindAt || '');
  if (!remindAt) return json({ error: 'remindAt (ISO) required' }, 400);
  const now = new Date().toISOString();

  // Creator = the user who scheduled this reminder (current logged-in user).
  const creator: Record<string, any> = { id: user!.id, role: user!.role, full_name: user!.full_name || 'User' };
  const recipients = await computeRecipients(env, creator);
  const recipientIds = recipients.join(',');

  // UPSERT (reschedule-safe): crm_callback_reminders has UNIQUE(lead_id), so a
  // cancel-then-INSERT would violate the constraint on the second schedule of
  // the same lead (the cancelled row still occupies the lead_id). ON CONFLICT
  // replaces the row in place — the old reminder is naturally superseded and
  // can never double-fire. This is the permanent reschedule fix.
  await env.DB.prepare(
    `INSERT INTO crm_callback_reminders
       (lead_id, user_id, customer_id, customer_name, product, lead_status, followup_date, followup_time, remind_at, status, created_by, created_by_role, created_by_name, recipient_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET
       user_id = excluded.user_id,
       customer_id = excluded.customer_id,
       customer_name = excluded.customer_name,
       product = excluded.product,
       lead_status = excluded.lead_status,
       followup_date = excluded.followup_date,
       followup_time = excluded.followup_time,
       remind_at = excluded.remind_at,
       status = 'pending',
       retry_count = 0,
       created_by = excluded.created_by,
       created_by_role = excluded.created_by_role,
       created_by_name = excluded.created_by_name,
       recipient_ids = excluded.recipient_ids,
       updated_at = excluded.updated_at`
  ).bind(
    leadId, String(creator.id),
    Number(body?.customerId || 0),
    String(body?.customerName || ''),
    String(body?.product || ''),
    leadStatus,
    String(body?.followupDate || ''),
    String(body?.followupTime || ''),
    remindAt,
    String(creator.id), String(creator.role), String(creator.full_name),
    recipientIds, now, now
  ).run();
  return json({ ok: true, recipients });
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

/** GET /api/push/reminders — list pending reminders where the current user is
 *  an explicit RECIPIENT (creator or admin on the row). Restore after refresh
 *  is scoped per-recipient so nobody ever sees another user's reminder. */
export async function handleReminderList(env: PushEnv, _request: Request, user: Record<string, any> | null): Promise<Response> {
  const denied = requireAuth(user);
  if (denied) return denied;
  const uid = String(user!.id);
  // recipient_ids is a comma-separated list — match with padded commas so
  // '12' never matches '112'. Also include legacy rows where recipient_ids
  // is empty but user_id was the creator (old data / direct API users).
  const res = await env.DB.prepare(
    `SELECT id, lead_id, customer_id, customer_name, product, lead_status, followup_date, followup_time, remind_at
     FROM crm_callback_reminders
     WHERE status = 'pending' AND remind_at > ?
       AND (user_id = ? OR instr(',' || recipient_ids || ',', ?) > 0)
     ORDER BY remind_at ASC`
  ).bind(new Date().toISOString(), uid, `,${uid},`).all();
  // Map snake_case -> camelCase so the frontend reconcile (reads r.leadId /
  // r.customerId) always matches — the apiClient types are camelCase.
  const reminders = ((res.results as any[]) || []).map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    product: r.product,
    leadStatus: r.lead_status,
    followupDate: r.followup_date,
    followupTime: r.followup_time,
    remindAt: r.remind_at,
  }));
  return json({ reminders });
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

    // ---- RECIPIENT ROUTING (creator-based, server-side) ----
    // recipient_ids = explicit comma-separated user ids computed at upsert
    // time (telecaller creator → creator + admins; admin → admin only).
    // Fall back to user_id for legacy rows that predate the migration.
    const splitIds = String(r.recipient_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    const recipients = splitIds.length ? splitIds : [String(r.user_id)];
    const creatorId = String(r.created_by || r.user_id);

    const subs = await env.DB.prepare(
      `SELECT endpoint, keys_p256dh, keys_auth, user_id FROM crm_push_subscriptions WHERE user_id IN (${recipients.map(() => '?').join(',')})`
    ).bind(...recipients).all();
    const subscriptions = (subs.results as any[]) || [];
    if (!subscriptions.length) continue;

    const creatorName = String(r.created_by_name || '');
    const customerName = String(r.customer_name || 'Customer');
    const timeLabel = String(r.followup_time || '');

    let transientFailure = false;
    for (const s of subscriptions) {
      // Admin/other-recipient body includes WHO scheduled it:
      //   "Deep scheduled a callback reminder for Ranjeet Kumar at 4:30 PM."
      // The creator's own notification keeps the compact reminder body.
      const isCreator = String(s.user_id) === creatorId;
      const body = isCreator
        ? `${customerName} • ${timeLabel}`.trim()
        : `${creatorName} scheduled a callback reminder for ${customerName} at ${timeLabel}.`.trim();
      const payload = JSON.stringify({
        title: 'Callback Reminder',
        body,
        // Lead status is part of the requested notification data.
        leadStatus: r.lead_status || '',
        data: { leadId: Number(r.lead_id), customerId: Number(r.customer_id) },
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        // No custom sound file shipped — browsers play their default OS sound.
      });
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
