import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import X from 'lucide-react/dist/esm/icons/x'
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off'

/**
 * PWA service-worker lifecycle:
 * - First load (after SW caches): shows "App is ready for offline use".
 * - New build available: shows "New update available" prompt → update instantly.
 * Works only in browsers; Electron (file://) silently skips SW registration.
 *
 * STALE-OPEN-TAB FIX: with `registerType: 'prompt'` the browser only checks
 * for a newer service worker on a page load / navigation — an already-open
 * tab would keep running the OLD JS bundle forever after a deploy. So we
 * actively poll `registration.update()` every 60s and on every tab
 * visibility/focus change. When a newer build is found, the SW installs and
 * the existing needRefresh prompt appears → user clicks Update → skipWaiting
 * + controlled reload. No manual refresh / new tab required.
 */
export function PwaUpdater() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered() {
      // console.log('[PWA] Service worker registered');
    },
    onRegisterError(err) {
      console.error('[PWA] Service worker registration failed:', err);
    },
  });

  // Force the browser to re-check for a new service worker so an open tab
  // detects a fresh deployment. `registration.update()` re-fetches the SW
  // script; if it changed, updatefound → new SW installs → needRefresh above.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const check = () => {
      try {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => { if (reg) return reg.update(); })
          .catch(() => { /* no SW / offline — next tick retries */ });
      } catch { /* ignore */ }
    };
    // Check soon after mount (catches deploys that happened while the tab was
    // closed and the app was restored from bfcache), then on a timer and on
    // every return-to-tab / refocus.
    const t = setTimeout(check, 5000);
    const interval = setInterval(check, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const onFocus = () => check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', check);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', check);
    };
  }, []);

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3 bg-slate-900 text-white pl-4 pr-2 py-3 rounded-2xl shadow-2xl border border-slate-700/60 max-w-sm">
        {needRefresh ? (
          <>
            <RefreshCw size={18} className="text-blue-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold">A new update is available</p>
              <p className="text-[11px] text-slate-400">Install the latest version.</p>
            </div>
            <button
              onClick={() => updateServiceWorker(true)}
              className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition"
            >
              Update
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
              title="Later"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <WifiOff size={18} className="text-emerald-400 shrink-0" />
            <p className="text-sm font-medium min-w-0">
              App offline use ke liye ready hai <span className="text-emerald-400">✓</span>
            </p>
            <button
              onClick={() => setOfflineReady(false)}
              className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
