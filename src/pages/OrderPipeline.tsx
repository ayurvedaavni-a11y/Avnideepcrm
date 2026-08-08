// AVNIDEEP CRM PRO — Order Management (Single Source of Truth) — ENTERPRISE UI
// Admin workflow: Order Booked → Packing → Packed → Ready To Ship → [Shipped → Logistics]
// Telecaller workflow ends at "Create Order" — they never touch fulfilment statuses.
// The order row (db.orders.status) is the ONLY master status; every page reads it.
//
// This file is a PURE UI/UX redesign. Business logic (NEXT_STATUS_MAP,
// updateOrderStatus, sync-lead-to-order, bulk sync, invoice generation) is
// identical to before — only presentation, filters, DnD and animation changed.

import { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { db, type Lead, type Order } from '../db/db';
import { toast } from 'react-hot-toast';
import Package from 'lucide-react/dist/esm/icons/package'
import Truck from 'lucide-react/dist/esm/icons/truck'
import Check from 'lucide-react/dist/esm/icons/check'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import Edit2 from 'lucide-react/dist/esm/icons/edit-2'
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
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal'
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import User from 'lucide-react/dist/esm/icons/user'
import Zap from 'lucide-react/dist/esm/icons/zap'
import Wallet from 'lucide-react/dist/esm/icons/wallet'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import Clock from 'lucide-react/dist/esm/icons/clock'
import Timer from 'lucide-react/dist/esm/icons/timer'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical'
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid'
import { safeFormat } from '../lib/safeFormat';
import { autoGenerateInvoice, downloadInvoicePDF } from '../db/invoiceEngine';
import { updateOrderStatus, isShipmentStatus } from '../db/workflow';
import { Customer360Profile } from '../components/Customer360Profile';
import { OrderEditModal } from '../components/OrderEditModal';
import { useAuth } from '../context/AuthContext';

// =====================================================================
// Pipeline configuration — status colors, icons, transitions
// =====================================================================
interface StageDef {
  key: string;
  label: string;
  icon: any;
  accent: string;        // text color
  chip: string;          // chip/badge classes
  glow: string;          // column header glow
  headerBg: string;      // column header background
  nextStage: string;
  advanceLabel: string;
}

const PIPELINE_STAGES: StageDef[] = [
  { key: 'Order Booked',     label: 'Order Booked',     icon: ShoppingCart, accent: 'text-amber-600',    chip: 'bg-amber-100 text-amber-800 border-amber-200',    glow: 'shadow-amber-200/60',    headerBg: 'from-amber-50 to-white',    nextStage: 'Packing',      advanceLabel: 'Start Packing' },
  { key: 'Packing',          label: 'Packing',          icon: Package,      accent: 'text-orange-600',   chip: 'bg-orange-100 text-orange-800 border-orange-200',   glow: 'shadow-orange-200/60',   headerBg: 'from-orange-50 to-white',   nextStage: 'Packed',       advanceLabel: 'Mark Packed' },
  { key: 'Packed',           label: 'Packed',           icon: ShieldCheck,  accent: 'text-indigo-600',   chip: 'bg-indigo-100 text-indigo-800 border-indigo-200',   glow: 'shadow-indigo-200/60',   headerBg: 'from-indigo-50 to-white',   nextStage: 'Ready To Ship', advanceLabel: 'Ready To Ship' },
  { key: 'Ready To Ship',    label: 'Ready To Ship',    icon: Send,         accent: 'text-blue-600',     chip: 'bg-blue-100 text-blue-800 border-blue-200',        glow: 'shadow-blue-200/60',     headerBg: 'from-blue-50 to-white',     nextStage: 'Shipped',      advanceLabel: 'Ship → Logistics' },
];

// Shipment statuses shown as mobile chips (read-only here — Logistics owns them)
const SHIPMENT_CHIPS: { key: string; label: string; chip: string }[] = [
  { key: 'Shipped',          label: 'Shipped',          chip: 'bg-blue-100 text-blue-800 border-blue-200' },
  { key: 'In Transit',       label: 'In Transit',       chip: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { key: 'Out For Delivery', label: 'Out For Delivery', chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  { key: 'Delivered',        label: 'Delivered',        chip: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { key: 'RTO',              label: 'RTO',              chip: 'bg-rose-100 text-rose-800 border-rose-200' },
  { key: 'Cancelled',        label: 'Cancelled',        chip: 'bg-slate-100 text-slate-700 border-slate-200' },
];

const NEXT_STATUS_MAP: Record<string, string[]> = {
  'Order Booked':     ['Packing', 'Cancelled'],
  'Packing':          ['Packed', 'Order Booked', 'Cancelled'],
  'Packed':           ['Ready To Ship', 'Packing', 'Cancelled'],
  'Ready To Ship':    ['Shipped', 'Packed', 'Cancelled'],
  'Shipped':          [], // Shipped+ is managed in the Logistics module
  'In Transit':       [],
  'Out For Delivery': [],
  'Delivered':        [],
  'RTO':              [],
  'Cancelled':        [],
};

const PIPELINE_KEYS = PIPELINE_STAGES.map(s => s.key);
const ALL_STATUS_CHIPS = [
  ...PIPELINE_STAGES.map(s => ({ key: s.key, label: s.label, chip: s.chip })),
  ...SHIPMENT_CHIPS,
];

// =====================================================================
// Animated number (counts up to value with rAF — 60fps)
// =====================================================================
function useAnimatedNumber(target: number, duration = 600) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    const to = target;
    if (from === to) { setDisplay(to); return; }
    prevRef.current = to;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

function AnimatedNumber({ value, prefix = '', format = 'compact' }: { value: number; prefix?: string; format?: 'compact' | 'currency' | 'plain' }) {
  const display = useAnimatedNumber(value);
  const formatted = useMemo(() => {
    if (format === 'currency') return '₹' + Math.round(display).toLocaleString('en-IN');
    if (format === 'plain') return Math.round(display).toLocaleString('en-IN');
    // compact: 12.4K / 1.2M
    const abs = Math.abs(display);
    if (abs >= 10000000) return '₹' + (display / 10000000).toFixed(1) + 'Cr';
    if (abs >= 100000) return '₹' + (display / 100000).toFixed(1) + 'L';
    if (abs >= 1000) return (display / 1000).toFixed(1) + 'K';
    return String(Math.round(display));
  }, [display, format]);
  return <span>{prefix}{formatted}</span>;
}

function StatCard({ label, value, icon: Icon, iconClass, format = 'plain', sub }: {
  label: string; value: number; icon: any; iconClass: string; format?: 'compact' | 'currency' | 'plain'; sub?: string;
}) {
  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-3 hover:shadow-md hover:border-slate-300 transition-all duration-200 group">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass} group-hover:scale-110 transition-transform duration-200`}>
        <Icon size={19} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">{label}</p>
        <p className="text-lg font-bold text-slate-900 leading-tight truncate"><AnimatedNumber value={value} format={format} /></p>
        {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// =====================================================================
// Status badge
// =====================================================================
function StatusBadge({ status }: { status: string }) {
  const chip = ALL_STATUS_CHIPS.find(c => c.key === status)?.chip || 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${chip}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority || priority === 'Low') return null;
  const map: Record<string, string> = {
    High: 'bg-red-100 text-red-700 border-red-200',
    Medium: 'bg-amber-100 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black border ${map[priority] || map.Medium}`}>
      <Zap size={9} /> {priority.toUpperCase()}
    </span>
  );
}

function PaymentBadge({ order }: { order: Order }) {
  const isCOD = (order.codAmount || 0) > 0;
  return isCOD ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-slate-900 text-white border border-slate-900">COD</span>
  ) : (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-blue-600 text-white border border-blue-600">PREPAID</span>
  );
}

// =====================================================================
// Admin Desktop Kanban — virtualized column
// =====================================================================
function KanbanColumn({ stage, orders, leadMap, customerMap, onAdvance, onTimeline, onDetail, onDragStart, onDragOver, onDrop, isDropTarget, draggingOrderId }: {
  stage: StageDef;
  orders: any[];
  leadMap: Map<number, Lead>;
  customerMap: Map<number, any>;
  onAdvance: (orderId: number, newStatus: string) => void;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
  onDragStart: (e: React.DragEvent, orderId: number) => void;
  onDragOver: (e: React.DragEvent, stageKey: string) => void;
  onDrop: (e: React.DragEvent, stageKey: string) => void;
  isDropTarget: boolean;
  draggingOrderId: number | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalCod = orders.reduce((s, o) => s + (o.codAmount || 0), 0);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 158,
    overscan: 6,
  });

  return (
    <div
      className={`flex flex-col w-[300px] xl:w-[320px] shrink-0 rounded-2xl border border-slate-200/80 bg-slate-50/60 backdrop-blur shadow-sm transition-all duration-200 ${isDropTarget ? 'av-drop-target ring-2 ring-blue-400/60' : ''}`}
      onDragOver={(e) => onDragOver(e, stage.key)}
      onDrop={(e) => onDrop(e, stage.key)}
    >
      {/* Column header */}
      <div className={`flex-shrink-0 px-4 py-3 rounded-t-2xl bg-gradient-to-b ${stage.headerBg} border-b border-slate-200/80`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center ${stage.accent}`}>
              <stage.icon size={16} />
            </div>
            <div>
              <h3 className={`font-bold text-sm leading-none ${stage.accent}`}>{stage.label}</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-1">₹{totalCod.toLocaleString('en-IN')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded-lg text-xs font-black ${stage.chip}`}>{orders.length}</span>
            {isDropTarget && <span className="text-[9px] font-bold text-blue-600 bg-blue-100 rounded px-1.5 py-0.5 av-pop">DROP</span>}
          </div>
        </div>
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto av-scroll-thin px-2.5 py-2.5 min-h-[220px]">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const order = orders[vi.index];
            return (
              <div
                key={order.id}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                className="pb-2.5"
              >
                <OrderCard
                  order={order}
                  customer={customerMap.get(order.customerId)}
                  lead={leadMap.get(order.leadId!)}
                  stage={stage}
                  onAdvance={onAdvance}
                  onTimeline={onTimeline}
                  onDetail={onDetail}
                  onDragStart={onDragStart}
                  isDragging={draggingOrderId === order.id}
                />
              </div>
            );
          })}
          {orders.length === 0 && (
            <div className="text-center text-slate-400 py-10 text-xs">
              <div className="text-3xl mb-2 opacity-30">—</div>
              No orders
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Order card — glassmorphism, drag source, full info
// =====================================================================
const OrderCard = memo(function OrderCard({ order, customer, lead, stage, onAdvance, onTimeline, onDetail, onDragStart, isDragging }: {
  order: any; customer: any; lead?: Lead; stage: StageDef;
  onAdvance: (orderId: number, newStatus: string) => void;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
  onDragStart: (e: React.DragEvent, orderId: number) => void;
  isDragging: boolean;
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
    let inv = await db.invoices.where('orderId').equals(order.id!).first();
    if (!inv) inv = await autoGenerateInvoice(order.id, 'Admin') || undefined;
    if (inv) downloadInvoicePDF(inv);
  };

  if (!customer) return null;

  const isShippedPlus = isShipmentStatus(order.status);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, order.id!)}
      className={`av-glass group relative rounded-xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-200 overflow-hidden cursor-grab active:cursor-grabbing ${isDragging ? 'av-dragging' : ''}`}
    >
      {/* Accent edge */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${stage.key === 'Order Booked' ? 'from-amber-400 to-orange-400' : stage.key === 'Packing' ? 'from-orange-400 to-red-400' : stage.key === 'Packed' ? 'from-indigo-400 to-blue-400' : 'from-blue-400 to-cyan-400'}`} />

      <div className="pl-3 pr-3 pt-2.5 pb-3">
        {/* Row 1: order id + drag grip + status */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <GripVertical size={13} className="text-slate-300 shrink-0" />
            <span className="text-[10px] font-bold font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md truncate">{order.orderId}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <PaymentBadge order={order} />
            <StatusBadge status={order.status} />
          </div>
        </div>

        {/* Row 2: customer */}
        <div className="mt-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-bold text-slate-800 text-[13px] leading-tight truncate cursor-pointer hover:text-blue-600" onClick={() => onTimeline(order.customerId)}>{customer.name}</h4>
            <a href={`tel:${customer.mobile}`} className="text-[11px] text-slate-500 font-medium flex items-center gap-1 hover:text-blue-600 transition-colors">
              <Phone size={10} /> {customer.mobile}
            </a>
          </div>
          <PriorityBadge priority={lead?.priority} />
        </div>

        {/* Row 3: product + value */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-600 truncate">{order.product} {order.qty > 1 ? `×${order.qty}` : ''}</p>
          <span className="font-black text-slate-900 text-sm shrink-0">₹{order.codAmount?.toLocaleString('en-IN')}</span>
        </div>

        {/* Row 4: meta — telecaller / date / AWB */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {lead?.assignedAgent ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5">
              <User size={9} /> {lead.assignedAgent}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-50 rounded-md px-1.5 py-0.5">
              <User size={9} /> Unassigned
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
            <Clock size={9} /> {safeFormat(order.orderDate, 'dd MMM, hh:mm a')}
          </span>
          {order.courier && <span className="text-[9px] text-slate-400 truncate max-w-[90px]">{order.courier}</span>}
        </div>

        {/* Row 5: actions */}
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
          {/* Advance buttons (pipeline stages only; Shipped+ managed in Logistics) */}
          <div className="flex items-center gap-1 min-w-0">
            {!isShippedPlus && nextOptions.length > 0 && (
              <>
                {nextOptions.slice(0, 2).map(status => (
                  <button
                    key={status}
                    onClick={() => onAdvance(order.id!, status)}
                    className={`text-[9px] font-bold px-2 py-1.5 rounded-lg transition-all duration-150 active:scale-95 ${
                      status === 'Cancelled' || status === 'RTO' || status === 'Undelivered'
                        ? 'bg-red-50 text-red-600 hover:bg-red-100'
                        : status === 'Shipped'
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    {status === stage.nextStage && status !== 'Shipped' ? `→ ${status}` : status === 'Shipped' ? <span className="inline-flex items-center gap-1"><ArrowRight size={9} /> {stage.advanceLabel}</span> : status}
                  </button>
                ))}
                {nextOptions.length > 2 && (
                  <div className="relative">
                    <button onClick={() => setShowActions(!showActions)} aria-label="More actions" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition">
                      <MoreHorizontal size={14} />
                    </button>
                    {showActions && (
                      <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl p-1 z-20 min-w-[130px] av-pop">
                        {nextOptions.slice(2).map(status => (
                          <button key={status} onClick={() => { setShowActions(false); onAdvance(order.id!, status); }}
                            className="block w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-slate-50 text-slate-700 font-medium">
                            {status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {isShippedPlus && (
              <span className="text-[9px] font-semibold text-blue-500 inline-flex items-center gap-1">
                <Truck size={10} /> Logistics
              </span>
            )}
          </div>

          {/* Quick icons */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={handleInvoice} title="Invoice" aria-label="Invoice" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
              <FileText size={14} />
            </button>
            <a href={`tel:${customer.mobile}`} title="Call" aria-label="Call" className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition">
              <Phone size={14} />
            </a>
            <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp" className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition">
              <MessageCircle size={14} />
            </a>
            {order.trackingId && (
              <button onClick={handleCopyAWB} title="Copy AWB" aria-label="Copy AWB" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            )}
            <button onClick={() => onTimeline(order.customerId)} title="Timeline" aria-label="Timeline" className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition">
              <Eye size={14} />
            </button>
            <button onClick={() => onDetail(order.id!)} title="Details" aria-label="Details" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// =====================================================================
// Mobile order card — large touch-friendly, dedicated action row
// =====================================================================
// Read-only shipment tracking shown on the telecaller's My Orders card.
const TRACKING_STEPS = ['Order Booked', 'Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery', 'Delivered'];

function ShipmentSteps({ status }: { status: string }) {
  const idx = TRACKING_STEPS.indexOf(status);
  if (status === 'RTO' || status === 'Cancelled') {
    return (
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${status === 'RTO' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>{status}</span>
        <span className="text-[10px] text-slate-400 font-medium">Shipment tracking ends here</span>
      </div>
    );
  }
  if (idx < 0) {
    return (
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-2">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">{status}</span>
        <span className="text-[10px] text-slate-400 font-medium">Awaiting courier update</span>
      </div>
    );
  }
  return (
    <div className="mt-2.5 pt-2 border-t border-slate-100">
      <div className="flex items-center gap-0.5 overflow-x-auto av-scroll-none pb-0.5">
        {TRACKING_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-0.5 shrink-0">
            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
              i < idx ? 'bg-emerald-100 text-emerald-700'
              : i === idx ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-400'
            }`}>
              {s}
            </span>
            {i < TRACKING_STEPS.length - 1 && (
              <span className={`w-1.5 h-px shrink-0 ${i < idx ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-400 font-medium mt-1">Read-only tracking — status updates automatically</p>
    </div>
  );
}

const MobileOrderCard = memo(function MobileOrderCard({ order, customer, lead, onTimeline, onDetail, canInvoice = false, showTracking = false }: {
  order: any; customer: any; lead?: Lead;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
  canInvoice?: boolean;
  showTracking?: boolean;
}) {
  const handleInvoice = async () => {
    if (!canInvoice) return;
    let inv = await db.invoices.where('orderId').equals(order.id!).first();
    if (!inv) inv = await autoGenerateInvoice(order.id, 'Admin') || undefined;
    if (inv) downloadInvoicePDF(inv);
  };
  if (!customer) return null;

  return (
    <div className="av-glass rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">{order.orderId}</span>
          <StatusBadge status={order.status} />
        </div>
        <div className="mt-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-bold text-slate-900 text-[15px] leading-tight cursor-pointer hover:text-blue-600" onClick={() => onTimeline(order.customerId)}>{customer.name}</h4>
            <p className="text-xs text-slate-500 font-medium mt-0.5">{customer.mobile}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-black text-slate-900 text-base">₹{order.codAmount?.toLocaleString('en-IN')}</p>
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <PaymentBadge order={order} />
              <PriorityBadge priority={lead?.priority} />
            </div>
          </div>
        </div>
        <p className="text-[13px] text-slate-600 mt-1.5 truncate">{order.product} {order.qty > 1 ? `×${order.qty}` : ''}</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
            <User size={10} /> {lead?.assignedAgent || 'Unassigned'}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
            <Calendar size={10} /> {safeFormat(order.orderDate, 'dd MMM, hh:mm a')}
          </span>
          {order.courier && <span className="text-[10px] text-slate-400">{order.courier}</span>}
        </div>
      </div>

      {/* Thumb-friendly action row — Invoice is ADMIN-ONLY (hidden for telecallers) */}
      <div className={`px-3 pb-3 pt-1 grid ${canInvoice ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
        <a href={`tel:${customer.mobile}`} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 active:scale-95 transition-transform">
          <Phone size={18} />
          <span className="text-[10px] font-bold">Call</span>
        </a>
        <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 active:scale-95 transition-transform">
          <MessageCircle size={18} />
          <span className="text-[10px] font-bold">WhatsApp</span>
        </a>
        {canInvoice && (
          <button onClick={handleInvoice} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 active:scale-95 transition-transform">
            <FileText size={18} />
            <span className="text-[10px] font-bold">Invoice</span>
          </button>
        )}
        <button onClick={() => onDetail(order.id!)} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 active:scale-95 transition-transform">
          <Eye size={18} />
          <span className="text-[10px] font-bold">Details</span>
        </button>
      </div>

      {/* Read-only shipment tracking (telecaller My Orders) */}
      {showTracking && <ShipmentSteps status={order.status} />}
    </div>
  );
});

// =====================================================================
// Filter panel
// =====================================================================
interface Filters {
  search: string;
  telecaller: string;
  status: string;
  payment: string;
  courier: string;
  priority: string;
  product: string;
  minAmount: string;
  maxAmount: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { search: '', telecaller: '', status: '', payment: '', courier: '', priority: '', product: '', minAmount: '', maxAmount: '', dateFrom: '', dateTo: '' };

function FilterBar({ filters, setFilters, tcNames, couriers, products, onClear, resultCount, isOpen, onToggle }: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  tcNames: string[];
  couriers: string[];
  products: string[];
  onClear: () => void;
  resultCount: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const activeCount = Object.values(filters).filter(v => v !== '').length;

  const inputCls = 'w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400 transition';
  const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="bg-white/90 backdrop-blur rounded-2xl border border-slate-200/80 shadow-sm">
      {/* Compact trigger row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${isOpen ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[9px] font-black">{activeCount}</span>}
        </button>
        {activeCount > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold text-red-500 hover:bg-red-50 transition">
            <XCircle size={13} /> Clear all
          </button>
        )}
        <div className="ml-auto text-[11px] text-slate-400 font-medium"><AnimatedNumber value={resultCount} format="plain" /> order{resultCount !== 1 ? 's' : ''}</div>
      </div>

      {isOpen && (
        <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 border-t border-slate-100 pt-3 av-fade-in">
          <div>
            <label className={labelCls}>Telecaller</label>
            <select value={filters.telecaller} onChange={e => set({ telecaller: e.target.value })} className={inputCls}>
              <option value="">All telecallers</option>
              {tcNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={filters.status} onChange={e => set({ status: e.target.value })} className={inputCls}>
              <option value="">All statuses</option>
              {ALL_STATUS_CHIPS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Payment</label>
            <select value={filters.payment} onChange={e => set({ payment: e.target.value })} className={inputCls}>
              <option value="">All payments</option>
              <option value="COD">COD</option>
              <option value="Prepaid">Prepaid</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <select value={filters.priority} onChange={e => set({ priority: e.target.value })} className={inputCls}>
              <option value="">All priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Courier</label>
            <select value={filters.courier} onChange={e => set({ courier: e.target.value })} className={inputCls}>
              <option value="">All couriers</option>
              {couriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Product</label>
            <select value={filters.product} onChange={e => set({ product: e.target.value })} className={inputCls}>
              <option value="">All products</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-date-from" className={labelCls}>Date from</label>
            <input id="filter-date-from" name="filter-date-from" type="date" value={filters.dateFrom} onChange={e => set({ dateFrom: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="filter-date-to" className={labelCls}>Date to</label>
            <input id="filter-date-to" name="filter-date-to" type="date" value={filters.dateTo} onChange={e => set({ dateTo: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="filter-min-amount" className={labelCls}>Min ₹</label>
            <input id="filter-min-amount" name="filter-min-amount" type="number" min={0} placeholder="0" value={filters.minAmount} onChange={e => set({ minAmount: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="filter-max-amount" className={labelCls}>Max ₹</label>
            <input id="filter-max-amount" name="filter-max-amount" type="number" min={0} placeholder="No limit" value={filters.maxAmount} onChange={e => set({ maxAmount: e.target.value })} className={inputCls} />
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Main component
// =====================================================================
function OrderPipelineContent() {
  const { isAdmin, profile } = useAuth();
  const allOrders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const allLeads = useLiveQuery<Lead[]>(() => db.leads.toArray(), []) || [];
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [editOrderId, setEditOrderId] = useState<number | null>(null);
  const [activeChip, setActiveChip] = useState('All');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [draggingOrderId, setDraggingOrderId] = useState<number | null>(null);

  const customerMap = useMemo(() => {
    const map = new Map<number, any>();
    allCustomers.forEach(c => { if (c.id) map.set(c.id, c); });
    return map;
  }, [allCustomers]);

  const leadMap = useMemo(() => {
    const map = new Map<number, Lead>();
    allLeads.forEach(l => { if (l.id) map.set(l.id, l); });
    return map;
  }, [allLeads]);

  // Filter option lists
  const tcNames = useMemo(() => {
    const s = new Set<string>();
    allLeads.forEach(l => { if (l.assignedAgent) s.add(l.assignedAgent); });
    return [...s].sort();
  }, [allLeads]);

  const couriers = useMemo(() => {
    const s = new Set<string>();
    allOrders.forEach(o => { if (o.courier) s.add(o.courier); });
    return [...s].sort();
  }, [allOrders]);

  const products = useMemo(() => {
    const s = new Set<string>();
    allOrders.forEach(o => { if (o.product) s.add(o.product); });
    return [...s].sort();
  }, [allOrders]);

  // ===== Master filtered order set (all statuses; admin) =====
  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let list = allOrders;
    if (term) {
      list = list.filter(o => {
        const c = customerMap.get(o.customerId);
        return (
          o.orderId.toLowerCase().includes(term) ||
          o.product.toLowerCase().includes(term) ||
          String(o.codAmount).includes(term) ||
          o.trackingId?.toLowerCase().includes(term) ||
          o.courier?.toLowerCase().includes(term) ||
          c?.name?.toLowerCase().includes(term) ||
          c?.mobile?.includes(term)
        );
      });
    }
    if (filters.telecaller) {
      list = list.filter(o => leadMap.get(o.leadId!)?.assignedAgent === filters.telecaller);
    }
    if (filters.status) list = list.filter(o => o.status === filters.status);
    if (filters.payment === 'COD') list = list.filter(o => (o.codAmount || 0) > 0);
    if (filters.payment === 'Prepaid') list = list.filter(o => (o.codAmount || 0) <= 0);
    if (filters.priority) list = list.filter(o => leadMap.get(o.leadId!)?.priority === filters.priority);
    if (filters.courier) list = list.filter(o => o.courier === filters.courier);
    if (filters.product) list = list.filter(o => o.product === filters.product);
    if (filters.minAmount) list = list.filter(o => (o.codAmount || 0) >= Number(filters.minAmount));
    if (filters.maxAmount) list = list.filter(o => (o.codAmount || 0) <= Number(filters.maxAmount));
    if (filters.dateFrom || filters.dateTo) {
      list = list.filter(o => {
        const d = new Date(o.orderDate).getTime();
        if (filters.dateFrom && d < new Date(filters.dateFrom + 'T00:00:00').getTime()) return false;
        if (filters.dateTo && d > new Date(filters.dateTo + 'T23:59:59').getTime()) return false;
        return true;
      });
    }
    return list;
  }, [allOrders, searchTerm, filters, customerMap, leadMap]);

  // Pipeline orders (4 admin columns)
  const pipelineOrders = useMemo(() => filteredOrders.filter(o => PIPELINE_KEYS.includes(o.status)), [filteredOrders]);

  const columnOrders = useMemo(() => {
    const map: Record<string, any[]> = {};
    PIPELINE_KEYS.forEach(s => { map[s] = []; });
    pipelineOrders.forEach(o => { if (map[o.status]) map[o.status].push(o); });
    return map;
  }, [pipelineOrders]);

  // Shipped+ (managed in Logistics)
  const shippedPlus = useMemo(() => filteredOrders.filter(o => isShipmentStatus(o.status)), [filteredOrders]);

  // ===== Stats (from ALL orders, date-filter-aware via master filter) =====
  const todayStr = new Date().toDateString();
  const stats = useMemo(() => {
    const all = allOrders;
    const today = all.filter(o => {
      try { return new Date(o.orderDate).toDateString() === todayStr; } catch { return false; }
    }).length;
    const deliveredToday = all.filter(o => o.status === 'Delivered' && (() => { try { return new Date(o.updatedAt).toDateString() === todayStr; } catch { return false; } })()).length;
    const revenue = all.filter(o => o.status === 'Delivered').reduce((s, o) => s + (o.codAmount || 0), 0);
    const deliveredCount = all.filter(o => o.status === 'Delivered').length;
    const codPipeline = pipelineOrders.reduce((s, o) => s + (o.codAmount || 0), 0);
    return {
      today,
      pending: all.filter(o => o.status === 'Order Booked').length,
      packing: all.filter(o => o.status === 'Packing').length,
      readyToShip: all.filter(o => o.status === 'Ready To Ship').length,
      deliveredToday,
      cancelled: all.filter(o => o.status === 'Cancelled').length,
      codPipeline,
      revenue,
      aov: deliveredCount > 0 ? Math.round(revenue / deliveredCount) : 0,
    };
  }, [allOrders, pipelineOrders, todayStr]);

  // ===== Telecaller view data =====
  const tcLeads = useMemo(
    () => profile && !isAdmin ? allLeads.filter(l => String(l.assignedTo || '') === String(profile.id) || (!l.assignedTo && String(l.assignedAgent || '') === String(profile.full_name))) : [],
    [profile, isAdmin, allLeads]
  );
  const tcLeadIds = useMemo(() => new Set(tcLeads.map(l => l.id)), [tcLeads]);
  const tcOrders = useMemo(() => {
    if (isAdmin) return [];
    return allOrders.filter(o => o.leadId != null && tcLeadIds.has(o.leadId));
  }, [allOrders, tcLeadIds, isAdmin]);

  const leadsReady = useMemo(
    () => (isAdmin ? allLeads.filter(l => l.status === 'Order Booked') : []),
    [isAdmin, allLeads]
  );

  const handleViewTimeline = useCallback((customerId: number) => setSelectedCustomerId(customerId), []);

  const handleViewDetail = useCallback((orderId: number) => setDetailOrderId(orderId), []);

  // ===== Business logic — unchanged =====
  const handleSyncLeadToOrder = async (leadId: number) => {
    try {
      const lead = await db.leads.get(leadId);
      if (!lead) return;
      const existingOrder = await db.orders.where('leadId').equals(leadId).first();
      if (existingOrder) { toast.error('Order already exists for this lead'); return; }
      const orderId = `AVN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`;
      const nowIso = new Date().toISOString();
      const id = await db.orders.add({
        orderId,
        leadId: lead.id,
        customerId: lead.customerId,
        product: lead.product,
        qty: 1,
        codAmount: lead.expectedAmount,
        status: 'Order Booked',
        orderDate: nowIso,
        bookedBy: lead.assignedTo || undefined,
        bookedByName: lead.assignedAgent || undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
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
      if (!existing) { await handleSyncLeadToOrder(lead.id!); count++; }
    }
    if (count > 0) toast.success(`Synced ${count} leads`);
    else toast('No pending leads to sync', { icon: 'ℹ️' });
  };

  const handleAdvanceOrder = useCallback(async (orderId: number, newStatus: string) => {
    try {
      const order = await db.orders.get(orderId);
      if (!order) return;
      const meta: any = { agentName: profile?.full_name || 'Admin' };
      if (newStatus === 'Shipped' && !order.trackingId) {
        meta.shipmentDate = new Date().toISOString();
      }
      const r = await updateOrderStatus(orderId, newStatus, meta);
      if (r.changed) {
        toast.success(newStatus === 'Shipped' ? 'Order moved to Logistics (Shipped)' : `Order moved to ${newStatus}`);
      }
    } catch (e) {
      toast.error('Failed to update order status');
    }
  }, [profile]);

  // ===== Drag & drop handlers =====
  const handleDragStart = useCallback((e: React.DragEvent, orderId: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(orderId));
    setDraggingOrderId(orderId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(stageKey);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    setDropTarget(null);
    setDraggingOrderId(null);
    const raw = e.dataTransfer.getData('text/plain');
    const orderId = Number(raw);
    if (!orderId) return;
    void (async () => {
      const order = await db.orders.get(orderId);
      if (!order) return;
      if (order.status === stageKey) { toast('Already in ' + stageKey, { icon: 'ℹ️' }); return; }
      // Only allow transitions that exist in the workflow map (business logic)
      const allowed = NEXT_STATUS_MAP[order.status] || [];
      if (!allowed.includes(stageKey)) {
        toast.error(`Cannot move from "${order.status}" to "${stageKey}"`);
        return;
      }
      await handleAdvanceOrder(orderId, stageKey);
    })();
  }, [handleAdvanceOrder]);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchTerm('');
  }, []);

  // ================================================================
  // TELECALLER VIEW — clean card grid (read-only)
  // ================================================================
  if (!isAdmin) {
    return (
      <div className="space-y-5 av-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="text-blue-600" size={26} /> My Orders
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">{tcOrders.length} order(s) booked from your leads</p>
          </div>
        </div>
        {tcOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-200">
            <ShoppingCart size={40} className="text-slate-300 mb-3" />
            <p className="font-medium">No orders yet</p>
            <p className="text-xs mt-1">Orders created with 'Order Booked' status in the Lead Center will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 av-stagger">
            {tcOrders.map(order => (
              <MobileOrderCard
                key={order.id}
                order={order}
                customer={customerMap.get(order.customerId)}
                lead={leadMap.get(order.leadId!)}
                onTimeline={handleViewTimeline}
                onDetail={handleViewDetail}
                canInvoice={false}
                showTracking
              />
            ))}
          </div>
        )}
        {selectedCustomerId && (
          <Customer360Profile customerId={selectedCustomerId} isOpen onClose={() => setSelectedCustomerId(null)} />
        )}
        {detailOrderId && (
          <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} onEdit={undefined} canInvoice={isAdmin} />
        )}
      </div>
    );
  }

  // ================================================================
  // ADMIN VIEW
  // ================================================================
  return (
    <div className="h-full flex flex-col gap-4">
      {/* Sticky header */}
      <div className="flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-blue-200">
                <LayoutGrid size={18} />
              </div>
              Order Pipeline
            </h1>
            <p className="text-slate-500 text-sm mt-1 flex items-center gap-1.5">
              <Sparkles size={12} className="text-blue-400" />
              {pipelineOrders.length} active · {shippedPlus.length} Shipped+ (Logistics) · {leadsReady.length} leads ready to sync
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                id="order-search"
                name="order-search"
                type="text"
                placeholder="Search name, mobile, order, AWB, product..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                aria-label="Search orders"
                className="pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm w-64 lg:w-80 bg-white shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition placeholder:text-slate-400"
              />
            </div>
            <button onClick={handleBulkSyncLeads}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl hover:from-slate-800 hover:to-slate-700 transition shadow-md shadow-slate-200 text-sm font-semibold active:scale-95">
              <RefreshCw size={15} /> Sync Leads
              {leadsReady.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-black">{leadsReady.length}</span>}
            </button>
          </div>
        </div>

        {/* Stats row — animated counters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          <StatCard label="Today's Orders" value={stats.today} icon={ShoppingCart} iconClass="bg-amber-50 text-amber-600" />
          <StatCard label="Pending" value={stats.pending} icon={Timer} iconClass="bg-blue-50 text-blue-600" />
          <StatCard label="Packing" value={stats.packing} icon={Package} iconClass="bg-orange-50 text-orange-600" />
          <StatCard label="Ready To Ship" value={stats.readyToShip} icon={Send} iconClass="bg-indigo-50 text-indigo-600" />
          <StatCard label="Delivered Today" value={stats.deliveredToday} icon={Check} iconClass="bg-emerald-50 text-emerald-600" />
          <StatCard label="Cancelled" value={stats.cancelled} icon={XCircle} iconClass="bg-red-50 text-red-600" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatCard label="Pipeline COD Value" value={stats.codPipeline} icon={Wallet} iconClass="bg-blue-50 text-blue-600" format="compact" />
          <StatCard label="Revenue (Delivered)" value={stats.revenue} icon={TrendingUp} iconClass="bg-emerald-50 text-emerald-600" format="compact" />
          <StatCard label="Average Order Value" value={stats.aov} icon={Zap} iconClass="bg-purple-50 text-purple-600" format="currency" />
        </div>

        {/* Filters */}
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          tcNames={tcNames}
          couriers={couriers}
          products={products}
          onClear={clearFilters}
          resultCount={filteredOrders.length}
          isOpen={filtersOpen}
          onToggle={() => setFiltersOpen(!filtersOpen)}
        />
      </div>

      {/* Kanban board — desktop only. Mobile gets chips + cards below. */}
      <div className="flex-1 min-h-0 lg:block hidden">
        <div className="h-full overflow-x-auto av-scroll-thin pb-2">
          <div className="flex gap-3.5 h-full min-w-max pr-2">
            {PIPELINE_STAGES.map(stage => (
              <KanbanColumn
                key={stage.key}
                stage={stage}
                orders={columnOrders[stage.key] || []}
                leadMap={leadMap}
                customerMap={customerMap}
                onAdvance={handleAdvanceOrder}
                onTimeline={handleViewTimeline}
                onDetail={handleViewDetail}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDropTarget={dropTarget === stage.key}
                draggingOrderId={draggingOrderId}
              />
            ))}

            {/* Shipped+ summary column (read-only pointer to Logistics) */}
            {shippedPlus.length > 0 && (
              <div className="flex flex-col w-[300px] shrink-0 rounded-2xl border border-dashed border-blue-300/70 bg-blue-50/40 p-4 items-center justify-center text-center">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white flex items-center justify-center shadow-lg shadow-blue-200 mb-2">
                  <Truck size={20} />
                </div>
                <p className="font-bold text-blue-700 text-sm">{shippedPlus.length} order(s) Shipped+</p>
                <p className="text-[11px] text-blue-500 mt-1">Managed in the Courier Management (Logistics) module.</p>
                <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                  {SHIPMENT_CHIPS.filter(c => shippedPlus.some(o => o.status === c.key)).map(c => {
                    const n = shippedPlus.filter(o => o.status === c.key).length;
                    return <span key={c.key} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${c.chip}`}>{c.label} · {n}</span>;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile board — status chips + touch cards (virtualized) */}
      <MobileBoard
        orders={filteredOrders}
        activeChip={activeChip}
        setActiveChip={setActiveChip}
        leadMap={leadMap}
        customerMap={customerMap}
        onTimeline={handleViewTimeline}
        onDetail={handleViewDetail}
        canInvoice={isAdmin}
      />

      {/* Modals */}
      {selectedCustomerId && (
        <Customer360Profile customerId={selectedCustomerId} isOpen={true} onClose={() => setSelectedCustomerId(null)} />
      )}
      {detailOrderId && (
        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} onEdit={() => setEditOrderId(detailOrderId)} canInvoice={isAdmin} />
      )}
      {editOrderId && (
        <OrderEditModal orderId={editOrderId} onClose={() => setEditOrderId(null)} />
      )}
    </div>
  );
}

// =====================================================================
// Mobile board — status chips + virtualized touch cards
// =====================================================================
function MobileBoard({ orders, activeChip, setActiveChip, leadMap, customerMap, onTimeline, onDetail, canInvoice = true }: {
  orders: any[];
  activeChip: string;
  setActiveChip: (c: string) => void;
  leadMap: Map<number, Lead>;
  customerMap: Map<number, any>;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
  canInvoice?: boolean;
}) {
  const chipCounts = useMemo(() => {
    const m: Record<string, number> = {};
    orders.forEach(o => { m[o.status] = (m[o.status] || 0) + 1; });
    return m;
  }, [orders]);

  const visible = useMemo(() => {
    if (activeChip === 'All') return orders;
    return orders.filter(o => o.status === activeChip);
  }, [orders, activeChip]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 214,
    overscan: 5,
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:hidden">
      {/* Status chips — horizontal scroll */}
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto av-scroll-none px-1 pb-3">
        <button onClick={() => setActiveChip('All')}
          className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 ${
            activeChip === 'All' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}>
          All · {orders.length}
        </button>
        {ALL_STATUS_CHIPS.map(c => (
          <button key={c.key} onClick={() => setActiveChip(c.key)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold border transition-all active:scale-95 ${
              activeChip === c.key ? `${c.chip} ring-2 ring-slate-900/20 shadow-md` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            {c.label} · {chipCounts[c.key] || 0}
          </button>
        ))}
      </div>

      {/* Virtualized cards */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto av-scroll-thin pb-2">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vi => {
            const order = visible[vi.index];
            return (
              <div key={order.id} data-index={vi.index} ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                className="pb-2.5">
                <MobileOrderCard
                  order={order}
                  customer={customerMap.get(order.customerId)}
                  lead={leadMap.get(order.leadId!)}
                  onTimeline={onTimeline}
                  onDetail={onDetail}
                  canInvoice={canInvoice}
                />
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <ShoppingCart size={36} className="text-slate-300 mb-3" />
              <p className="font-medium">No orders in "{activeChip}"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Order detail modal — redesigned vertical timeline
// =====================================================================
function timelineStyle(action: string): { icon: any; color: string; bg: string; ring: string } {
  const a = action.toLowerCase();
  if (a.includes('deliver')) return { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-100', ring: 'ring-emerald-200' };
  if (a.includes('ship')) return { icon: Send, color: 'text-blue-600', bg: 'bg-blue-100', ring: 'ring-blue-200' };
  if (a.includes('pack')) return { icon: Package, color: 'text-orange-600', bg: 'bg-orange-100', ring: 'ring-orange-200' };
  if (a.includes('rto') || a.includes('return')) return { icon: Truck, color: 'text-rose-600', bg: 'bg-rose-100', ring: 'ring-rose-200' };
  if (a.includes('cancel')) return { icon: XCircle, color: 'text-slate-600', bg: 'bg-slate-100', ring: 'ring-slate-200' };
  if (a.includes('transit') || a.includes('out for')) return { icon: Truck, color: 'text-indigo-600', bg: 'bg-indigo-100', ring: 'ring-indigo-200' };
  if (a.includes('book') || a.includes('generate') || a.includes('convert')) return { icon: ShoppingCart, color: 'text-amber-600', bg: 'bg-amber-100', ring: 'ring-amber-200' };
  if (a.includes('invoice')) return { icon: FileText, color: 'text-violet-600', bg: 'bg-violet-100', ring: 'ring-violet-200' };
  return { icon: Clock, color: 'text-slate-500', bg: 'bg-slate-100', ring: 'ring-slate-200' };
}

function OrderDetailModal({ orderId, onClose, onEdit, canInvoice = true }: { orderId: number; onClose: () => void; onEdit?: () => void; canInvoice?: boolean }) {
  const order = useLiveQuery(() => db.orders.get(orderId), [orderId]);
  const customer = useLiveQuery(() => order ? db.customers.get(order.customerId) : undefined, [order]);
  const lead = useLiveQuery(() => (order?.leadId ? db.leads.get(order.leadId) : undefined), [order]);
  const timeline = useLiveQuery(() =>
    order ? db.timelineLogs
      .filter(l => (l.entityType === 'Order' && l.entityId === order.id) || l.customerId === order.customerId)
      .reverse().sortBy('createdAt') : [],
    [order]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!order || !customer) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Order details">
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] sm:rounded-3xl rounded-t-3xl flex flex-col shadow-2xl av-slide-up sm:av-zoom-in">
        {/* Header */}
        <div className="p-6 pb-5 border-b border-slate-100 flex justify-between flex-wrap gap-2 items-start bg-gradient-to-br from-slate-50 to-white rounded-t-3xl">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-black text-slate-900">{customer.name}</h2>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-slate-500 mt-1">{customer.mobile} · <span className="font-mono font-semibold">{order.orderId}</span></p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 rounded-lg px-2 py-1"><Calendar size={11} className="inline mr-1" />{safeFormat(order.orderDate, 'dd MMM yyyy, hh:mm a')}</span>
              {lead?.assignedAgent && <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 rounded-lg px-2 py-1"><User size={11} className="inline mr-1" />{lead.assignedAgent}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2.5 hover:bg-slate-200 rounded-full transition"><X size={20} className="text-slate-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto av-scroll-thin p-6 space-y-6">
          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Product</p>
              <p className="font-bold text-slate-800 mt-1 text-[13px] leading-tight">{order.product} ×{order.qty}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Amount</p>
              <p className="font-black text-slate-800 mt-1 text-[13px]">₹{order.codAmount?.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Courier</p>
              <p className="font-bold text-slate-800 mt-1 text-[13px] truncate">{order.courier || 'Not assigned'}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Tracking / AWB</p>
              <p className="font-bold text-slate-800 mt-1 text-[13px] font-mono truncate">{order.trackingId || <span className="text-amber-600 text-[11px]">Tracking ID not assigned yet</span>}</p>
            </div>
          </div>

          {customer.address && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Shipping Address</p>
              <p className="text-sm text-slate-700 leading-relaxed">{customer.address}</p>
              <p className="text-sm text-slate-500">{customer.city}, {customer.state} - {customer.pincode}</p>
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Order Timeline
              </h4>
              <span className="text-[10px] text-slate-400">{timeline?.length || 0} events</span>
            </div>
            <div className="relative">
              {/* vertical line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200" />
              <div className="space-y-0">
                {timeline?.map((entry: any, idx: number) => {
                  const st = timelineStyle(entry.action || '');
                  const Icon = st.icon;
                  const isLast = idx === (timeline?.length || 0) - 1;
                  return (
                    <div key={entry.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                      <div className={`relative z-10 w-[31px] h-[31px] rounded-full flex items-center justify-center shrink-0 ${st.bg} ring-4 ring-white ${st.ring}`}>
                        <Icon size={14} className={st.color} />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-bold text-slate-800">{entry.action}</p>
                          {entry.statusFrom && entry.statusTo && (
                            <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                              {entry.statusFrom} <ArrowRight size={9} /> {entry.statusTo}
                            </span>
                          )}
                        </div>
                        {entry.notes && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{entry.notes}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={9} />{safeFormat(entry.createdAt, 'dd MMM yyyy, hh:mm a')}</span>
                          {entry.agentName && <span className="text-[10px] text-slate-400 flex items-center gap-1"><User size={9} />{entry.agentName}</span>}
                        </div>
                      </div>
                      {!isLast && <div className="absolute left-[31px] top-[31px] bottom-0 w-px bg-slate-100" />}
                    </div>
                  );
                })}
                {(!timeline || timeline.length === 0) && (
                  <p className="text-sm text-slate-400 italic pl-12">No timeline events yet</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 rounded-b-3xl grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <a href={`tel:${customer.mobile}`} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 font-bold text-xs hover:bg-green-100 transition active:scale-95">
            <Phone size={15} /> Call
          </a>
          <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-xs hover:bg-emerald-100 transition active:scale-95">
            <MessageCircle size={15} /> WhatsApp
          </a>
          {canInvoice && (
            <button onClick={() => { const inv = db.invoices.where('orderId').equals(order.id!).first(); inv.then(i => { if (i) downloadInvoicePDF(i); else autoGenerateInvoice(order.id!, 'Admin').then(g => g && downloadInvoicePDF(g)); }); }}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs hover:bg-blue-100 transition active:scale-95">
              <FileText size={15} /> Invoice
            </button>
          )}
          {onEdit && (
            <button onClick={onEdit} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 font-bold text-xs hover:bg-amber-100 transition active:scale-95">
              <Edit2 size={15} /> Edit
            </button>
          )}
          <button onClick={() => { onClose(); }} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-slate-600 border border-slate-200 font-bold text-xs hover:bg-slate-100 transition active:scale-95">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Export
// =====================================================================
export function OrderPipeline() {
  return <OrderPipelineContent />;
}
