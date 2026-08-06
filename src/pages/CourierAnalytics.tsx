import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down'
import Truck from 'lucide-react/dist/esm/icons/truck'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'

export function CourierAnalytics() {
  const orders = useLiveQuery(() => db.orders.toArray()) || [];

  const metrics = useMemo(() => {
    const totals = { total: orders.length, delivered: 0, rto: 0, ndr: 0, transit: 0 };
    for (const o of orders) {
      if (o.status === 'Delivered') totals.delivered++;
      else if (o.status === 'RTO') totals.rto++;
      else if (o.status === 'Undelivered') totals.ndr++;
      else totals.transit++;
    }
    return totals;
  }, [orders]);

  const courierStats: any[] = useMemo(() => {
    const map = new Map<string, { total: number; del: number; rto: number }>();
    for (const o of orders) {
      const c = o.courier || 'Unknown';
      if (!map.has(c)) map.set(c, { total: 0, del: 0, rto: 0 });
      const s = map.get(c)!;
      s.total++;
      if (o.status === 'Delivered') s.del++;
      if (o.status === 'RTO') s.rto++;
    }
    return Array.from(map.entries()).map(([name, s]) => ({
      name, total: s.total, delivered: s.del, rto: s.rto,
      rate: s.total > 0 ? Math.round((s.del / s.total) * 100) : 0,
      rtoRate: s.total > 0 ? Math.round((s.rto / s.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [orders]);

  const pieData = [
    { name: 'Delivered', value: metrics.delivered, color: '#10b981' },
    { name: 'RTO', value: metrics.rto, color: '#ef4444' },
    { name: 'In Transit', value: metrics.transit, color: '#3b82f6' },
    { name: 'NDR/Undelivered', value: metrics.ndr, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const delRate = metrics.total > 0 ? Math.round((metrics.delivered / metrics.total) * 100) : 0;
  const rtoRate = metrics.total > 0 ? Math.round((metrics.rto / metrics.total) * 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Truck className="text-indigo-600" /> Courier & Shipment Analytics
        </h1>
        <p className="text-slate-500 text-sm">Performance metrics across all courier partners.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Total Shipments" value={metrics.total} icon={Truck} color="bg-blue-50 text-blue-600" />
        <MetricCard title="Delivered" value={`${metrics.delivered} (${delRate}%)`} icon={TrendingUp} color="bg-emerald-50 text-emerald-600" />
        <MetricCard title="RTO" value={`${metrics.rto} (${rtoRate}%)`} icon={TrendingDown} color="bg-red-50 text-red-600" />
        <MetricCard title="NDR Cases" value={metrics.ndr} icon={AlertTriangle} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Delivery vs RTO Split</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                  {pieData.map((e, i) => (<Cell key={i} fill={e.color} />))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Courier Performance</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={courierStats.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="delivered" fill="#10b981" radius={[4, 4, 0, 0]} name="Delivered" />
                <Bar dataKey="rto" fill="#ef4444" radius={[4, 4, 0, 0]} name="RTO" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-slate-800 text-sm">Courier-wise Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-3">Courier</th>
                <th className="p-3">Total</th>
                <th className="p-3">Delivered</th>
                <th className="p-3">Delivery %</th>
                <th className="p-3">RTO</th>
                <th className="p-3">RTO %</th>
              </tr>
            </thead>
            <tbody>
              {courierStats.map(c => (
                <tr key={c.name} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-800">{c.name}</td>
                  <td className="p-3 text-slate-700">{c.total}</td>
                  <td className="p-3 text-emerald-600 font-bold">{c.delivered}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.rate}%` }}></div>
                      </div>
                      <span className="font-bold text-slate-700">{c.rate}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-red-600 font-bold">{c.rto}</td>
                  <td className="p-3 text-slate-700">{c.rtoRate}%</td>
                </tr>
              ))}
              {courierStats.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">No courier data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, color }: any) {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div className="text-xs font-bold text-slate-500 uppercase">{title}</div>
        <div className={`p-2 rounded-lg ${color}`}><Icon size={16} /></div>
      </div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}
