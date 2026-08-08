import { useEffect, useRef, useState } from 'react';
import BellRing from 'lucide-react/dist/esm/icons/bell-ring'
import X from 'lucide-react/dist/esm/icons/x'
import { useAuth } from '../context/AuthContext';
import { pushSupported, ensurePushSubscription, unregisterPushSubscription, syncCallbackReminders } from '../db/pushClient';

/**
 * Web Push lifecycle manager (callback reminders):
 *  - On login / session restore: requests Notification permission (first time,
 *    user-gesture friendly) and subscribes THIS device to the user's account.
 *  - After subscribe: re-syncs every local follow-up/callback lead into a
 *    server-side reminder (survives refresh + app restart + sync).
 *  - On logout: unregisters the device so the next user's callbacks never
 *    land on this device, and this user's callbacks never land on a shared
 *    device.
 *  - Permission denied: shows a clear banner with how to enable it.
 */
export function PushNotificationManager() {
  const { profile, isAdmin } = useAuth();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const enabledRef = useRef(false);
  const didRun = useRef<number | null>(null);

  const syncAfterGrant = async (profile: any) => {
    try {
      const granted = await ensurePushSubscription(profile);
      enabledRef.current = granted;
      setPermissionDenied(!granted && Notification.permission === 'denied');
      if (granted) await syncCallbackReminders(profile);
      return granted;
    } catch (err) {
      console.error('[push] init failed:', err);
      return false;
    }
  };

  // On mount / login — subscribe + sync (only once per profile id).
  useEffect(() => {
    if (!profile?.id) return;
    const pid = Number(profile.id);
    if (didRun.current === pid) return;
    didRun.current = pid;

    let cancelled = false;
    (async () => {
      if (!pushSupported()) return;
      // PWA only — Electron (file://) skips SW/push entirely.
      const granted = await syncAfterGrant(profile);
      if (cancelled && granted) { /* tab closed mid-sync — ignore */ }
    })();

    // Re-check permission when the tab returns to foreground (user may have
    // enabled it in browser settings).
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !profile?.id) return;
      if (Notification.permission === 'granted' && !enabledRef.current) {
        void syncAfterGrant(profile);
      } else {
        setPermissionDenied(Notification.permission === 'denied');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // On logout — unregister this device.
  useEffect(() => {
    if (profile?.id) return; // logged in — nothing to do here
    if (didRun.current !== null) {
      didRun.current = null;
      enabledRef.current = false;
      unregisterPushSubscription();
    }
  }, [profile?.id]);

  // Permission denied — visible banner (dismissible for this session).
  if (!permissionDenied) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-3 md:right-6 z-[60] max-w-sm w-[calc(100vw-1.5rem)] md:w-96 bg-white rounded-2xl shadow-2xl border border-amber-200 overflow-hidden av-fade-in">
      <div className="flex items-start gap-3 p-4">
        <div className="p-2 rounded-full bg-amber-100 text-amber-600 shrink-0">
          <BellRing size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 text-sm">Callback reminders are off</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            {isAdmin ? 'You' : 'Your device'} won't get device notifications when a follow-up is due.
            Enable notifications in your browser/app settings, then refresh.
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={async () => {
                await syncAfterGrant(profile!);
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition"
            >
              Try again
            </button>
            <button
              onClick={() => setPermissionDenied(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
