import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import Lock from 'lucide-react/dist/esm/icons/lock'
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2'

interface Props {
  onContinueOffline: () => void;
}

export function Login({ onContinueOffline }: Props) {
  const { login } = useAuth();
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    const digits = mobile.replace(/\D/g, '');
    if (digits.length < 10) { setError('Sahi mobile number daalein (10 digit).'); return; }
    if (pin.trim().length < 4) { setError('4-6 digit PIN daalein.'); return; }
    setBusy(true);
    try {
      const res = await login(digits, pin);
      if (!res.ok) setError(res.error || 'Login fail hua.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 relative overflow-hidden font-sans">
      {/* ambient glows */}
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.08),transparent_60%)] pointer-events-none" />

      <div className="relative w-full max-w-md px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-wider text-white">
            AVNIDEEP<span className="text-blue-400">CRM</span>
            <span className="text-xs text-blue-500 font-bold block mt-1 tracking-[0.3em]">PRO EDITION</span>
          </h1>
          <p className="text-slate-400 text-sm mt-4">Online multi-user CRM — Telecaller login</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <PhoneCall size={14} /> Mobile Number
            </label>
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9876543210"
              maxLength={10}
              className="w-full bg-slate-900/70 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Lock size={14} /> PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
              maxLength={6}
              className="w-full bg-slate-900/70 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition text-center text-lg tracking-[0.5em]"
            />
          </div>
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-3 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-blue-600/25"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            {busy ? 'Logging in…' : 'Login'}
          </button>

          <button
            type="button"
            onClick={onContinueOffline}
            className="w-full text-slate-400 hover:text-slate-200 text-sm flex items-center justify-center gap-1.5 transition"
          >
            <WifiOff size={14} /> Internet nahi hai? Offline mode mein chalein
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          Telecaller accounts admin banata hai • Data Supabase cloud par securely sync hota hai
        </p>
      </div>
    </div>
  );
}
