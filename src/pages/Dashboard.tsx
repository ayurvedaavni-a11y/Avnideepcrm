import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import IndianRupee from 'lucide-react/dist/esm/icons/indian-rupee'
import Users from 'lucide-react/dist/esm/icons/users'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import Clock from 'lucide-react/dist/esm/icons/clock'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Box from 'lucide-react/dist/esm/icons/box'
import Send from 'lucide-react/dist/esm/icons/send'
import Truck from 'lucide-react/dist/esm/icons/truck'
import Check from 'lucide-react/dist/esm/icons/check'
import Ban from 'lucide-react/dist/esm/icons/ban'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import { isPipelineActive, isRevenueEligible, isFakeStatus, isRTOStatus } from '../db/lifecycle';
import { safeMoney, safeFilter } from '../lib/safe';
import { useDateFilter } from '../context/DateFilterContext';
import { useAuth } from '../context/AuthContext';
import { CANCELLED_OUTCOMES, FOLLOWUP_STATUSES, isConverted, isCancelledOutcome } from '../db/telecallerStats';
import { getBadgeClasses } from '../db/lifecycle';

function StatCard({ title, value, icon: Icon, colorClass, subtitle }: any) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className={`p-4 rounded-lg ${colorClass}`}><Icon size={24} /></div>
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function fmtResponse(h: number): string {
  if (!h) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h} h`;
}

export function Dashboard() {
  const { profile, isAdmin } = useAuth();
  const allLeads = useLiveQuery(() => db.leads.toArray()) || [];
  const allOrders = useLiveQuery(() => db.orders.toArray()) || [];
  const allNDRs = useLiveQuery(() => db.ndrCases.filter(n => n.status !== 'Resolved').toArray(), []) || [];
  const allCallLogs = useLiveQuery(() => db.callLogs.toArray(), []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray()) || [];

  const { filterByDate } = useDateFilter();

  // Apply global date filter to all datasets
  const leads = useMemo(() => filterByDate(allLeads, 'createdAt'), [allLeads, filterByDate]);
  const orders = useMemo(() => filterByDate(allOrders, 'orderDate'), [allOrders, filterByDate]);
  const todayNDRs = useMemo(() => filterByDate(allNDRs, 'createdAt'), [allNDRs, filterByDate]);

  const todayStr = new Date().toDateString();
  const todayISO = new Date().toISOString().split('T')[0];

  const customerMap = useMemo(() => {
    const map = new Map<number, any>();
    allCustomers.forEach(c => { if (c.id) map.set(c.id, c); });
    return map;
  }, [allCustomers]);

  // ===================================================================
  // TELECALLER VIEW DATA (non-admin)
  // ===================================================================
  const myLeads = useMemo(() => {
    if (isAdmin || !profile?.id) return [];
    return allLeads.filter(l => String(l.assignedTo || '') === String(profile.id) || String(l.assignedAgent || '') === String(profile.full_name));
  }, [allLeads, isAdmin, profile]);

  const myCalls = useMemo(() => {
    if (isAdmin || !profile?.id) return [];
    return allCallLogs.filter(c => c.telecallerId === profile.id);
  }, [allCallLogs, isAdmin, profile]);

  const tcData = useMemo(() => {
    const todayCalls = myCalls.filter(c => new Date(c.createdAt).toDateString() === todayStr).length;
    const confirmed = myLeads.filter(l => isConverted(l.status)).length;
    const cancelled = myLeads.filter(l => isCancelledOutcome(l.status)).length;
    const pending = myLeads.filter(l => FOLLOWUP_STATUSES.includes(l.status) && (!l.followupDate || l.followupDate <= todayISO)).length;
    const conversionPct = myLeads.length ? Math.round((confirmed / myLeads.length) * 1000) / 10 : 0;
    const statusToday: Record<string, number> = {};
    for (const c of myCalls) {
      if (new Date(c.createdAt).toDateString() !== todayStr) continue;
      statusToday[c.status] = (statusToday[c.status] || 0) + 1;
    }
    let respTotal = 0, respCount = 0;
    for (const l of myLeads) {
      if (l.assignedAt && l.firstCallAt) {
        const d = new Date(l.firstCallAt).getTime() - new Date(l.assignedAt).getTime();
        if (d > 0) { respTotal += d / 3600000; respCount++; }
      }
    }
    return {
      assigned: myLeads.length,
      todayCalls,
      confirmed,
      cancelled,
      pending,
      conversionPct,
      statusToday,
      avgResponse: respCount ? Math.round((respTotal / respCount) * 10) / 10 : 0,
    };
  }, [myCalls, myLeads, todayISO, todayStr]);

  // ===================================================================
  // ADMIN TELECALLER OVERVIEW DATA
  // ===================================================================
  const adminTc = useMemo(() => {
    // TASK 4: Assigned = assigned_to IS NOT NULL (local assignedTo). Deleted /
    // inactive telecaller leads are never counted — the worker auto-unassigns
    // on delete/disable and the startup repair guarantees no orphan refs.
    const unassigned = allLeads.filter(l => l.status === 'New Lead' && !l.assignedTo).length;
    const assignedCount = allLeads.filter(l => !!l.assignedTo).length;
    const todayCalls = allCallLogs.filter(c => new Date(c.createdAt).toDateString() === todayStr).length;
    const todayConfirmed = allCallLogs.filter(c => new Date(c.createdAt).toDateString() === todayStr && (c.status === 'Order Confirmed' || c.status === 'Order Booked')).length;
    const todayCancelled = allCallLogs.filter(c => new Date(c.createdAt).toDateString() === todayStr && CANCELLED_OUTCOMES.includes(c.status)).length;
    const followupsDue = allLeads.filter(l => FOLLOWUP_STATUSES.includes(l.status) && (!l.followupDate || l.followupDate <= todayISO)).length;
    const assignedPool = allLeads.filter(l => !!l.assignedTo);
    const convertedTotal = assignedPool.filter(l => isConverted(l.status)).length;
    const conversionRate = assignedPool.length ? Math.round((convertedTotal / assignedPool.length) * 1000) / 10 : 0;
    const byTc = new Map<string, { name: string; confirmed: number; calls: number }>();
    for (const c of allCallLogs) {
      const k = c.telecallerId || c.telecallerName;
      if (!k) continue;
      const e = byTc.get(k) || { name: c.telecallerName, confirmed: 0, calls: 0 };
      e.calls++;
      if (c.status === 'Order Confirmed' || c.status === 'Order Booked') e.confirmed++;
      byTc.set(k, e);
    }
    const topTelecallers = Array.from(byTc.values())
      .sort((a, b) => b.confirmed - a.confirmed || b.calls - a.calls)
      .slice(0, 5);
    return { unassigned, assignedCount, todayCalls, todayConfirmed, todayCancelled, followupsDue, conversionRate, topTelecallers };
  }, [allLeads, allCallLogs, todayISO, todayStr]);

  // OPTIMIZATION: All dashboard computations in a single useMemo to reduce recompute overhead
  const dashboardData = useMemo(() => {
    const activeLeads = safeFilter(leads, l => isPipelineActive(l.status));
    const fakeLeads = safeFilter(leads, l => isFakeStatus(l.status));

    const todayLeads = safeFilter(activeLeads, l => {
      try { return new Date(l.createdAt).toDateString() === todayStr; } catch { return false; }
    }).length;

    const ordersBooked = safeFilter(orders, o => o.status === 'Order Booked').length;
    const packingPending = safeFilter(orders, o => o.status === 'Packing').length;
    const packedOrders = safeFilter(orders, o => o.status === 'Packed').length;
    const readyToShip = safeFilter(orders, o => o.status === 'Ready To Ship').length;
    const shippedOrders = safeFilter(orders, o => o.status === 'Shipped').length;
    const inTransit = safeFilter(orders, o => o.status === 'In Transit').length;
    const outForDelivery = safeFilter(orders, o => o.status === 'Out For Delivery').length;
    const deliveredOrders = safeFilter(orders, o => o.status === 'Delivered').length;
    const rtoOrders = safeFilter(orders, o => isRTOStatus(o.status)).length;
    const cancelledOrders = safeFilter(orders, o => o.status === 'Cancelled').length;

    const todayDelivered = safeFilter(orders, o => {
      if (o.status !== 'Delivered') return false;
      try { return new Date(o.updatedAt).toDateString() === todayStr; } catch { return false; }
    }).length;

    const todayRTO = safeFilter(orders, o => {
      if (o.status !== 'RTO') return false;
      try { return new Date(o.updatedAt).toDateString() === todayStr; } catch { return false; }
    }).length;

    const revenue = orders.reduce((sum, o) => isRevenueEligible(o.status) ? sum + safeMoney(o.codAmount) : sum, 0);
    const fakeCustomers = fakeLeads.length;
    const interestedLeads = safeFilter(activeLeads, l => l.status === 'Interested').length;

    const pipelineAlerts: { icon: any; color: string; text: string }[] = [];
    if (packingPending > 0) pipelineAlerts.push({ icon: Box, color: 'text-orange-500', text: `${packingPending} Orders Waiting for Packing` });
    if (readyToShip > 0) pipelineAlerts.push({ icon: Send, color: 'text-blue-500', text: `${readyToShip} Orders Ready To Ship` });
    if (todayNDRs.length > 0) pipelineAlerts.push({ icon: AlertTriangle, color: 'text-red-500', text: `${todayNDRs.length} Active NDR Cases` });
    if (todayDelivered > 0) pipelineAlerts.push({ icon: Check, color: 'text-emerald-500', text: `${todayDelivered} Delivered Today 🎉` });
    if (adminTc.followupsDue > 0) pipelineAlerts.push({ icon: CalendarDays, color: 'text-amber-500', text: `${adminTc.followupsDue} Follow-ups Due` });
    if (adminTc.unassigned > 0) pipelineAlerts.push({ icon: Users, color: 'text-blue-500', text: `${adminTc.unassigned} New Leads Unassigned` });

    return {
      todayLeads,
      ordersBooked,
      packingPending,
      packedOrders,
      readyToShip,
      shippedOrders,
      inTransit,
      outForDelivery,
      deliveredOrders,
      rtoOrders,
      cancelledOrders,
      todayDelivered,
      todayRTO,
      revenue,
      fakeCustomers,
      interestedLeads,
      pipelineAlerts,
    };
  }, [leads, orders, todayNDRs, adminTc.followupsDue, adminTc.unassigned]);
  const {
    todayLeads, ordersBooked, packingPending, readyToShip, shippedOrders,
    inTransit, outForDelivery, deliveredOrders, rtoOrders, cancelledOrders,
    todayDelivered, todayRTO, revenue, fakeCustomers, interestedLeads,
    pipelineAlerts,
  } = dashboardData;

  // ============ TELECALLER VIEW ============
  if (!isAdmin) {
    const statusChips = Object.entries(tcData.statusToday).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <h1 className="text-2xl font-bold text-slate-900">Namaste, {profile?.full_name || 'Telecaller'} 👋</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="My Assigned Leads" value={tcData.assigned} icon={Users} colorClass="bg-blue-100 text-blue-600" />
          <StatCard title="Today's Calls" value={tcData.todayCalls} icon={PhoneCall} colorClass="bg-indigo-100 text-indigo-600" />
          <StatCard title="Confirmed Orders" value={tcData.confirmed} icon={Check} colorClass="bg-emerald-100 text-emerald-600" />
          <StatCard title="Conversion" value={`${tcData.conversionPct}%`} icon={TrendingUp} colorClass="bg-purple-100 text-purple-600" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Pending Follow-ups" value={tcData.pending} icon={Clock} colorClass="bg-amber-100 text-amber-600" subtitle="due / overdue" />
          <StatCard title="Avg Response Time" value={fmtResponse(tcData.avgResponse)} icon={TrendingUp} colorClass="bg-cyan-100 text-cyan-600" />
          <StatCard title="Cancelled / Closed" value={tcData.cancelled} icon={Ban} colorClass="bg-slate-100 text-slate-600" />
          <StatCard title="Total Calls Logged" value={myCalls.length} icon={PhoneCall} colorClass="bg-emerald-100 text-emerald-600" />
        </div>

        {/* Today's performance by status */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <PhoneCall size={18} className="text-blue-600" /> Today's Performance by Status
          </h3>
          {statusChips.length === 0 ? (
            <p className="text-sm text-slate-400">Aaj abhi tak koi call log nahi hua.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {statusChips.map(([st, cnt]) => (
                <span key={st} className={`px-3 py-1.5 rounded-full text-xs font-bold ${getBadgeClasses(st)}`}>
                  {st}: {cnt}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* My leads */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-800">My Assigned Leads</h3>
            <span className="text-sm text-slate-400">{myLeads.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next Contact</th>
                  <th className="px-4 py-3">Last Note</th>
                </tr>
              </thead>
              <tbody>
                {myLeads.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Abhi aapko koi lead assign nahi hui hai.</td></tr>
                )}
                {myLeads.slice(0, 10).map(l => (
                  <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-800">{customerMap.get(l.customerId)?.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{customerMap.get(l.customerId)?.mobile || ''}</td>
                    <td className="px-4 py-3 text-slate-700">{l.product}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${getBadgeClasses(l.status)}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {l.followupDate ? `${l.followupDate}${l.followupTime ? ' ' + l.followupTime : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate">
                      {l.notes ? l.notes.split('\n').pop() : '—'}
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

  // ============ ADMIN VIEW ============
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

      {/* Pipeline Alerts */}
      {pipelineAlerts.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {pipelineAlerts.map((alert, i) => (
            <div key={i} className={`flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl border border-slate-200 shadow-sm ${alert.color}`}>
              <alert.icon size={18} />
              <span className="font-semibold text-sm text-slate-700">{alert.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Telecaller Overview */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
          <PhoneCall size={18} className="text-blue-600" /> Telecaller Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="New Leads (Unassigned)" value={adminTc.unassigned} icon={Users} colorClass="bg-blue-100 text-blue-600" />
          <StatCard title="Assigned Leads" value={adminTc.assignedCount} icon={PhoneCall} colorClass="bg-indigo-100 text-indigo-600" />
          <StatCard title="Today's Calls" value={adminTc.todayCalls} icon={PhoneCall} colorClass="bg-purple-100 text-purple-600" />
          <StatCard title="Follow-ups Due" value={adminTc.followupsDue} icon={CalendarDays} colorClass="bg-amber-100 text-amber-600" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <StatCard title="Today's Confirmed" value={adminTc.todayConfirmed} icon={Check} colorClass="bg-emerald-100 text-emerald-600" />
          <StatCard title="Today's Cancelled" value={adminTc.todayCancelled} icon={Ban} colorClass="bg-red-100 text-red-600" />
          <StatCard title="Team Conversion Rate" value={`${adminTc.conversionRate}%`} icon={TrendingUp} colorClass="bg-cyan-100 text-cyan-600" />
          <StatCard title="Total Calls Logged" value={allCallLogs.length} icon={PhoneCall} colorClass="bg-slate-100 text-slate-600" />
        </div>
      </div>

      {/* Top Telecallers */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-blue-600" /> Top Telecallers (by confirmed orders)
        </h3>
        {adminTc.topTelecallers.length === 0 ? (
          <p className="text-sm text-slate-400">Abhi koi call log nahi hai.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {adminTc.topTelecallers.map((t, i) => (
              <div key={i} className="border border-slate-100 rounded-xl p-4 bg-slate-50 text-center hover:shadow-md transition">
                <div className="text-2xl">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📞'}</div>
                <p className="font-bold text-slate-800 text-sm mt-1">{t.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t.confirmed} confirmed · {t.calls} calls</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pipeline Stats - Top Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Orders Booked" value={ordersBooked} icon={ShoppingCart} colorClass="bg-amber-100 text-amber-600" />
        <StatCard title="Packing Pending" value={packingPending} icon={Box} colorClass="bg-orange-100 text-orange-600" />
        <StatCard title="Ready To Ship" value={readyToShip} icon={Send} colorClass="bg-blue-100 text-blue-600" />
        <StatCard title="Shipped" value={shippedOrders + inTransit + outForDelivery} icon={Truck} colorClass="bg-indigo-100 text-indigo-600" subtitle={`${shippedOrders} shipped · ${inTransit} transit · ${outForDelivery} OFD`} />
      </div>

      {/* Pipeline Stats - Bottom Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Delivered Orders" value={deliveredOrders} icon={Check} colorClass="bg-emerald-100 text-emerald-600" subtitle={todayDelivered > 0 ? `${todayDelivered} today` : ''} />
        <StatCard title="RTO Orders" value={rtoOrders} icon={RotateCcw} colorClass="bg-red-100 text-red-600" subtitle={todayRTO > 0 ? `${todayRTO} today` : ''} />
        <StatCard title="Cancelled" value={cancelledOrders} icon={Ban} colorClass="bg-slate-100 text-slate-600" />
        <StatCard title="Revenue" value={`₹${revenue.toLocaleString()}`} icon={IndianRupee} colorClass="bg-emerald-100 text-emerald-600" />
      </div>

      {/* Lead Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Today Leads" value={todayLeads} icon={Users} colorClass="bg-blue-100 text-blue-600" />
        <StatCard title="Interested Leads" value={interestedLeads} icon={Clock} colorClass="bg-purple-100 text-purple-600" />
        <StatCard title="Fake Customers" value={fakeCustomers} icon={AlertTriangle} colorClass="bg-orange-100 text-orange-600" />
        <StatCard title="Active NDR" value={todayNDRs.length} icon={AlertTriangle} colorClass="bg-red-100 text-red-600" />
      </div>

    </div>
  );
}
