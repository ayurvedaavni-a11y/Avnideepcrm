import { useEffect, useState } from 'react';
import Download from 'lucide-react/dist/esm/icons/download'
import Smartphone from 'lucide-react/dist/esm/icons/smartphone'
import X from 'lucide-react/dist/esm/icons/x'
import Monitor from 'lucide-react/dist/esm/icons/monitor'
import { cn } from '../lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);

/**
 * "Download App" button — PWA install entry point.
 * - Chrome/Edge/Android: captures beforeinstallprompt → shows native install dialog.
 * - Unsupported browsers (iOS Safari, Firefox…) or already-asked: opens instructions modal.
 * - Hidden entirely when the app is already running as an installed PWA.
 */
export function PwaInstallButton({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) { setInstalled(true); return; }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
    } else {
      setShowHelp(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={cn(
          'inline-flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-bold transition',
          variant === 'light'
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            : 'text-slate-300 hover:text-white border border-white/10 hover:border-blue-500/50 hover:bg-white/5'
        )}
      >
        <Download size={14} />
        {deferredPrompt ? 'Download App' : 'Install App'}
      </button>

      {showHelp && (
        <div
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-800 font-bold">
                <Smartphone size={18} className="text-blue-600" />
                Install AVNIDEEP CRM App
              </div>
              <button onClick={() => setShowHelp(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm text-slate-600">
              {isAndroid() && (
                <div className="flex gap-3">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black">1</span>
                  <p>In Chrome, click the <b>install icon</b> on the <b>right side</b> of the address bar (or the ⋮ menu → <b>Install app</b>).</p>
                </div>
              )}
              {isIOS() && (
                <div className="flex gap-3">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black">1</span>
                  <p>In Safari, tap the <b>Share</b> (⬆️) button → <b>Add to Home Screen</b> → Add.</p>
                </div>
              )}
              {!isAndroid() && !isIOS() && (
                <div className="flex gap-3">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black">1</span>
                  <p>In <b>Chrome / Edge</b>, click the install (⬇️) icon on the right side of the address bar → <b>Install</b>.</p>
                </div>
              )}
              <div className="flex gap-3">
                <span className="w-8 h-8 shrink-0 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-black">2</span>
                <p>Once installed, the app will open like a <b>native app</b> from your desktop / home screen — fullscreen, with offline support.</p>
              </div>
              <div className="flex gap-3">
                <span className="w-8 h-8 shrink-0 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center font-black">3</span>
                <p className="flex items-center gap-1.5"><Monitor size={14} /> Desktop par bhi browser menu se <b>Install app</b> option use karein.</p>
              </div>
              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-50">
                Firefox does not support PWA install — please use Chrome/Edge.
              </p>
            </div>

            <div className="px-5 pb-5">
              <button
                onClick={() => setShowHelp(false)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
