// TelecallerPerformance — per-telecaller report: assigned, calls, confirmed,
// cancelled, conversion %, average response time, pending follow-ups.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { getAllTelecallerStats, type TelecallerStats } from '../db/telecallerStats';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import BellRing from 'lucide-react/dist/esm/icons/bell-ring'

export function TelecallerPerformance() {
  const [stats, setStats] = useState<TelecallerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const logs = useLiveQuery(() => db.callLogs.toArray(), []) || [];

  useEffect(() => {
    let mounted = true;
    getAllTelecallerStats()
      .then(s => { if (mounted) { setStats(s); setLoading(false); } })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [logs.length]);

  const totalAssigned = stats.reduce((s, x) => s + x.assigned, 0);
  const totalConfirmed = stats.reduce((s, x) => s + x.confirmed, 0);
  const totalCalls = stats.reduce((s, x) => s + x.calls, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Telecaller Performance</h1>
        <p className="text-slate-500 text-sm mt-1">Har telecaller ki complete performance report.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Assigned Leads</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalAssigned}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Total Calls</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalCalls}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Confirmed Orders</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{totalConfirmed}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Team Conversion</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {totalAssigned ? Math.round((totalConfirmed / totalAssigned) * 1000) / 10 : 0}%
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">Per-Telecaller Report</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3">Telecaller</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Calls Done</th>
                <th className="px-4 py-3">Confirmed</th>
                <th className="px-4 py-3">Cancelled</th>
                <th className="px-4 py-3">Conversion %</th>
                <th className="px-4 py-3">Avg Response</th>
                <th className="px-4 py-3">Pending Follow-ups</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!loading && stats.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Koi telecaller account nahi bana hai. Team page se banayein.
                </td></tr>
              )}
              {stats.map((s) => (
                <tr key={s.telecallerId} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                        {s.telecallerName.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="font-bold text-slate-800">{s.telecallerName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{s.assigned}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{s.calls}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{s.confirmed}</td>
                  <td className="px-4 py-3 font-bold text-red-500">{s.cancelled}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                      <TrendingUp size={12} /> {s.conversionPct}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {s.avgResponseHours ? (
                      s.avgResponseHours < 1 ? `${Math.max(1, Math.round(s.avgResponseHours * 60))} min` : `${s.avgResponseHours} h`
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${s.pendingFollowups > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      <BellRing size={12} /> {s.pendingFollowups}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
