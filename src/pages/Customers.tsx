// AVNIDEEP CRM PRO — Master Customer Database
// Each customer appears ONCE — unique by mobile number.
// Full lifetime timeline, fraud detection, order summary, customer types.

import { useState, lazy, Suspense, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import Search from 'lucide-react/dist/esm/icons/search'
import Eye from 'lucide-react/dist/esm/icons/eye'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Users from 'lucide-react/dist/esm/icons/users'
import Star from 'lucide-react/dist/esm/icons/star'
import Repeat from 'lucide-react/dist/esm/icons/repeat'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Ban from 'lucide-react/dist/esm/icons/ban'
import Phone from 'lucide-react/dist/esm/icons/phone'
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import Clock from 'lucide-react/dist/esm/icons/clock'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import { safeFormat } from '../lib/safeFormat';
import { getBadgeClasses } from '../db/lifecycle';
import { useDateFilter } from '../context/DateFilterContext';
import { VirtualTable, type VirtualTableColumn } from '../components/VirtualTable';
import { ModalPortal } from '../components/ModalPortal';

const Customer360Profile = lazy(() => import('../components/Customer360Profile').then(m => ({ default: m.Customer360Profile })));

// ===== Pagination =====
const PAGE_SIZE = 50;

// ===== Filter definitions =====
interface FilterDef {
  key: string;
  label: string;
  icon: any;
  activeBg: string;
  check: (c: any) => boolean;
}

const FILTERS: FilterDef[] = [
  { key: 'all',         label: 'All Customers',     icon: Users,      activeBg: 'bg-slate-900', check: () => true },
  { key: 'repeat',      label: 'Repeat',            icon: Repeat,     activeBg: 'bg-blue-600', check: (c) => (c.totalOrders || 0) >= 2 },
  { key: 'vip',         label: 'VIP',               icon: Star,       activeBg: 'bg-amber-500', check: (c) => (c.totalSpend || 0) >= 50000 },
  { key: 'delivered',   label: 'High Delivery',     icon: CheckCircle,activeBg: 'bg-emerald-600', check: (c) => (c.totalOrders || 0) > 0 && ((c.delivered || 0) / (c.totalOrders || 1)) >= 0.7 },
  { key: 'fake',        label: 'Fake',              icon: ShieldAlert,activeBg: 'bg-red-600', check: (c) => c.riskLevel === 'Fake' || (c.fakeCount || 0) > 0 },
  { key: 'rto',         label: 'Has RTO',           icon: RotateCcw,  activeBg: 'bg-rose-700', check: (c) => (c.rto || 0) > 0 },
  { key: 'cancelled',   label: 'Has Cancelled',     icon: Ban,        activeBg: 'bg-slate-500', check: (c) => (c.cancelled || 0) > 0 },
];

// Customer type helpers removed — logic is now inlined in VirtualTable columns

export function Customers() {
  const allCustomers = useLiveQuery(() => db.customers.orderBy('id').reverse().toArray(), []) || [];
  const allOrders = useLiveQuery(() => db.orders.toArray(), []) || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  // OPTIMIZATION: Build order totals map only when orders change
  const orderTotals = useMemo(() => {
    const map = new Map<number, { total: number; delivered: number; rto: number; cancelled: number; totalCod: number; firstDate: string; lastDate: string }>();
    for (const o of allOrders) {
      let entry = map.get(o.customerId);
      if (!entry) {
        entry = { total: 0, delivered: 0, rto: 0, cancelled: 0, totalCod: 0, firstDate: o.orderDate, lastDate: o.orderDate };
        map.set(o.customerId, entry);
      }
      entry.total++;
      entry.totalCod += o.codAmount || 0;
      if (o.status === 'Delivered') entry.delivered++;
      else if (o.status === 'RTO') entry.rto++;
      else if (o.status === 'Cancelled') entry.cancelled++;
      if (o.orderDate < entry.firstDate) entry.firstDate = o.orderDate;
      if (o.orderDate > entry.lastDate) entry.lastDate = o.orderDate;
    }
    return map;
  }, [allOrders]);

  const { filterByDate } = useDateFilter();

  // Date-filtered customers
  const dateFilteredCustomers = useMemo(() => {
    return filterByDate(allCustomers, 'createdAt');
  }, [allCustomers, filterByDate]);

  // OPTIMIZATION: Pre-compute filter counts ONCE
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: dateFilteredCustomers.length };
    for (const f of FILTERS) {
      if (f.key !== 'all') counts[f.key] = dateFilteredCustomers.filter(c => f.check(c)).length;
    }
    return counts;
  }, [dateFilteredCustomers]);

  // Filtered + searched customers
  const filtered = useMemo(() => {
    let result = dateFilteredCustomers;
    
    const filterDef = FILTERS.find(f => f.key === activeFilter);
    if (filterDef) {
      result = result.filter(c => filterDef.check(c));
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const matchedOrderCustomerIds = new Set(
        allOrders
          .filter(o => o.orderId.toLowerCase().includes(term))
          .map(o => o.customerId)
      );
      result = result.filter(c => 
        c.mobile.includes(term) || 
        c.name.toLowerCase().includes(term) ||
        matchedOrderCustomerIds.has(c.id!)
      );
    }

    return [...result].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [dateFilteredCustomers, allOrders, activeFilter, searchTerm]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedCustomers = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  // VirtualTable column definitions (defined once outside render to prevent recreation)
  const customerColumns: VirtualTableColumn<any>[] = useMemo(() => [
    {
      key: 'customer',
      header: 'Customer',
      width: '200px',
      render: (customer: any) => {
        return (
          <div>
            <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(customer.id!)}>{customer.name}</div>
            <div className="text-xs text-slate-500 font-medium flex items-center gap-1">
              <Phone size={10} /> {customer.mobile}
            </div>
            {(customer.city || customer.state) && (
              <div className="text-[10px] text-slate-400 mt-0.5">
                {[customer.city, customer.state].filter((v: string) => v && v !== 'Unknown').join(', ')}
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'type',
      header: 'Type',
      width: '80px',
      render: (customer: any) => {
        const ot = orderTotals.get(customer.id!);
        const totalOrders = ot?.total || customer.totalOrders || 0;
        const totalCod = ot?.totalCod || customer.totalSpend || 0;
        const type = totalCod >= 50000 ? 'vip' : totalOrders >= 2 ? 'repeat' : 'new';
        if (type === 'vip') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700"><Star size={10} /> VIP</span>;
        if (type === 'repeat') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700"><Repeat size={10} /> Repeat</span>;
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">New</span>;
      }
    },
    {
      key: 'orders',
      header: 'Orders (D/RTO/C)',
      width: '130px',
      render: (customer: any) => {
        const ot = orderTotals.get(customer.id!);
        const totalOrders = ot?.total || customer.totalOrders || 0;
        const delivered = ot?.delivered || customer.delivered || 0;
        const rto = ot?.rto || customer.rto || 0;
        const cancelled = ot?.cancelled || customer.cancelled || 0;
        return (
          <>
            <div className="flex items-center gap-1.5 font-bold text-sm text-slate-700">
              <ShoppingCart size={12} className="text-slate-400" />
              <span>{totalOrders}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 flex gap-1.5">
              <span className="text-emerald-600">{delivered} D</span>
              <span className="text-red-400">/</span>
              <span className="text-red-500">{rto} RTO</span>
              <span className="text-red-400">/</span>
              <span className="text-slate-500">{cancelled} C</span>
            </div>
          </>
        );
      }
    },
    {
      key: 'totalCod',
      header: 'Total COD',
      width: '100px',
      render: (customer: any) => {
        const ot = orderTotals.get(customer.id!);
        const totalCod = ot?.totalCod || customer.totalSpend || 0;
        return <span className="font-bold text-slate-800">₹{totalCod.toLocaleString()}</span>;
      }
    },
    {
      key: 'firstOrder',
      header: 'First Order',
      width: '110px',
      render: (customer: any) => {
        const ot = orderTotals.get(customer.id!);
        const firstDate = ot?.firstDate || customer.createdAt;
        return (
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <Calendar size={10} className="text-slate-400" />
            {safeFormat(firstDate, 'dd MMM yyyy')}
          </div>
        );
      }
    },
    {
      key: 'lastOrder',
      header: 'Last Order',
      width: '110px',
      render: (customer: any) => {
        const ot = orderTotals.get(customer.id!);
        const lastDate = ot?.lastDate || customer.lastOrderDate || '-';
        return lastDate !== '-' ? (
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <Clock size={10} className="text-slate-400" />
            {safeFormat(lastDate, 'dd MMM yyyy')}
          </div>
        ) : <span className="text-slate-300 text-xs">-</span>;
      }
    },
    {
      key: 'status',
      header: 'Current Status',
      width: '120px',
      render: (customer: any) => (
        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-sm inline-block ${getBadgeClasses(customer.currentStatus)}`}>
          {customer.currentStatus || 'New Lead'}
        </span>
      )
    },
    {
      key: 'risk',
      header: 'Risk',
      width: '90px',
      render: (customer: any) => {
        const ot = orderTotals.get(customer.id!);
        const totalOrders = ot?.total || customer.totalOrders || 0;
        const rto = ot?.rto || customer.rto || 0;
        const rtoPercent = totalOrders > 0 ? Math.round((rto / totalOrders) * 100) : 0;
        if (customer.riskLevel === 'Fake') {
          return (
            <div className="flex items-center gap-1">
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded flex items-center gap-1">
                <AlertTriangle size={10} /> FAKE
              </span>
              {customer.fakeCount > 0 && <span className="text-[10px] text-red-500 font-bold">x{customer.fakeCount}</span>}
            </div>
          );
        }
        if (rtoPercent >= 30) return <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-bold rounded border border-red-200">High RTO</span>;
        if (customer.riskLevel === 'High' || customer.riskLevel === 'Critical') return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded">{customer.riskLevel}</span>;
        return <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded">{customer.riskLevel}</span>;
      }
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '100px',
      align: 'center',
      render: (customer: any) => (
        <button
          onClick={() => setSelectedCustomerId(customer.id!)}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition text-xs shadow-sm"
          title="View Full Timeline & Details"
        >
          <Eye size={14} /> Timeline
        </button>
      )
    },
  ], [orderTotals]);

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="text-blue-600" size={24} /> All Customers
          </h1>
          <p className="text-sm text-slate-500">
            Master customer database — {allCustomers.length} unique customers · {allOrders.length} total orders
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              id="customer-search"
              name="customer-search"
              aria-label="Search customers"
              type="text"
              autoComplete="search"
              placeholder="Search by name or mobile..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm w-72 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 overflow-x-auto">
        <div className="flex gap-1.5 min-w-max">
          {FILTERS.map(f => {
            const count = filterCounts[f.key] || 0;
            const isActive = activeFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => { setActiveFilter(f.key); setPage(0); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 whitespace-nowrap ${
                  isActive
                    ? `${f.activeBg} text-white shadow-md`
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <f.icon size={16} />
                {f.label}
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results info + Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          {filtered.length} customer{filtered.length !== 1 ? 's' : ''}
          {searchTerm && <span className="text-blue-600"> matching "{searchTerm}"</span>}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-medium text-xs text-slate-500">
              Page {safePage + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Customers Table — Virtual Scrolling */}
      <VirtualTable
        data={paginatedCustomers}
        height={580}
        estimateSize={72}
        emptyState={
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users size={40} className="text-slate-300 mb-3" />
            <p className="font-medium">No customers found</p>
            <p className="text-xs mt-1">
              {searchTerm
                ? 'No customers match your search criteria.'
                : 'Customers will appear once leads and orders are created.'}
            </p>
          </div>
        }
        columns={customerColumns}
        rowClassName={() => 'border-b border-slate-100 hover:bg-slate-50 transition-colors'}
      />

      {/* Bottom Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {safePage + 1} of {totalPages} ({filtered.length} total)
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            disabled={safePage >= totalPages - 1}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {selectedCustomerId && (
        <Suspense fallback={
              <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-3 shadow-2xl">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm text-slate-500 font-medium">Loading customer details…</p>
            </div>
          </div>
    </ModalPortal>
        }>
          <Customer360Profile
            customerId={selectedCustomerId}
            isOpen={true}
            onClose={() => setSelectedCustomerId(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

// CustomerRow removed — now handled inline in VirtualTable columns
