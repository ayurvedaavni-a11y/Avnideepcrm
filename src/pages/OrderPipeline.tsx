// AVNIDEEP CRM PRO — Professional Order Management Pipeline (Kanban OMS)
// Stages: Order Booked → Packing → Packed → Ready To Ship → Shipped → In Transit → Out For Delivery → Delivered → RTO → Cancelled

import { useState, useMemo, useCallback, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { toast } from 'react-hot-toast';
import Package from 'lucide-react/dist/esm/icons/package'
import Truck from 'lucide-react/dist/esm/icons/truck'
import Check from 'lucide-react/dist/esm/icons/check'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import Phone from 'lucide-react/dist/esm/icons/phone'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle'
import Copy from 'lucide-react/dist/esm/icons/copy'
import Eye from 'lucide-react/dist/esm/icons/eye'
import X from 'lucide-react/dist/esm/icons/x'
import Search from 'lucide-react/dist/esm/icons/search'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import Send from 'lucide-react/dist/esm/icons/send'
import MapPin from 'lucide-react/dist/esm/icons/map-pin'
import Home from 'lucide-react/dist/esm/icons/home'
import Ban from 'lucide-react/dist/esm/icons/ban'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import { safeFormat } from '../lib/safeFormat';
import { autoGenerateInvoice, downloadInvoicePDF } from '../db/invoiceEngine';
import { syncOrderToCentralStatus } from '../db/workflow';
import { Customer360Profile } from '../components/Customer360Profile';
import { useDateFilter } from '../context/DateFilterContext';
import { useAuth } from '../context/AuthContext';
import { DeliveredCustomers } from './DeliveredCustomers';

// ===== Pipeline Stages Definition =====
const PIPELINE_STAGES = [
  { key: 'Order Booked',     label: 'Order Booked',     icon: ShoppingCart, color: 'amber',   bg: 'bg-amber-50',    headerColor: 'text-amber-700',    borderColor: 'border-amber-200', nextStage: 'Packing' },
  { key: 'Packing',          label: 'Packing',           icon: Package,      color: 'orange',  bg: 'bg-orange-50',   headerColor: 'text-orange-700',   borderColor: 'border-orange-200', nextStage: 'Packed' },
  { key: 'Packed',           label: 'Packed',            icon: ShieldCheck,  color: 'indigo',  bg: 'bg-indigo-50',   headerColor: 'text-indigo-700',   borderColor: 'border-indigo-200', nextStage: 'Ready To Ship' },
  { key: 'Ready To Ship',    label: 'Ready To Ship',     icon: Send,         color: 'blue',    bg: 'bg-blue-50',     headerColor: 'text-blue-700',     borderColor: 'border-blue-200', nextStage: 'Shipped' },
  { key: 'Shipped',          label: 'Shipped',           icon: Truck,        color: 'blue',    bg: 'bg-blue-50',     headerColor: 'text-blue-700',     borderColor: 'border-blue-200', nextStage: 'In Transit' },
  { key: 'In Transit',       label: 'In Transit',        icon: MapPin,       color: 'blue',    bg: 'bg-blue-50',     headerColor: 'text-blue-700',     borderColor: 'border-blue-200', nextStage: 'Out For Delivery' },
  { key: 'Out For Delivery', label: 'Out For Delivery',  icon: Home,         color: 'amber',   bg: 'bg-amber-50',    headerColor: 'text-amber-700',    borderColor: 'border-amber-200', nextStage: 'Delivered' },
  { key: 'Delivered',        label: 'Delivered',         icon: Check,        color: 'emerald', bg: 'bg-emerald-50',  headerColor: 'text-emerald-700',  borderColor: 'border-emerald-200', nextStage: null },
  { key: 'RTO',              label: 'RTO',               icon: RotateCcw,    color: 'red',     bg: 'bg-red-50',      headerColor: 'text-red-700',      borderColor: 'border-red-200', nextStage: null },
  { key: 'Cancelled',        label: 'Cancelled',         icon: Ban,          color: 'slate',   bg: 'bg-slate-100',   headerColor: 'text-slate-600',    borderColor: 'border-slate-200', nextStage: null },
];

// ===== Status Change Options Per Stage =====
const NEXT_STATUS_MAP: Record<string, string[]> = {
  'Order Booked':     ['Packing', 'Cancelled'],
  'Packing':          ['Packed', 'Order Booked', 'Cancelled'],
  'Packed':           ['Ready To Ship', 'Packing', 'Cancelled'],
  'Ready To Ship':    ['Shipped', 'Packed', 'Cancelled'],
  'Shipped':          ['In Transit', 'Ready To Ship', 'Undelivered', 'RTO', 'Cancelled'],
  'In Transit':       ['Out For Delivery', 'Shipped', 'Undelivered', 'RTO', 'Cancelled'],
  'Out For Delivery': ['Delivered', 'In Transit', 'Undelivered', 'RTO', 'Cancelled'],
  'Delivered':        [],
  'RTO':              [],
  'Cancelled':        [],
};

const ALL_PIPELINE_STATUSES = PIPELINE_STAGES.map(s => s.key);

// ===== Main Component =====
const MAX_CARDS_PER_COLUMN = 30;

function OrderPipelineContent() {
  const allOrders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);

  // OPTIMIZATION: Pre-build customerMap instead of per-row useLiveQuery
  const customerMap = useMemo(() => {
    const map = new Map<number, any>();
    allCustomers.forEach(c => { if (c.id) map.set(c.id, c); });
    return map;
  }, [allCustomers]);

  const { filterByDate } = useDateFilter();

  const pipelineOrders = useMemo(() => {
    return allOrders.filter(o => ALL_PIPELINE_STATUSES.includes(o.status));
  }, [allOrders]);

  // Group orders by status for each column
  const columnOrders = useMemo(() => {
    const map: Record<string, any[]> = {};
    ALL_PIPELINE_STATUSES.forEach(s => { map[s] = []; });
    
    // Apply date filter first
    let filtered = filterByDate(pipelineOrders, 'orderDate');

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(o => 
        o.orderId.toLowerCase().includes(term) ||
        o.product.toLowerCase().includes(term) ||
        o.trackingId?.toLowerCase().includes(term) ||
        o.courier?.toLowerCase().includes(term) ||
        String(o.codAmount).includes(term)
      );
    }
    
    filtered.forEach(o => {
      if (map[o.status]) map[o.status].push(o);
    });
    return map;
  }, [pipelineOrders, filterByDate, searchTerm]);

  // Leads ready for sync (status = 'Order Booked' but no order yet)
  const leadsReady = useLiveQuery(() => 
    db.leads.where('status').equals('Order Booked').toArray(), []
  ) || [];

  const handleViewTimeline = useCallback((customerId: number) => setSelectedCustomerId(customerId), []);
  const handleViewDetail = useCallback((orderId: number) => setDetailOrderId(orderId), []);

  const handleSyncLeadToOrder = async (leadId: number) => {
    try {
      const lead = await db.leads.get(leadId);
      if (!lead) return;
      const existingOrder = await db.orders.where('leadId').equals(leadId).first();
      if (existingOrder) {
        toast.error('Order already exists for this lead');
        return;
      }
      const orderId = `AVN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;
      const id = await db.orders.add({
        orderId,
        leadId: lead.id,
        customerId: lead.customerId,
        product: lead.product,
        qty: 1,
        codAmount: lead.expectedAmount,
        status: 'Order Booked',
        orderDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await db.timelineLogs.add({
        customerId: lead.customerId,
        entityType: 'Order',
        entityId: id,
        action: 'Order Generated from Lead',
        notes: `Order ${orderId} generated for ${lead.product} — ₹${lead.expectedAmount}`,
        agentName: 'Admin',
        createdAt: new Date().toISOString()
      });
      try { await autoGenerateInvoice(id, 'System'); } catch (e) {}
      toast.success(`Order ${orderId} created!`);
    } catch (e) {
      toast.error('Failed to sync lead');
    }
  };

  const handleBulkSyncLeads = async () => {
    let count = 0;
    for (const lead of leadsReady) {
      const existing = await db.orders.where('leadId').equals(lead.id!).first();
      if (!existing) {
        await handleSyncLeadToOrder(lead.id!);
        count++;
      }
    }
    if (count > 0) toast.success(`Synced ${count} leads`);
    else toast('No pending leads to sync', { icon: 'ℹ️' });
  };

  const handleAdvanceOrder = useCallback(async (orderId: number, newStatus: string) => {
    try {
      const order = await db.orders.get(orderId);
      if (!order) return;
      const oldStatus = order.status;

      const updateData: any = { status: newStatus, updatedAt: new Date().toISOString() };

      // Auto-set tracking fields when shipping
      if (newStatus === 'Shipped' && !order.trackingId) {
        updateData.trackingId = `TRK${Date.now().toString().slice(-8)}`;
        updateData.shipmentDate = new Date().toISOString();
        updateData.courier = order.courier || 'Delhivery';
        
        // Create logistics record on first ship
        const existingLog = await db.logistics.where('orderId').equals(orderId).first();
        if (!existingLog) {
          const logId = await db.logistics.add({
            orderId,
            status: 'Shipped',
            dispatchDate: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }) as number;
          await db.shipmentScans.add({
            orderId, logisticsId: logId,
            status: 'Shipped', normalizedStatus: 'Shipped',
            remarks: 'Shipment handed over to courier',
            scanDate: new Date().toISOString(), source: 'manual',
            createdAt: new Date().toISOString()
          });
        }
      }

      await db.orders.update(orderId, updateData);
      await syncOrderToCentralStatus(orderId, newStatus, oldStatus);

      await db.timelineLogs.add({
        customerId: order.customerId,
        entityType: 'Order',
        entityId: orderId,
        action: `Order ${newStatus}`,
        statusFrom: oldStatus,
        statusTo: newStatus,
        notes: newStatus === 'Shipped' ? `Tracking: ${updateData.trackingId}` : 
               newStatus === 'Delivered' ? 'Order delivered successfully' : '',
        agentName: 'Admin',
        createdAt: new Date().toISOString()
      });

      toast.success(`Order moved to ${newStatus}`);
    } catch (e) {
      toast.error('Failed to update order status');
    }
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Order Pipeline</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {Object.values(columnOrders).reduce((sum, arr) => sum + arr.length, 0)} active orders · {leadsReady.length} leads ready to sync
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="Search orders..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm w-64 outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={handleBulkSyncLeads}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition shadow-sm text-sm font-semibold">
              <RefreshCw size={16} /> Sync Leads
            </button>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-4 h-full min-w-max">
          {PIPELINE_STAGES.map(stage => {
            const orders = columnOrders[stage.key] || [];
            const totalCod = orders.reduce((s, o) => s + (o.codAmount || 0), 0);
            return (
              <div key={stage.key} className="flex flex-col w-72 rounded-xl border border-slate-200 bg-slate-50/80 shadow-sm">
                {/* Column Header */}
                <div className={`flex-shrink-0 ${stage.bg} ${stage.borderColor} border-b p-3 rounded-t-xl`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <stage.icon size={18} className={stage.headerColor} />
                      <h3 className={`font-bold text-sm ${stage.headerColor}`}>{stage.label}</h3>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold bg-white ${stage.headerColor} shadow-sm`}>
                      {orders.length}
                    </span>
                  </div>
                  {orders.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1 font-medium">₹{totalCod.toLocaleString()}</p>
                  )}
                </div>
                {/* Cards Container */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px]">
                  {orders.slice(0, MAX_CARDS_PER_COLUMN).map(order => (
                    <OrderCardWrapper 
                      key={order.id}
                      order={order}
                      customer={customerMap.get(order.customerId)}
                      stage={stage}
                      onAdvanceOrder={handleAdvanceOrder}
                      onViewTimeline={handleViewTimeline}
                      onViewDetail={handleViewDetail}
                    />
                  ))}
                  {orders.length === 0 && (
                    <div className="text-center text-slate-400 py-8 text-xs">
                      <div className="text-2xl mb-2 opacity-30">-</div>
                      No orders
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modals */}
      {selectedCustomerId && (
        <Customer360Profile customerId={selectedCustomerId} isOpen={true} onClose={() => setSelectedCustomerId(null)} />
      )}
      {detailOrderId && (
        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
      )}
    </div>
  );
}

// ===== Order Card (memoized - no useLiveQuery!) =====
const OrderCard = memo(function OrderCard({ order, customer, stage, onAdvance, onViewTimeline, onViewDetail }: {
  order: any; customer: any; stage: any; onAdvance: (s: string) => void; onViewTimeline: () => void; onViewDetail: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);

  const nextOptions = NEXT_STATUS_MAP[order.status] || [];

  const handleCopyAWB = () => {
    if (order.trackingId) {
      navigator.clipboard.writeText(order.trackingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('AWB copied!');
    }
  };

  const handleInvoice = async () => {
    let inv = await db.invoices.where('orderId').equals(order.id).first();
    if (!inv) inv = await autoGenerateInvoice(order.id, 'Admin') || undefined;
    if (inv) downloadInvoicePDF(inv);
  };

  if (!customer) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 group">
      {/* Card Header — Order ID + Date */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[10px] font-bold font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
          {order.orderId}
        </span>
        <span className="text-[10px] text-slate-400">{safeFormat(order.createdAt, 'dd MMM')}</span>
      </div>

      {/* Customer Info */}
      <div className="px-3 py-1.5">
        <h4 className="font-bold text-slate-800 text-sm truncate">{customer.name}</h4>
        <p className="text-xs text-slate-500 font-medium">{customer.mobile}</p>
      </div>

      {/* Product + Amount */}
      <div className="px-3 pb-2">
        <p className="text-xs text-slate-600 truncate">{order.product} {order.qty > 1 ? `(x${order.qty})` : ''}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="font-bold text-slate-800 text-sm">₹{order.codAmount?.toLocaleString()}</span>
          {order.trackingId && (
            <span className="text-[9px] font-mono text-slate-400 truncate max-w-[100px]" title={order.trackingId}>
              {order.trackingId.slice(0, 12)}...
            </span>
          )}
        </div>
        {order.courier && (
          <span className="text-[10px] text-slate-400">{order.courier}</span>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-3 pb-3 flex items-center justify-between border-t border-slate-100 pt-2">
        {/* Status Change */}
        <div className="flex items-center gap-1">
          {nextOptions.slice(0, 2).map(status => (
            <button key={status}
              onClick={() => onAdvance(status)}
              className={`text-[9px] font-bold px-2 py-1 rounded-md transition ${
                status === 'Cancelled' || status === 'RTO' || status === 'Undelivered'
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : status === 'Delivered'
                  ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}>
              {status === stage.nextStage ? `→ ${status}` : status}
            </button>
          ))}
          {nextOptions.length > 2 && (
            <div className="relative">
              <button onClick={() => setShowActions(!showActions)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <MoreHorizontal size={14} />
              </button>
              {showActions && (
                <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg p-1 z-10 min-w-[120px]">
                  {nextOptions.slice(2).map(status => (
                    <button key={status} onClick={() => { setShowActions(false); onAdvance(status); }}
                      className="block w-full text-left text-xs px-3 py-1.5 rounded hover:bg-slate-50 text-slate-700 font-medium">
                      {status}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Icons */}
        <div className="flex items-center gap-0.5">
          <button onClick={handleInvoice} title="Invoice" className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition">
            <FileText size={13} />
          </button>
          <button onClick={() => window.open(`tel:${customer.mobile}`)} title="Call" className="p-1 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition">
            <Phone size={13} />
          </button>
          <button onClick={() => window.open(`https://wa.me/91${customer.mobile}`)} title="WhatsApp" className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition">
            <MessageCircle size={13} />
          </button>
          {order.trackingId && (
            <button onClick={handleCopyAWB} title="Copy AWB" className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition">
              {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            </button>
          )}
          <button onClick={onViewTimeline} title="Timeline" className="p-1 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition">
            <Eye size={13} />
          </button>
          <button onClick={onViewDetail} title="Details" className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition">
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
});

// ===== OrderCardWrapper — bridges stable callbacks to memo(OrderCard) =====
const OrderCardWrapper = memo(function OrderCardWrapper({ order, customer, stage, onAdvanceOrder, onViewTimeline, onViewDetail }: {
  order: any; customer: any; stage: any;
  onAdvanceOrder: (orderId: number, newStatus: string) => void;
  onViewTimeline: (customerId: number) => void;
  onViewDetail: (orderId: number) => void;
}) {
  const onAdvance = useCallback(
    (newStatus: string) => onAdvanceOrder(order.id!, newStatus),
    [order.id, onAdvanceOrder]
  );
  const onTimeline = useCallback(
    () => onViewTimeline(order.customerId),
    [order.customerId, onViewTimeline]
  );
  const onDetail = useCallback(
    () => onViewDetail(order.id!),
    [order.id, onViewDetail]
  );

  return (
    <OrderCard
      order={order}
      customer={customer}
      stage={stage}
      onAdvance={onAdvance}
      onViewTimeline={onTimeline}
      onViewDetail={onDetail}
    />
  );
});

// ===== Order Detail Modal =====
function OrderDetailModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const order = useLiveQuery(() => db.orders.get(orderId), [orderId]);
  const customer = useLiveQuery(() => order ? db.customers.get(order.customerId) : undefined, [order]);
  const timeline = useLiveQuery(() => 
    order ? db.timelineLogs.where('customerId').equals(order.customerId).reverse().toArray() : [],
    [order]
  );

  if (!order || !customer) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{customer.name}</h2>
            <p className="text-sm text-slate-500">{customer.mobile} · {order.orderId}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X size={20} className="text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Order Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Product</p>
              <p className="font-bold text-slate-800 mt-1">{order.product} x{order.qty}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">COD Amount</p>
              <p className="font-bold text-slate-800 mt-1 text-lg">₹{order.codAmount?.toLocaleString()}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Current Status</p>
              <p className="font-bold text-slate-800 mt-1">{order.status}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Courier</p>
              <p className="font-bold text-slate-800 mt-1">{order.courier || 'Not assigned'}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Tracking / AWB</p>
              <p className="font-bold text-slate-800 mt-1 font-mono">{order.trackingId || 'N/A'}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Order Date</p>
              <p className="font-bold text-slate-800 mt-1">{safeFormat(order.orderDate, 'dd MMM yyyy, HH:mm')}</p>
            </div>
          </div>

          {/* Customer Info */}
          <div className="bg-slate-50 p-4 rounded-xl">
            <h4 className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Customer Details</h4>
            <p className="text-sm text-slate-700">{customer.name} · {customer.mobile}</p>
            {customer.address && <p className="text-sm text-slate-600 mt-1">{customer.address}</p>}
            <p className="text-sm text-slate-600">{customer.city}, {customer.state} - {customer.pincode}</p>
          </div>

          {/* Timeline */}
          <div>
            <h4 className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">Order Timeline</h4>
            <div className="space-y-3">
              {timeline?.slice(0, 10).map((entry: any) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 flex-shrink-0"></div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{entry.action}</p>
                    <p className="text-xs text-slate-500">{entry.notes}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{safeFormat(entry.createdAt, 'dd MMM yyyy HH:mm')}</p>
                  </div>
                </div>
              ))}
              {(!timeline || timeline.length === 0) && (
                <p className="text-sm text-slate-400 italic">No timeline events</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Tabbed wrapper: Order Pipeline + Delivered list (sidebar simplification).
// Delivered view is admin-only; telecallers keep the plain pipeline.
// =====================================================================
export function OrderPipeline() {
  const { isAdmin } = useAuth();
  const [view, setView] = useState<'pipeline' | 'delivered'>('pipeline');
  const TABS = [
    { key: 'pipeline' as const, label: 'Pipeline' },
    { key: 'delivered' as const, label: 'Delivered', adminOnly: true },
  ];
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition ${view === t.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === 'delivered' ? <DeliveredCustomers /> : <OrderPipelineContent />}
    </div>
  );
}
