// TelecallerPerformance — LIVE commission + business dashboard (single source
// of truth = /api/performance, computed via SQL from crm_orders in D1).
// Admin sees the whole team; a telecaller sees only their own numbers.
// Commission = Delivered Amount × commission_rate (Delivered orders only).
import { useEffect, useState } from 'react';
import { api } from '../db/apiClient';
import { useAuth } from '../context/AuthContext';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import Wallet from 'lucide-react/dist/esm/icons/wallet'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import Package from 'lucide-react/dist/esm/icons/package'
import Timer from 'lucide-react/dist/esm/icons/timer'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import Users from 'lucide-react/dist/esm/icons/users'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'

interface PerfMember {
  telecallerId: string;
  telecallerName: string;
  mobile?: string;
  assigned: number;
  calls: number;
  totalCallSeconds: number;
  converted: number;
  conversionPct: number;
  totalOrders: number;
  deliveredAmount: number;
  pendingAmount: number;
  rtoAmount: number;
  cancelledAmount: number;
  dailyAmount: number;
  weeklyAmount: number;
  monthlyAmount: number;
  commission: number;
  commissionRate: number;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

function fmtDuration(sec: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatCard({ label, value, icon: Icon, iconClass, sub }: {
  label: string; value: string; icon: any; iconClass: string; sub?: string;
}) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 hover:shadow-md transition-all duration-200">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
        <Icon size={19} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">{label}</p>
        <p className="text-lg font-bold text-slate-900 leading-tight truncate">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
      </div>
    </div>
  );
}

export function TelecallerPerformance() {
  const { profile, isAdmin } = useAuth();
  const [members, setMembers] = useState<PerfMember[]>([]);
  const [rate, setRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getPerformance();
      setMembers(r.members || []);
      setRate(r.rate || 0);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load performance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Telecaller self-view: show only own row (API already scopes to own data).
  const rows = isAdmin ? members : members.filter(m => m.telecallerId === profile?.id);

  // Team totals (admin)
  const team = rows.reduce((acc, m) => ({
    assigned: acc.assigned + m.assigned,
    calls: acc.calls + m.calls,
    converted: acc.converted + m.converted,
    delivered: acc.delivered + m.deliveredAmount,
    pending: acc.pending + m.pendingAmount,
    rto: acc.rto + m.rtoAmount,
    cancelled: acc.cancelled + m.cancelledAmount,
    daily: acc.daily + m.dailyAmount,
    weekly: acc.weekly + m.weeklyAmount,
    monthly: acc.monthly + m.monthlyAmount,
    commission: acc.commission + m.commission,
  }), { assigned: 0, calls: 0, converted: 0, delivered: 0, pending: 0, rto: 0, cancelled: 0, daily: 0, weekly: 0, monthly: 0, commission: 0 });

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="text-blue-600" size={26} /> {isAdmin ? 'Telecaller Performance & Commission' : 'My Performance & Commission'}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Commission is only on <span className="font-bold text-emerald-600">Delivered Orders</span> · Current rate: <span className="font-bold">{rate}%</span>
          </p>
        </div>
        <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm">
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">
          {error} {!isAdmin && '— Ask the admin to set the commission rate.'}
        </div>
      )}

      {/* ===== Business summary cards ===== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <StatCard label="Today's Business" value={inr(team.daily)} icon={CalendarDays} iconClass="bg-amber-50 text-amber-600" sub="Delivered today" />
        <StatCard label="Weekly Business" value={inr(team.weekly)} icon={TrendingUp} iconClass="bg-blue-50 text-blue-600" sub="Delivered this week" />
        <StatCard label="Monthly Business" value={inr(team.monthly)} icon={Wallet} iconClass="bg-indigo-50 text-indigo-600" sub="Delivered this month" />
        <StatCard label="Delivered Amount" value={inr(team.delivered)} icon={CheckCircle} iconClass="bg-emerald-50 text-emerald-600" sub="All time" />
        <StatCard label="Pending Amount" value={inr(team.pending)} icon={Timer} iconClass="bg-orange-50 text-orange-600" sub="Pipeline orders" />
        <StatCard label="Commission" value={inr(team.commission)} icon={Wallet} iconClass="bg-purple-50 text-purple-600" sub={`@ ${rate}% of delivered`} />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-9 gap-2.5">
        <StatCard label="RTO Amount" value={inr(team.rto)} icon={Package} iconClass="bg-rose-50 text-rose-600" />
        <StatCard label="Cancelled" value={inr(team.cancelled)} icon={XCircle} iconClass="bg-slate-100 text-slate-600" />
        <StatCard label="Assigned Leads" value={String(team.assigned)} icon={Users} iconClass="bg-blue-50 text-blue-600" />
        <StatCard label="Calls Made" value={String(team.calls)} icon={PhoneCall} iconClass="bg-green-50 text-green-600" />
        <StatCard label="Orders Booked" value={String(team.converted)} icon={ShoppingCart} iconClass="bg-slate-100 text-slate-700" />
        <StatCard label="Conversion" value={team.assigned ? Math.round((team.converted / team.assigned) * 1000) / 10 + '%' : '0%'} icon={TrendingUp} iconClass="bg-indigo-50 text-indigo-600" />
      </div>

      {/* ===== Per-telecaller table (admin) / own row (telecaller) ===== */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <Users className="text-blue-600" size={18} />
          <h2 className="font-bold text-slate-800">{isAdmin ? 'Per-Telecaller Report' : 'My Report'}</h2>
          {rows.length > 0 && <span className="ml-auto text-xs text-slate-400">{rows.length} telecaller{rows.length !== 1 ? 's' : ''}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3">Telecaller</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Calls</th>
                <th className="px-4 py-3">Talk Time</th>
                <th className="px-4 py-3">Converted</th>
                <th className="px-4 py-3">Conv %</th>
                <th className="px-4 py-3">Delivered ₹</th>
                <th className="px-4 py-3">Pending ₹</th>
                <th className="px-4 py-3">RTO ₹</th>
                <th className="px-4 py-3">Cancel ₹</th>
                <th className="px-4 py-3">Today ₹</th>
                <th className="px-4 py-3">Week ₹</th>
                <th className="px-4 py-3">Month ₹</th>
                <th className="px-4 py-3 text-right">Commission ₹</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-400">
                  {isAdmin ? 'No telecaller account has been created yet.' : 'No data yet.'}
                </td></tr>
              )}
              {rows.map((m) => (
                <tr key={m.telecallerId} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                        {m.telecallerName.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800 truncate">{m.telecallerName}</p>
                        {m.mobile && <p className="text-[10px] text-slate-400">{m.mobile}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{m.assigned}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{m.calls}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDuration(m.totalCallSeconds)}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{m.converted}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                      <TrendingUp size={11} /> {m.conversionPct}%
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{inr(m.deliveredAmount)}</td>
                  <td className="px-4 py-3 text-orange-600 font-semibold">{inr(m.pendingAmount)}</td>
                  <td className="px-4 py-3 text-rose-600 font-semibold">{inr(m.rtoAmount)}</td>
                  <td className="px-4 py-3 text-slate-500 font-semibold">{inr(m.cancelledAmount)}</td>
                  <td className="px-4 py-3 text-amber-600">{inr(m.dailyAmount)}</td>
                  <td className="px-4 py-3 text-blue-600">{inr(m.weeklyAmount)}</td>
                  <td className="px-4 py-3 text-indigo-600">{inr(m.monthlyAmount)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm font-black bg-purple-100 text-purple-700">
                      <Wallet size={13} /> {inr(m.commission)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        ⓘ These numbers are calculated from the live D1 database — Orders, Logistics, Dashboard and Commission can never mismatch.
        Commission formula: Delivered Amount × {rate}% (sirf Delivered orders, RTO/Cancelled/Pending exclude).
      </p>
    </div>
  );
}
