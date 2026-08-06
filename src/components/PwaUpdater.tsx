import { useRegisterSW } from 'virtual:pwa-register/react';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import X from 'lucide-react/dist/esm/icons/x'
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off'

/**
 * PWA service-worker lifecycle:
 * - First load (after SW caches): shows "App offline use ke liye ready hai".
 * - New build available: shows "Naya update available" prompt → update instantly.
 * Works only in browsers; Electron (file://) silently skips SW registration.
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

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3 bg-slate-900 text-white pl-4 pr-2 py-3 rounded-2xl shadow-2xl border border-slate-700/60 max-w-sm">
        {needRefresh ? (
          <>
            <RefreshCw size={18} className="text-blue-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold">Naya update available hai</p>
              <p className="text-[11px] text-slate-400">Latest version install karein.</p>
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
              title="Baad mein"
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
