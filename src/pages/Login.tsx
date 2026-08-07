import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import Lock from 'lucide-react/dist/esm/icons/lock'
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import Users from 'lucide-react/dist/esm/icons/users'
import { cn } from '../lib/utils';
import { PwaInstallButton } from '../components/PwaInstallButton';

type LoginRole = 'admin' | 'telecaller';

interface Props {
  onContinueOffline: () => void;
}

export function Login({ onContinueOffline }: Props) {
  const { login } = useAuth();
  const [role, setRole] = useState<LoginRole | null>(null);
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !role) return;
    setError('');
    const digits = mobile.replace(/\D/g, '');
    if (digits.length < 10) { setError('Sahi mobile number daalein (10 digit).'); return; }
    if (pin.trim().length < 4) { setError('Sahi PIN daalein.'); return; }
    setBusy(true);
    try {
      const res = await login(digits, pin, role);
      if (!res.ok) setError(res.error || 'Login fail hua.');
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = role === 'admin';

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 relative overflow-hidden font-sans">
      {/* ambient glows + grid overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.08),transparent_60%)]" />
      </div>

      <div className="relative w-full max-w-3xl px-6 py-10">
        {/* Brand */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black tracking-wider text-white">
            AVNIDEEP<span className="text-blue-400">CRM</span>
            <span className="text-xs text-blue-500 font-bold block mt-1 tracking-[0.3em]">PRO EDITION</span>
          </h1>
          <p className="text-slate-400 text-sm mt-4">Online multi-user CRM — apna role chunein</p>
        </div>

        {role === null ? (
          /* ---- Step 1: Role selection ---- */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <button
              type="button"
              onClick={() => { setRole('admin'); setError(''); }}
              className="group relative text-left bg-gradient-to-br from-violet-600/15 to-indigo-600/10 border border-violet-500/30 hover:border-violet-400/70 rounded-2xl p-7 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-600/20"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex w-12 h-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-600/30 group-hover:scale-105 transition">
                  <ShieldCheck size={24} className="text-white" />
                </span>
                <ArrowRight size={18} className="text-violet-400 opacity-0 group-hover:opacity-100 transition" />
              </div>
              <h2 className="text-lg font-bold text-white">Admin Login</h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Full Access — Dashboard, Team Management, Settings, Reports, Inventory, Payments, Invoices
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-violet-300">
                <Lock size={12} /> Sirf admin accounts
              </div>
            </button>

            <button
              type="button"
              onClick={() => { setRole('telecaller'); setError(''); }}
              className="group relative text-left bg-gradient-to-br from-emerald-600/15 to-teal-600/10 border border-emerald-500/30 hover:border-emerald-400/70 rounded-2xl p-7 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-600/20"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex w-12 h-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-600/30 group-hover:scale-105 transition">
                  <Users size={24} className="text-white" />
                </span>
                <ArrowRight size={18} className="text-emerald-400 opacity-0 group-hover:opacity-100 transition" />
              </div>
              <h2 className="text-lg font-bold text-white">Telecaller Login</h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Leads, SpaceL Follow-ups & Orders — apna daily calling pipeline
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                <Lock size={12} /> Sirf telecaller accounts
              </div>
            </button>
          </div>
        ) : (
          /* ---- Step 2: Role-specific login form ---- */
          <div className="max-w-md mx-auto">
            <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl space-y-5">
              <button
                type="button"
                onClick={() => { setRole(null); setError(''); }}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                <ArrowLeft size={14} /> Role change karein
              </button>

              <div className="text-center">
                <div className={cn(
                  'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-3 border',
                  isAdmin
                    ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                )}>
                  {isAdmin ? <ShieldCheck size={12} /> : <Users size={12} />}
                  {isAdmin ? 'ADMIN LOGIN' : 'TELECALLER LOGIN'}
                </div>
                <p className="text-slate-400 text-xs">
                  Sirf {isAdmin ? 'admin' : 'telecaller'} accounts yahan login kar sakte hain
                </p>
              </div>

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
                  maxLength={8}
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
                className={cn(
                  'w-full text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg disabled:opacity-60 disabled:cursor-not-allowed',
                  isAdmin
                    ? 'bg-violet-600 hover:bg-violet-500 shadow-violet-600/25'
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25'
                )}
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {busy ? 'Logging in…' : isAdmin ? 'Admin Login' : 'Telecaller Login'}
              </button>

              <button
                type="button"
                onClick={onContinueOffline}
                className="w-full text-slate-400 hover:text-slate-200 text-sm flex items-center justify-center gap-1.5 transition"
              >
                <WifiOff size={14} /> Internet nahi hai? Offline mode mein chalein
              </button>

              <PwaInstallButton variant="dark" />
            </form>

            <p className="text-center text-[11px] text-slate-600 mt-6">
              Login ke baad role verify hota hai — galat role se access nahi milega. Data Cloudflare D1 cloud par securely sync hota hai
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
