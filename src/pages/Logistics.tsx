// AVNIDEEP CRM PRO — Courier Management (Single Source of Truth)
// The order row (db.orders.status) is the ONLY master shipment status.
// This page reads order.status directly — there is no parallel logistics
// record that can drift. Status changes go through updateOrderStatus()
// which syncs order + customer counters + timeline + scan history.
// Legacy `logistics` records (if any) are removed by the startup migration.

import { useState, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ShipmentTrackingTimeline } from '../components/ShipmentTrackingTimeline';
import Search from 'lucide-react/dist/esm/icons/search'
import Eye from 'lucide-react/dist/esm/icons/eye'
import Truck from 'lucide-react/dist/esm/icons/truck'
import FileDown from 'lucide-react/dist/esm/icons/file-down'
import Package from 'lucide-react/dist/esm/icons/package'
import Send from 'lucide-react/dist/esm/icons/send'
import Home from 'lucide-react/dist/esm/icons/home'
import Check from 'lucide-react/dist/esm/icons/check'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Ban from 'lucide-react/dist/esm/icons/ban'
import Edit2 from 'lucide-react/dist/esm/icons/edit-2'
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import Clock from 'lucide-react/dist/esm/icons/clock'
import Copy from 'lucide-react/dist/esm/icons/copy'
import Phone from 'lucide-react/dist/esm/icons/phone'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import { safeFormat } from '../lib/safeFormat';
import { updateOrderStatus } from '../db/workflow';
import { toast } from 'react-hot-toast';
import { useDateFilter } from '../context/DateFilterContext';
import { NDRPanel } from './NDRPanel';
import { UndeliveredCustomers } from './UndeliveredCustomers';
import { VirtualTable, type VirtualTableColumn } from '../components/VirtualTable';

// ===== Status Tabs Configuration (matches ORDER_STATUSES pipeline) =====
interface StatusTabConfig {
  key: string;
  label: string;
  color: string;
  activeBg: string;
  activeText: string;
  dotColor: string;
}

const PAGE_SIZE = 50;

const STATUS_TABS: StatusTabConfig[] = [
  { key: 'All',              label: 'All',              color: 'slate',   activeBg: 'bg-slate-900',   activeText: 'text-white', dotColor: 'bg-slate-500' },
  { key: 'Ready To Ship',    label: 'Ready To Ship',    color: 'orange',  activeBg: 'bg-orange-500',  activeText: 'text-white', dotColor: 'bg-orange-500' },
  { key: 'Shipped',          label: 'Shipped',          color: 'blue',    activeBg: 'bg-blue-600',    activeText: 'text-white', dotColor: 'bg-blue-600' },
  { key: 'In Transit',       label: 'In Transit',       color: 'indigo',  activeBg: 'bg-indigo-600',  activeText: 'text-white', dotColor: 'bg-indigo-600' },
  { key: 'Out For Delivery', label: 'Out For Delivery', color: 'amber',   activeBg: 'bg-amber-500',   activeText: 'text-white', dotColor: 'bg-amber-500' },
  { key: 'Delivered',        label: 'Delivered',        color: 'emerald', activeBg: 'bg-emerald-600', activeText: 'text-white', dotColor: 'bg-emerald-600' },
  { key: 'Undelivered',      label: 'Undelivered',      color: 'red',     activeBg: 'bg-red-600',     activeText: 'text-white', dotColor: 'bg-red-600' },
  { key: 'RTO',              label: 'RTO',              color: 'rose',    activeBg: 'bg-rose-700',    activeText: 'text-white', dotColor: 'bg-rose-700' },
  { key: 'Cancelled',        label: 'Cancelled',        color: 'slate',   activeBg: 'bg-slate-500',   activeText: 'text-white', dotColor: 'bg-slate-500' },
];

// Statuses this module manages (from ORDER_STATUSES). Order Booked/Packing/Packed
// live in the Orders page; Shipped+ is handed over here.
const LOGISTICS_STATUSES = new Set([
  'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery',
  'Undelivered', 'Delivered', 'RTO', 'Cancelled',
]);

// ===== Status colors for table badge =====
const STATUS_BADGE_COLORS: Record<string, string> = {
  'Ready To Ship':     'bg-orange-100 text-orange-700 border-orange-200',
  'Shipped':           'bg-blue-100 text-blue-700 border-blue-200',
  'In Transit':        'bg-indigo-100 text-indigo-700 border-indigo-200',
  'Out For Delivery':  'bg-amber-100 text-amber-700 border-amber-200',
  'Delivered':         'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Undelivered':       'bg-red-100 text-red-700 border-red-200',
  'RTO':               'bg-rose-100 text-rose-800 border-rose-300',
  'Cancelled':         'bg-slate-100 text-slate-600 border-slate-200',
};

function getBadgeColor(status: string): string {
  return STATUS_BADGE_COLORS[status] || 'bg-slate-100 text-slate-600 border-slate-200';
}

// ===== Shipment Data Row Interface =====
interface ShipmentRowData {
  id: number;
  orderId: number;
  status: string;
  dispatchDate: string;
  lastUpdate: string;
  order?: any;
  customer?: any;
}

function LogisticsContent() {
  const orders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [copiedAWB, setCopiedAWB] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id!, c])), [customers]);

  // Build shipment list directly from ORDERS — single source of truth.
  const allShipments: ShipmentRowData[] = useMemo(() => {
    const result: ShipmentRowData[] = [];
    for (const order of orders) {
      if (!LOGISTICS_STATUSES.has(order.status)) continue;
      const customer = customerMap.get(order.customerId);
      result.push({
        id: order.id!,
        orderId: order.id!,
        status: order.status,
        dispatchDate: order.shipmentDate || '',
        lastUpdate: order.updatedAt || order.createdAt || '',
        order,
        customer,
      });
    }
    result.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());
    return result;
  }, [orders, customerMap]);

  const { filterByDate } = useDateFilter();

  const dateFilteredShipments = useMemo(() => {
    return filterByDate(allShipments, (s) => s.dispatchDate || s.lastUpdate);
  }, [allShipments, filterByDate]);

  // Counts per tab (respects date filter)
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { All: dateFilteredShipments.length };
    for (const s of dateFilteredShipments) {
      const key = s.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    for (const tab of STATUS_TABS) {
      if (!counts[tab.key]) counts[tab.key] = 0;
    }
    return counts;
  }, [dateFilteredShipments]);

  // All filtered (not yet paginated)
  const allFiltered = useMemo(() => {
    let filtered = dateFilteredShipments;
    if (activeTab !== 'All') {
      filtered = filtered.filter(s => s.status === activeTab);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(s => {
        const o = s.order;
        const c = s.customer;
        return (
          (o?.trackingId || '').toLowerCase().includes(term) ||
          (o?.orderId || '').toLowerCase().includes(term) ||
          (c?.name || '').toLowerCase().includes(term) ||
          (c?.mobile || '').includes(term) ||
          (o?.courier || '').toLowerCase().includes(term)
        );
      });
    }
    return filtered;
  }, [dateFilteredShipments, activeTab, searchTerm]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(allFiltered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const displayShipments = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return allFiltered.slice(start, start + PAGE_SIZE);
  }, [allFiltered, safePage]);

  // Summary stats (respects date filter)
  const todayStr = new Date().toDateString();
  const summary = useMemo(() => {
    const filteredOrderIds = new Set(dateFilteredShipments.map(s => s.orderId));
    const ordersForStats = orders.filter(o => filteredOrderIds.has(o.id!));
    return {
      todaysDispatch: ordersForStats.filter(o => {
        if (o.status !== 'Shipped') return false;
        try { return new Date(o.shipmentDate || o.updatedAt).toDateString() === todayStr; } catch { return false; }
      }).length,
      outForDelivery: ordersForStats.filter(o => o.status === 'Out For Delivery').length,
      deliveredToday: ordersForStats.filter(o => {
        if (o.status !== 'Delivered') return false;
        try { return new Date(o.updatedAt).toDateString() === todayStr; } catch { return false; }
      }).length,
      pendingShipment: ordersForStats.filter(o => o.status === 'Ready To Ship').length,
      rto: ordersForStats.filter(o => o.status === 'RTO').length,
      cancelled: ordersForStats.filter(o => o.status === 'Cancelled').length,
    };
  }, [orders, dateFilteredShipments]);

  // Editing state for inline AWB/Courier
  const [editingShipId, setEditingShipId] = useState<number | null>(null);
  const [tempAWB, setTempAWB] = useState('');
  const [tempCourier, setTempCourier] = useState('');

  const handleCopyAWB = useCallback(async (trackingId: string, rowId: number) => {
    try {
      await navigator.clipboard.writeText(trackingId);
      setCopiedAWB(rowId);
      setTimeout(() => setCopiedAWB(null), 2000);
      toast.success('AWB copied!');
    } catch { /* fallback */ }
  }, []);

  // ===== VirtualTable Column Definitions (memoized) =====
  const shipmentColumns: VirtualTableColumn<any>[] = useMemo(() => {
    const handleSaveAWB = async (ship: any) => {
      try {
        await db.orders.update(ship.orderId, { trackingId: tempAWB, courier: tempCourier, updatedAt: new Date().toISOString() });
        toast.success('AWB/Courier updated');
        setEditingShipId(null);
      } catch { toast.error('Failed to update'); }
    };

    return [
      {
        key: 'awb',
        header: 'AWB / Courier',
        width: '180px',
        render: (ship: any) => {
          const order = ship.order;
          if (!order) return null;
          if (editingShipId === ship.id) {
            return (
              <div className="space-y-1 min-w-[140px]">
                <input value={tempAWB} onChange={e => setTempAWB(e.target.value)} placeholder="AWB"
                  className="w-full px-2 py-1 border border-slate-300 rounded text-[10px] outline-none focus:ring-1 focus:ring-blue-500" />
                <input value={tempCourier} onChange={e => setTempCourier(e.target.value)} placeholder="Courier"
                  className="w-full px-2 py-1 border border-slate-300 rounded text-[10px] outline-none focus:ring-1 focus:ring-blue-500" />
                <div className="flex gap-1">
                  <button onClick={() => handleSaveAWB(ship)} className="px-2 py-0.5 bg-blue-600 text-white rounded text-[9px] font-bold">SAVE</button>
                  <button onClick={() => setEditingShipId(null)} className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[9px] font-bold">X</button>
                </div>
              </div>
            );
          }
          return (
            <div className="group relative pr-6">
              <div className="flex items-center gap-1.5">
                {order.trackingId ? (
                  <>
                    <span className="font-bold text-slate-800 font-mono text-xs">{order.trackingId}</span>
                    <button onClick={() => handleCopyAWB(order.trackingId, ship.id)}
                      title="Copy AWB" className="p-0.5 text-slate-300 hover:text-blue-600 transition">
                      {copiedAWB === ship.id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                    </button>
                  </>
                ) : (
                  <span className="text-slate-400 text-xs italic">No AWB</span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{order.courier || 'Not assigned'}</div>
              <button onClick={() => { setTempAWB(order.trackingId || ''); setTempCourier(order.courier || ''); setEditingShipId(ship.id); }}
                className="absolute right-0 top-0 p-0.5 text-slate-200 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition">
                <Edit2 size={11} />
              </button>
            </div>
          );
        }
      },
      {
        key: 'customer',
        header: 'Customer',
        width: '150px',
        render: (ship: any) => {
          if (!ship.customer) return null;
          return (
            <>
              <div className="font-medium text-slate-800 text-sm">{ship.customer.name}</div>
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Phone size={10} /> {ship.customer.mobile}
              </div>
            </>
          );
        }
      },
      {
        key: 'cod',
        header: 'COD',
        width: '90px',
        render: (ship: any) => <span className="font-bold text-slate-800">₹{ship.order?.codAmount?.toLocaleString() || '0'}</span>
      },
      {
        key: 'status',
        header: 'Status',
        width: '150px',
        render: (ship: any) => {
          const currentStatus = ship.status;
          const nextOptions = nextStatusOptions(currentStatus);
          const badgeColor = getBadgeColor(currentStatus);
          if (nextOptions.length > 1) {
            return (
              <select value={currentStatus} onChange={e => handleStatusChange(ship, e.target.value)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold outline-none border cursor-pointer ${badgeColor}`}>
                {nextOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            );
          }
          return <span className={`inline-block px-2.5 py-1.5 rounded-lg text-[10px] font-bold border ${badgeColor}`}>{currentStatus}</span>;
        }
      },
      {
        key: 'dispatchDate',
        header: 'Dispatch Date',
        width: '110px',
        render: (ship: any) => (
          ship.dispatchDate ? (
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <Calendar size={11} className="text-slate-400" />
              {safeFormat(ship.dispatchDate, 'dd MMM yyyy')}
            </div>
          ) : <span className="text-slate-400 text-xs">-</span>
        )
      },
      {
        key: 'expectedDelivery',
        header: 'Expected Delivery',
        width: '100px',
        render: (ship: any) => {
          const expectedDelivery = ship.dispatchDate
            ? new Date(new Date(ship.dispatchDate).getTime() + 7 * 86400000).toISOString()
            : '';
          return expectedDelivery ? (
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <Clock size={11} className="text-slate-400" />
              {safeFormat(expectedDelivery, 'dd MMM')}
            </div>
          ) : <span className="text-xs text-slate-400">-</span>;
        }
      },
      {
        key: 'orderId',
        header: 'Order ID',
        width: '120px',
        render: (ship: any) => <span className="text-xs font-mono text-slate-500">{ship.order?.orderId}</span>
      },
      {
        key: 'actions',
        header: 'Actions',
        width: '80px',
        align: 'center',
        render: (ship: any) => (
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => handleViewTracking(ship.orderId)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="View Tracking">
              <Eye size={16} />
            </button>
            {ship.customer?.mobile && (
              <a href={`tel:${ship.customer.mobile}`}
                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition" title="Call Customer">
                <Phone size={16} />
              </a>
            )}
          </div>
        )
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingShipId, tempAWB, tempCourier, copiedAWB, handleCopyAWB]);

  // ===== Handlers =====
  // UNIFIED write path — same function used by Orders + NDR. Updates the order
  // row (master), syncs customer counters + timeline + scan history.
  const handleStatusChange = useCallback(async (shipment: ShipmentRowData, newStatus: string) => {
    try {
      const order = await db.orders.get(shipment.orderId);
      if (!order) return;
      const meta: any = { agentName: 'Admin' };
      if (newStatus === 'Shipped' && !order.trackingId) {
        meta.trackingId = `TRK${Date.now().toString().slice(-8)}`;
        meta.shipmentDate = new Date().toISOString();
        meta.courier = order.courier || 'Delhivery';
      }
      if (newStatus === 'Delivered' && !order.shipmentDate) {
        meta.shipmentDate = new Date().toISOString();
      }
      const r = await updateOrderStatus(shipment.orderId, newStatus, meta);
      if (r.changed) toast.success(`Shipment moved to ${newStatus}`);
      else toast(`Already in ${newStatus}`, { icon: 'ℹ️' });
    } catch (e) {
      toast.error('Failed to update shipment status');
    }
  }, []);

  const handleViewTracking = useCallback((orderId: number) => setSelectedOrderId(orderId), []);

  // handleExport uses current displayShipments — NOT useCallback to avoid stale closure
  const handleExport = () => {
    if (displayShipments.length === 0) {
      toast.error('No shipments to export');
      return;
    }
    import('exceljs').then(async (mod) => {
      const ExcelJS = mod.default || mod;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Logistics');
      const headers = ['Order ID', 'AWB / Tracking', 'Courier', 'Customer', 'Phone', 'COD Amount', 'Status', 'Dispatch Date', 'Last Update'];
      ws.addRow(headers);
      for (const s of displayShipments) {
        ws.addRow([
          s.order?.orderId || '',
          s.order?.trackingId || '',
          s.order?.courier || '',
          s.customer?.name || '',
          s.customer?.mobile || '',
          s.order?.codAmount || 0,
          s.status,
          s.dispatchDate ? safeFormat(s.dispatchDate, 'dd MMM yyyy') : '',
          safeFormat(s.lastUpdate, 'dd MMM yyyy HH:mm'),
        ]);
      }
      const filename = `Logistics_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;

      const electronAPI = (window as any).electron;
      if (electronAPI?.saveExportedExcel) {
        const buf = await wb.xlsx.writeBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        const r = await electronAPI.saveExportedExcel(filename, base64);
        if (r?.success) toast.success(`Exported: ${r.path}`);
      } else {
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Exported');
      }
    });
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Truck className="text-blue-600" size={26} /> Courier Management
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track all shipments — {dateFilteredShipments.length} total · {summary.outForDelivery} Out For Delivery · {summary.deliveredToday} Delivered Today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" placeholder="Search AWB, name, phone, order..." value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm w-72 outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition shadow-sm text-sm font-semibold">
            <FileDown size={16} /> Export
          </button>
        </div>
      </div>

      {/* Summary Cards Row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <SummaryCard label="Today's Dispatch" value={summary.todaysDispatch} icon={Send} color="bg-blue-50 text-blue-600" />
        <SummaryCard label="Out For Delivery" value={summary.outForDelivery} icon={Home} color="bg-amber-50 text-amber-600" />
        <SummaryCard label="Delivered Today" value={summary.deliveredToday} icon={Check} color="bg-emerald-50 text-emerald-600" />
        <SummaryCard label="Pending Shipment" value={summary.pendingShipment} icon={Package} color="bg-orange-50 text-orange-600" />
        <SummaryCard label="RTO" value={summary.rto} icon={RotateCcw} color="bg-red-50 text-red-600" />
        <SummaryCard label="Cancelled" value={summary.cancelled} icon={Ban} color="bg-slate-100 text-slate-600" />
      </div>

      {/* Status Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 overflow-x-auto">
        <div className="flex gap-1.5 min-w-max">
          {STATUS_TABS.map(tab => {
            const count = tabCounts[tab.key] || 0;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 whitespace-nowrap ${
                  isActive
                    ? `${tab.activeBg} ${tab.activeText} shadow-md`
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white/70' : tab.dotColor}`}></span>
                {tab.label}
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

      {/* Results Info + Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          {allFiltered.length} shipment{allFiltered.length !== 1 ? 's' : ''}
          {activeTab !== 'All' && <span className="text-slate-400"> in <strong>{activeTab}</strong></span>}
        </span>
        <div className="flex items-center gap-3">
          {searchTerm && <span className="text-blue-600 text-xs">Filtered by: "{searchTerm}"</span>}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
                className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 transition">
                <ChevronLeft size={16} />
              </button>
              <span className="font-medium text-xs text-slate-500">Page {safePage + 1} of {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))} disabled={safePage >= totalPages - 1}
                className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 transition">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Shipments Table — Virtual Scrolling */}
      <VirtualTable
        data={displayShipments}
        height={520}
        estimateSize={68}
        emptyState={
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Truck size={36} className="text-slate-300 mb-3" />
            <p className="font-medium">No shipments found</p>
            <p className="text-xs mt-1">
              {activeTab !== 'All'
                ? `No shipments in "${activeTab}" status. Try a different filter.`
                : searchTerm
                  ? 'No results match your search criteria.'
                  : 'Shipments will appear once orders are dispatched.'}
            </p>
          </div>
        }
        rowClassName={() => 'border-b border-slate-100 hover:bg-slate-50 transition-colors'}
        columns={shipmentColumns}
      />

      {/* Tracking Timeline Modal */}
      {selectedOrderId && (
        <ShipmentTrackingTimeline orderId={selectedOrderId} isOpen={true} onClose={() => setSelectedOrderId(null)} />
      )}
    </div>
  );
}

// ===== Summary Card =====
function SummaryCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-xl font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

// Allowed forward/backward moves per status — enforces the admin-only pipeline.
function nextStatusOptions(status: string): string[] {
  switch (status) {
    case 'Ready To Ship':    return ['Ready To Ship', 'Shipped', 'Cancelled'];
    case 'Shipped':          return ['Shipped', 'In Transit', 'Out For Delivery', 'Undelivered', 'RTO', 'Cancelled'];
    case 'In Transit':       return ['In Transit', 'Out For Delivery', 'Delivered', 'Undelivered', 'RTO', 'Cancelled'];
    case 'Out For Delivery': return ['Out For Delivery', 'Delivered', 'Undelivered', 'RTO', 'Cancelled'];
    case 'Undelivered':      return ['Undelivered', 'Out For Delivery', 'Delivered', 'RTO', 'Cancelled'];
    case 'Delivered':        return ['Delivered'];
    case 'RTO':              return ['RTO'];
    case 'Cancelled':        return ['Cancelled'];
    default:                 return [status];
  }
}

// =====================================================================
// Tabbed wrapper: Logistics (shipments) + NDR + Undelivered cases.
// =====================================================================
export function Logistics() {
  const [view, setView] = useState<'shipments' | 'ndr' | 'undelivered'>('shipments');
  const TABS = [
    { key: 'shipments' as const, label: 'Shipments' },
    { key: 'ndr' as const, label: 'NDR Cases' },
    { key: 'undelivered' as const, label: 'Undelivered' },
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
      {view === 'ndr' ? <NDRPanel /> : view === 'undelivered' ? <UndeliveredCustomers /> : <LogisticsContent />}
    </div>
  );
}
