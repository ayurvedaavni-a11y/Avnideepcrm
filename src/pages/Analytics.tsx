import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down'
import Activity from 'lucide-react/dist/esm/icons/activity'
import Users from 'lucide-react/dist/esm/icons/users'
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { useDateFilter } from '../context/DateFilterContext';
import { CourierAnalytics } from './CourierAnalytics';

function AnalyticsContent() {
  const allOrders = useLiveQuery(() => db.orders.toArray()) || [];
  const allLeads = useLiveQuery(() => db.leads.toArray()) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray()) || [];

  const { filterByDate } = useDateFilter();

  // Apply global date filter to all datasets
  const orders = useMemo(() => filterByDate(allOrders, 'orderDate'), [allOrders, filterByDate]);
  const leads = useMemo(() => filterByDate(allLeads, 'createdAt'), [allLeads, filterByDate]);
  const customers = useMemo(() => filterByDate(allCustomers, 'createdAt'), [allCustomers, filterByDate]);

  const totalOrders = orders.length;
  const delivered = orders.filter(o => o.status === 'Delivered').length;
  const rto = orders.filter(o => o.status === 'RTO').length;
  
  const deliveryPercent = totalOrders ? Math.round((delivered / totalOrders) * 100) : 0;
  const rtoPercent = totalOrders ? Math.round((rto / totalOrders) * 100) : 0;

  const totalLeads = leads.length;
  const convertedLeads = leads.filter(l => l.status === 'Order Booked' || l.status === 'Shipped' || l.status === 'Delivered').length;
  const leadConversion = totalLeads ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  const totalCustomers = customers.length;
  const fakeCustomers = customers.filter(c => c.riskLevel === 'Fake').length;
  const fakePercent = totalCustomers ? Math.round((fakeCustomers / totalCustomers) * 100) : 0;

  // Build dynamic 7-day Sales vs RTO chart from filtered database
  const data = Array.from({ length: 7 }).map((_, idx) => {
    const day = subDays(new Date(), 6 - idx);
    const dayStart = startOfDay(day).getTime();
    const dayEnd = endOfDay(day).getTime();

    const dailyOrders = orders.filter(o => {
      const orderTime = new Date(o.updatedAt || o.orderDate).getTime();
      return orderTime >= dayStart && orderTime <= dayEnd;
    });

    return {
      name: format(day, 'EEE'),
      sales: dailyOrders.filter(o => o.status === 'Delivered').reduce((sum, o) => sum + (o.codAmount || 0), 0),
      rto: dailyOrders.filter(o => o.status === 'RTO').reduce((sum, o) => sum + (o.codAmount || 0), 0)
    };
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics & Reports</h1>
        <p className="text-slate-500 text-sm">Live business metrics generated from your local database.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox title="Delivery Success" value={`${deliveryPercent}%`} subtitle={`${delivered} delivered`} isGood={true} icon={TrendingUp} />
        <StatBox title="RTO Rate" value={`${rtoPercent}%`} subtitle={`${rto} returns`} isGood={false} icon={TrendingDown} />
        <StatBox title="Lead Conversion" value={`${leadConversion}%`} subtitle={`${convertedLeads}/${totalLeads} leads`} isGood={true} icon={Activity} />
        <StatBox title="Fake Customer Rate" value={`${fakePercent}%`} subtitle={`${fakeCustomers} flagged`} isGood={false} icon={Users} />
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-[400px]">
        <h3 className="text-lg font-bold text-slate-800 mb-6">Sales vs RTO (Last 7 Days)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} />
            <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v}`} />
            <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px' }} />
            <Legend />
            <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} name="Delivered Revenue" />
            <Bar dataKey="rto" fill="#ef4444" radius={[4, 4, 0, 0]} name="RTO Loss" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatBox({ title, value, subtitle, isGood, icon: Icon }: any) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex justify-between flex-wrap gap-2 items-start mb-4">
        <div className="text-sm font-medium text-slate-500">{title}</div>
        <div className={`p-2 rounded-lg ${isGood ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="flex items-end gap-3">
        <h3 className="text-3xl font-bold text-slate-800">{value}</h3>
        <span className="text-xs font-bold text-slate-500 mb-1">{subtitle}</span>
      </div>
    </div>
  );
}

// =====================================================================
// Tabbed wrapper: Analytics + Courier Analytics (sidebar simplification).
// =====================================================================
export function Analytics() {
  const [view, setView] = useState<'overview' | 'courier'>('overview');
  const TABS = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'courier' as const, label: 'Courier' },
  ];
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition ${view === t.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === 'courier' ? <CourierAnalytics /> : <AnalyticsContent />}
    </div>
  );
}
