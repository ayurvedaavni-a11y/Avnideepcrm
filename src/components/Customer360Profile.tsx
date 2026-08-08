import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../context/AuthContext';
import X from 'lucide-react/dist/esm/icons/x'
import Package from 'lucide-react/dist/esm/icons/package'
import MapPin from 'lucide-react/dist/esm/icons/map-pin'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Phone from 'lucide-react/dist/esm/icons/phone'
import User from 'lucide-react/dist/esm/icons/user'
import Search from 'lucide-react/dist/esm/icons/search'
import Clock from 'lucide-react/dist/esm/icons/clock'
import IndianRupee from 'lucide-react/dist/esm/icons/indian-rupee'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle'
import Copy from 'lucide-react/dist/esm/icons/copy'
import Edit2 from 'lucide-react/dist/esm/icons/edit-2'
import Save from 'lucide-react/dist/esm/icons/save'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up'
import Lock from 'lucide-react/dist/esm/icons/lock'
import { safeFormat } from '../lib/safeFormat';
import { normalizeShipmentStatus, STATUS_COLORS } from '../db/shipmentEngine';
import { downloadInvoicePDF } from '../db/invoiceEngine';
import { parseAddressDetails, repairCustomerRecord } from '../db/addressRepairEngine';
import { toast } from 'react-hot-toast';
import { BookOrderModal } from './BookOrderModal';

interface Props {
  customerId: number;
  isOpen: boolean;
  onClose: () => void;
}

export function Customer360Profile({ customerId, isOpen, onClose }: Props) {
  const { isAdmin } = useAuth();
  const customer = useLiveQuery(() => db.customers.get(customerId), [customerId]);
  const orders = useLiveQuery(() => db.orders.where('customerId').equals(customerId).reverse().sortBy('orderDate'), [customerId]) || [];
  const invoices = useLiveQuery(() => db.invoices.where('customerId').equals(customerId).toArray(), [customerId]) || [];
  const logs = useLiveQuery(() => db.timelineLogs.where('customerId').equals(customerId).reverse().sortBy('createdAt'), [customerId]) || [];
  const customerLead = useLiveQuery(() => db.leads.where('customerId').equals(customerId).first(), [customerId]);

  const [orderSearch, setOrderSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: '', mobile: '', altMobile: '', address: '', landmark: '',
    city: '', state: '', pincode: '', notes: ''
  });
  const [showBookOrder, setShowBookOrder] = useState(false);
  const [mobileAccordion, setMobileAccordion] = useState<'info' | 'address' | 'orders' | 'timeline' | 'notes'>('info');

  useEffect(() => {
    if (customer && !editing) {
      setForm({
        name: customer.name || '',
        mobile: customer.mobile || '',
        altMobile: customer.alternateNumber || '',
        address: customer.address || '',
        landmark: customer.landmark || '',
        city: customer.city || '',
        state: customer.state || '',
        pincode: customer.pincode || '',
        notes: customer.notes || '',
      });
    }
  }, [customer, editing]);

  if (!isOpen || !customer) return null;

  const totalOrders = customer.totalOrders || 0;
  const delivered = customer.delivered || 0;
  const rto = customer.rto || 0;
  const deliveryPercent = totalOrders > 0 ? Math.round((delivered / totalOrders) * 100) : 0;
  const rtoPercent = totalOrders > 0 ? Math.round((rto / totalOrders) * 100) : 0;
  const avgOrderValue = delivered > 0 ? Math.round((customer.totalSpend || 0) / delivered) : 0;
  const isRepeatBuyer = totalOrders >= 2;
  const isHighRTO = rtoPercent >= 30;

  const filteredOrders = orders.filter(o => {
    if (!orderSearch) return true;
    const s = orderSearch.toLowerCase();
    return o.orderId.toLowerCase().includes(s) || (o.trackingId || '').toLowerCase().includes(s) ||
      o.product.toLowerCase().includes(s) || (o.courier || '').toLowerCase().includes(s);
  });

  const getStatusBadge = (status: string) => {
    const norm = normalizeShipmentStatus(status);
    return STATUS_COLORS[norm] || 'bg-slate-100 text-slate-600';
  };

  const stats = [
    { label: 'Total Orders', value: totalOrders, icon: ShoppingCart, color: 'text-blue-600 bg-blue-50' },
    { label: 'Delivered', value: `${delivered} (${deliveryPercent}%)`, icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'RTO', value: `${rto} (${rtoPercent}%)`, icon: XCircle, color: 'text-red-600 bg-red-50' },
    { label: 'Avg Order', value: `₹${avgOrderValue}`, icon: IndianRupee, color: 'text-purple-600 bg-purple-50' },
  ];

  const handleSave = async () => {
    if (!customer) return;
    try {
      const changes: string[] = [];
      if (form.name !== customer.name) changes.push('name');
      if (form.address !== customer.address) changes.push('address');
      if (form.landmark !== (customer.landmark || '')) changes.push('landmark');
      if (form.city !== (customer.city || '')) changes.push('city');
      if (form.state !== (customer.state || '')) changes.push('state');
      if (form.pincode !== (customer.pincode || '')) changes.push('pincode');
      if (form.altMobile !== (customer.alternateNumber || '')) changes.push('alt mobile');
      if (form.notes !== (customer.notes || '')) changes.push('notes');
      if (!isAdmin && form.mobile !== customer.mobile) {
        toast.error('Mobile number cannot be changed');
        setForm(f => ({ ...f, mobile: customer.mobile }));
        return;
      }

      await db.customers.update(customer.id!, {
        name: form.name,
        mobile: isAdmin ? form.mobile : customer.mobile,
        alternateNumber: form.altMobile || undefined,
        address: form.address || undefined,
        landmark: form.landmark || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        pincode: form.pincode || undefined,
        notes: form.notes || undefined,
        updatedAt: new Date().toISOString(),
      });
      await repairCustomerRecord(customer.id!);

      if (changes.length > 0) {
        await db.timelineLogs.add({
          customerId: customer.id!,
          entityType: 'Customer',
          action: 'Customer Updated',
          notes: `Updated: ${changes.join(', ')}`,
          agentName: isAdmin ? 'Admin' : 'Telecaller',
          createdAt: new Date().toISOString(),
        });
      }

      toast.success('Customer updated');
      setEditing(false);
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(customer.mobile);
      toast.success('Number copied');
    } catch { toast.error('Copy failed'); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end md:items-center justify-center">
      {/* ===== DESKTOP MODAL ===== */}
      <div className="hidden md:flex bg-white rounded-2xl w-full max-w-[1000px] max-h-[90vh] flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 px-6 py-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
                {customer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">{customer.name}</h2>
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  <Phone size={13} /> {customer.mobile}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <a href={`tel:${customer.mobile}`} className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-green-600 hover:bg-green-700 transition">
                    <Phone size={11} className="inline mr-1" />Call
                  </a>
                  <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition">
                    <MessageCircle size={11} className="inline mr-1" />WhatsApp
                  </a>
                  <a href={`sms:+91${customer.mobile}`} className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition">
                    <MessageSquare size={11} className="inline mr-1" />SMS
                  </a>
                  <button onClick={handleCopy} className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition">
                    <Copy size={11} className="inline mr-1" />Copy
                  </button>
                  {customer.riskLevel === 'Fake' && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded"><AlertTriangle size={10} className="inline mr-0.5" />FAKE</span>}
                  {isRepeatBuyer && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">Repeat</span>}
                  {deliveryPercent >= 80 && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">Reliable</span>}
                  {isHighRTO && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">High RTO</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!editing ? (
                <button onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1">
                  <Edit2 size={12} /> Edit
                </button>
              ) : (
                <div className="flex gap-1">
                  <button onClick={handleSave}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1">
                    <Save size={12} /> Save
                  </button>
                  <button onClick={() => { setEditing(false); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-200 text-slate-700 hover:bg-slate-300">
                    Cancel
                  </button>
                </div>
              )}
              <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full transition"><X size={16} className="text-slate-500" /></button>
            </div>
          </div>
          {customer.address && !editing && (
            <div className="mt-2 text-xs text-slate-500 flex items-start gap-1">
              <MapPin size={12} className="mt-0.5 shrink-0" />
              {customer.address}{customer.landmark ? `, ${customer.landmark}` : ''}
            </div>
          )}
        </div>

        {/* Body — responsive grid, only timeline scrolls */}
        <div className="flex-1 overflow-hidden p-5">
          <div className="h-full grid grid-cols-12 gap-5">
            {/* LEFT COLUMN: Address + Stats + Notes */}
            <div className="col-span-4 space-y-4">
              {/* Edit Form (when editing) */}
              {editing ? (
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Edit Details</h3>
                  <EditField label="Full Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
                  <div className="relative">
                    <EditField label="Mobile" value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} readOnly={!isAdmin} />
                    {!isAdmin && <Lock size={12} className="absolute right-2 top-8 text-amber-500" />}
                  </div>
                  <EditField label="Alt Mobile" value={form.altMobile} onChange={v => setForm(f => ({ ...f, altMobile: v }))} />
                  <EditField label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} multiline />
                  <EditField label="Landmark" value={form.landmark} onChange={v => setForm(f => ({ ...f, landmark: v }))} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <EditField label="City" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} />
                    <EditField label="State" value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))} />
                  </div>
                  <EditField label="Pincode" value={form.pincode} onChange={v => setForm(f => ({ ...f, pincode: v }))} />
                  <EditField label="Customer Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} multiline />
                  <button onClick={() => { const p = parseAddressDetails(form.address); setForm(f => ({ ...f, city: f.city || p.city, state: f.state || p.state, pincode: f.pincode || p.pincode })); }}
                    className="w-full px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition">
                    Auto Parse Address
                  </button>
                </div>
              ) : (
                <>
                  {/* Address Card */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <MapPin size={14} className="text-blue-600" />
                      <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Shipping Address</h3>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{customer.address || 'No address'}</p>
                    {customer.landmark && <p className="text-xs text-slate-500 mt-1">📍 {customer.landmark}</p>}
                    <p className="text-xs text-slate-500 mt-1">{[customer.city, customer.state, customer.pincode].filter(Boolean).join(', ') || 'N/A'}</p>
                    <p className="text-[10px] text-slate-400 mt-2">
                      Since {safeFormat(customer.createdAt, 'dd MMM yyyy')}
                      {customer.lastOrderDate && ` • Last: ${safeFormat(customer.lastOrderDate, 'dd MMM yyyy')}`}
                    </p>
                  </div>
                </>
              )}

              {/* Stats Grid (always visible) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {stats.map((s, i) => (
                  <div key={i} className="bg-white rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">{s.label}</span>
                      <div className={`p-1 rounded-md ${s.color}`}><s.icon size={12} /></div>
                    </div>
                    <div className="text-sm font-bold text-slate-800">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN: Orders card + Timeline card */}
            <div className="col-span-8 flex flex-col gap-4 overflow-hidden">
              {/* Orders card */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Package size={14} className="text-blue-600" />
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Orders ({filteredOrders.length})</h3>
                  </div>
                  <button onClick={() => setShowBookOrder(true)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1 transition">
                    <ShoppingCart size={11} /> Book Order
                  </button>
                </div>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                  <input id="customer360-order-search" name="customer360-order-search" aria-label="Search orders" type="text" placeholder="Search orders..." value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="max-h-[200px] overflow-y-auto av-scroll-thin space-y-1.5">
                  {filteredOrders.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No orders</p>}
                  {filteredOrders.map(order => (
                    <div key={order.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full ${getStatusBadge(order.status)} flex items-center justify-center`}>
                          {order.status === 'Delivered' ? <CheckCircle size={12} /> : order.status === 'RTO' || order.status === 'Cancelled' ? <XCircle size={12} /> : <Package size={12} />}
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-slate-800">{order.orderId}</p>
                          <p className="text-[10px] text-slate-500">{order.product} ×{order.qty}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-slate-800">₹{order.codAmount?.toFixed(2)}</p>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getStatusBadge(order.status)}`}>{order.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline card — the only scrollable section */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 flex-1 min-h-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-purple-600" />
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Timeline ({logs.length})</h3>
                  </div>
                  <span className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600">View All</span>
                </div>
                <div className="max-h-[280px] overflow-y-auto av-scroll-thin space-y-0">
                  {logs.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No events</p>}
                  {logs.slice(0, 20).map((log) => (
                    <div key={log.id} className="flex gap-2.5 pb-3 last:pb-0">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0 mt-0.5">
                        {log.entityType === 'Order' ? <Package size={11} /> : log.entityType === 'NDR' ? <AlertTriangle size={11} /> : <User size={11} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-bold text-slate-800">{log.action}</p>
                          <span className="text-[9px] text-slate-400 shrink-0">{safeFormat(log.createdAt, 'dd MMM, hh:mm a')}</span>
                        </div>
                        {log.notes && <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2">{log.notes}</p>}
                        {log.statusFrom && log.statusTo && (
                          <p className="text-[9px] text-slate-500 mt-0.5">
                            <span className="line-through opacity-60">{log.statusFrom}</span> → <span className="font-semibold text-blue-600">{log.statusTo}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 flex items-center gap-2 justify-end shrink-0">
          {isAdmin && <button onClick={() => { const inv = invoices[0]; if (inv) downloadInvoicePDF(inv); else toast('Create Invoice — use Invoice module', { icon: '📄' }); }}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center gap-1 transition">
            <FileText size={12} /> Invoice
          </button>}
          {customerLead && (
            <button onClick={() => setShowBookOrder(true)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1 transition">
              <ShoppingCart size={12} /> Book Order
            </button>
          )}
        </div>
      </div>

      {/* ===== MOBILE BOTTOM SHEET ===== */}
      <div className="md:hidden bg-white w-full max-h-[92vh] rounded-t-3xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-base">{customer.name.charAt(0).toUpperCase()}</div>
              <div>
                <h2 className="text-base font-bold text-slate-900">{customer.name}</h2>
                <p className="text-xs text-slate-500">{customer.mobile}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full"><X size={18} className="text-slate-500" /></button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <a href={`tel:${customer.mobile}`} className="flex-1 py-2 bg-green-600 text-white rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1"><Phone size={14} /> Call</a>
            <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1"><MessageCircle size={14} /> WhatsApp</a>
            <a href={`sms:+91${customer.mobile}`} className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1"><MessageSquare size={14} /> SMS</a>
          </div>
        </div>

        {/* Mobile body — accordion sections */}
        <div className="flex-1 overflow-y-auto av-scroll-thin px-4 py-3 space-y-2">
          {/* Accordion: Customer Info */}
          <AccordionSection label="Customer Info" icon={<User size={14} />} isOpen={mobileAccordion === 'info'} onToggle={() => setMobileAccordion(mobileAccordion === 'info' ? 'orders' : 'info')}>
            <div className="space-y-2 text-sm">
              <Row label="Name" value={customer.name} />
              <Row label="Mobile" value={customer.mobile} />
              <Row label="Alt Mobile" value={customer.alternateNumber || '-'} />
              <Row label="Since" value={safeFormat(customer.createdAt, 'dd MMM yyyy')} />
            </div>
          </AccordionSection>

          {/* Accordion: Address */}
          <AccordionSection label="Address" icon={<MapPin size={14} />} isOpen={mobileAccordion === 'address'} onToggle={() => setMobileAccordion(mobileAccordion === 'address' ? 'orders' : 'address')}>
            <div className="space-y-1 text-sm">
              <p>{customer.address || 'No address'}</p>
              {customer.landmark && <p className="text-xs text-slate-500">📍 {customer.landmark}</p>}
              <p className="text-xs text-slate-500">{[customer.city, customer.state, customer.pincode].filter(Boolean).join(', ') || 'N/A'}</p>
              {!editing && (
                <button onClick={() => setEditing(true)} className="mt-2 text-xs font-bold text-blue-600 hover:underline">✏️ Edit Address</button>
              )}
              {editing && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  <EditField label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} multiline />
                  <EditField label="Landmark" value={form.landmark} onChange={v => setForm(f => ({ ...f, landmark: v }))} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <EditField label="City" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} />
                    <EditField label="State" value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))} />
                  </div>
                  <EditField label="Pincode" value={form.pincode} onChange={v => setForm(f => ({ ...f, pincode: v }))} />
                  <button onClick={handleSave} className="w-full py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1">
                    <Save size={14} /> Save Changes
                  </button>
                </div>
              )}
            </div>
          </AccordionSection>

          {/* Accordion: Orders */}
          <AccordionSection label={`Orders (${orders.length})`} icon={<Package size={14} />} isOpen={mobileAccordion === 'orders'} onToggle={() => setMobileAccordion(mobileAccordion === 'orders' ? 'timeline' : 'orders')}>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {orders.map(order => (
                <div key={order.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full ${getStatusBadge(order.status)} flex items-center justify-center`}>
                      {order.status === 'Delivered' ? <CheckCircle size={14} /> : order.status === 'RTO' || order.status === 'Cancelled' ? <XCircle size={14} /> : <Package size={14} />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800">{order.orderId}</p>
                      <p className="text-[10px] text-slate-500">{order.product} ×{order.qty}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold">₹{order.codAmount?.toFixed(2)}</p>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getStatusBadge(order.status)}`}>{order.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </AccordionSection>

          {/* Accordion: Timeline */}
          <AccordionSection label={`Timeline (${logs.length})`} icon={<Clock size={14} />} isOpen={mobileAccordion === 'timeline'} onToggle={() => setMobileAccordion(mobileAccordion === 'timeline' ? 'notes' : 'timeline')}>
            <div className="max-h-[300px] overflow-y-auto space-y-0">
              {logs.map(log => (
                <div key={log.id} className="flex gap-2.5 pb-3 last:pb-0">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    {log.entityType === 'Order' ? <Package size={11} /> : <User size={11} />}
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-800">{log.action}</p>
                    {log.notes && <p className="text-[10px] text-slate-600">{log.notes}</p>}
                    <p className="text-[9px] text-slate-400 mt-0.5">{safeFormat(log.createdAt, 'dd MMM, hh:mm a')}</p>
                  </div>
                </div>
              ))}
            </div>
          </AccordionSection>

          {/* Accordion: Notes */}
          <AccordionSection label="Notes" icon={<MessageSquare size={14} />} isOpen={mobileAccordion === 'notes'} onToggle={() => setMobileAccordion(mobileAccordion === 'notes' ? 'info' : 'notes')}>
            <div className="text-sm space-y-2">
              <p className="text-slate-600">{customer.notes || 'No notes'}</p>
              <div className="border-t border-slate-200 pt-2 space-y-1 text-xs text-slate-600">
                <p><span className="font-medium">Total Orders:</span> {totalOrders}</p>
                <p><span className="font-medium">Delivered:</span> {delivered} ({deliveryPercent}%)</p>
                <p><span className="font-medium">RTO:</span> {rto} ({rtoPercent}%)</p>
                <p><span className="font-medium">Total Spend:</span> ₹{customer.totalSpend || 0}</p>
                <p><span className="font-medium">Risk Level:</span> {customer.riskLevel}</p>
              </div>
            </div>
          </AccordionSection>
        </div>

        {/* Mobile footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 flex gap-2 shrink-0">
          {customerLead && (
            <button onClick={() => setShowBookOrder(true)}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1">
              <ShoppingCart size={14} /> Book Order
            </button>
          )}
          <button onClick={() => { setEditing(true); }}
            className="flex-1 py-2.5 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1">
            <Edit2 size={14} /> Edit
          </button>
        </div>
      </div>

      {showBookOrder && customerLead && (
        <BookOrderModal leadId={customerLead.id!} onClose={() => setShowBookOrder(false)} />
      )}
    </div>
  );
}

// ===== Helper Components =====

function AccordionSection({ label, icon, isOpen, onToggle, children }: { label: string; icon: ReactNode; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3.5 text-sm font-bold text-slate-800 hover:bg-slate-50 transition">
        <span className="flex items-center gap-2">{icon} {label}</span>
        {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {isOpen && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function EditField({ label, value, onChange, multiline = false, readOnly = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; readOnly?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">{label}</label>
      {multiline ? (
        <textarea className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 resize-none" rows={2} value={value} onChange={e => onChange(e.target.value)} readOnly={readOnly} />
      ) : (
        <input className={`w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 ${readOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
          value={value} onChange={e => onChange(e.target.value)} readOnly={readOnly} />
      )}
    </div>
  );
}
