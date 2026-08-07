import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import X from 'lucide-react/dist/esm/icons/x'
import Package from 'lucide-react/dist/esm/icons/package'
import MapPin from 'lucide-react/dist/esm/icons/map-pin'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Phone from 'lucide-react/dist/esm/icons/phone'
import User from 'lucide-react/dist/esm/icons/user'
import Download from 'lucide-react/dist/esm/icons/download'
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

type ProfileTab = 'orders' | 'timeline' | 'invoices' | 'notes';

export function Customer360Profile({ customerId, isOpen, onClose }: Props) {
  const customer = useLiveQuery(() => db.customers.get(customerId), [customerId]);
  const orders = useLiveQuery(() => db.orders.where('customerId').equals(customerId).reverse().sortBy('orderDate'), [customerId]) || [];
  const invoices = useLiveQuery(() => db.invoices.where('customerId').equals(customerId).toArray(), [customerId]) || [];
  const logs = useLiveQuery(() => db.timelineLogs.where('customerId').equals(customerId).reverse().sortBy('createdAt'), [customerId]) || [];
  const [activeTab, setActiveTab] = useState<ProfileTab>('orders');
  const [orderSearch, setOrderSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', mobile: '', address: '', city: '', state: '', pincode: '' });
  const [showBookOrder, setShowBookOrder] = useState(false);
  const customerLead = useLiveQuery(() => db.leads.where('customerId').equals(customerId).first(), [customerId]);

  useEffect(() => {
    if (customer) {
      setForm({
        name: customer.name || '',
        mobile: customer.mobile || '',
        address: customer.address || '',
        city: customer.city || '',
        state: customer.state || '',
        pincode: customer.pincode || '',
      });
    }
  }, [customer]);

  if (!isOpen || !customer) return null;

  const totalOrders = customer.totalOrders || 0;
  const delivered = customer.delivered || 0;
  const rto = customer.rto || 0;
  const deliveryPercent = totalOrders > 0 ? Math.round((delivered / totalOrders) * 100) : 0;
  const rtoPercent = totalOrders > 0 ? Math.round((rto / totalOrders) * 100) : 0;
  const avgOrderValue = delivered > 0 ? Math.round((customer.totalSpend || 0) / delivered) : 0;
  const isRepeatBuyer = totalOrders >= 2;
  const isHighRTO = rtoPercent >= 30;
  const isVip = (customer.totalSpend || 0) >= 50000;

  const filteredOrders = orders.filter(o => {
    if (!orderSearch) return true;
    const s = orderSearch.toLowerCase();
    return o.orderId.toLowerCase().includes(s) || (o.trackingId || '').toLowerCase().includes(s) || o.product.toLowerCase().includes(s) || (o.courier || '').toLowerCase().includes(s);
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
        
        {/* ===== HEADER ===== */}
        <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xl shrink-0">
                {customer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">{customer.name}</h2>
                <p className="text-sm text-slate-600 flex items-center gap-2 mt-0.5">
                  <Phone size={14} /> {customer.mobile}
                </p>
                {/* One-tap customer actions: Call / WhatsApp / SMS / Copy */}
                <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                  <a href={`tel:${customer.mobile}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-green-600 hover:bg-green-700 shadow-sm transition">
                    <Phone size={13} /> Call
                  </a>
                  <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition">
                    <MessageCircle size={13} /> WhatsApp
                  </a>
                  <a href={`sms:+91${customer.mobile}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition">
                    <MessageSquare size={13} /> SMS
                  </a>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(customer.mobile);
                        toast.success('Number copied: ' + customer.mobile);
                      } catch {
                        toast.error('Copy failed');
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 shadow-sm transition"
                  >
                    <Copy size={13} /> Copy Number
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {customer.riskLevel === 'Fake' && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded flex items-center gap-1"><AlertTriangle size={10} /> FAKE</span>}
                  {isRepeatBuyer && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">Repeat Buyer</span>}
                  {deliveryPercent >= 80 && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">Delivered Buyer</span>}
                  {isHighRTO && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">High RTO Risk</span>}
                  {isVip && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">VIP</span>}
                  {customer.riskLevel === 'High' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded">High Risk</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!editing) {
                    setEditing(true);
                    return;
                  }
                  try {
                    await db.customers.update(customer.id!, {
                      name: form.name,
                      mobile: form.mobile,
                      address: form.address,
                      city: form.city,
                      state: form.state,
                      pincode: form.pincode,
                      updatedAt: new Date().toISOString(),
                    });
                    // Repair/normalize after save
                    await repairCustomerRecord(customer.id!);
                    toast.success('Customer updated');
                    setEditing(false);
                  } catch {
                    toast.error('Failed to update customer');
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
              >
                {editing ? <Save size={12} /> : <Edit2 size={12} />} {editing ? 'Save Customer' : 'Edit Customer'}
              </button>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowBookOrder(true)} className="px-2 py-1 rounded text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1"><ShoppingCart size={10} /> Book Order</button>
                <button onClick={() => { toast('Create Invoice — use Invoice module', { icon: '📄' }); }} className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center gap-1"><FileText size={10} /> Invoice</button>
                <button onClick={() => { toast('Add Followup — use Lead Center', { icon: '💬' }); }} className="px-2 py-1 rounded text-[10px] font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 flex items-center gap-1"><MessageSquare size={10} /> Followup</button>
                <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full transition"><X size={16} className="text-slate-500" /></button>
              </div>
            </div>
          </div>

          {/* Address block */}
          {editing ? (
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="p-2 border border-slate-300 rounded-lg" placeholder="Full Name" />
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="p-2 border border-slate-300 rounded-lg" placeholder="Mobile" />
              <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="p-2 border border-slate-300 rounded-lg col-span-2" rows={2} placeholder="Full Address" />
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="p-2 border border-slate-300 rounded-lg" placeholder="City" />
              <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="p-2 border border-slate-300 rounded-lg" placeholder="State" />
              <input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} className="p-2 border border-slate-300 rounded-lg" placeholder="Pincode" />
              <button
                onClick={() => {
                  const parsed = parseAddressDetails(form.address);
                  setForm({
                    ...form,
                    city: form.city || parsed.city,
                    state: form.state || parsed.state,
                    pincode: form.pincode || parsed.pincode,
                  });
                }}
                className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200"
              >
                Auto Parse Address
              </button>
            </div>
          ) : (
            <>
              {customer.address && (
                <div className="mt-3 text-xs text-slate-500 flex items-start gap-1.5">
                  <MapPin size={12} className="mt-0.5 shrink-0" />
                  {customer.address}
                </div>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                <div><span className="font-medium text-slate-600">City:</span> {customer.city || 'N/A'}</div>
                <div><span className="font-medium text-slate-600">State:</span> {customer.state || 'N/A'}</div>
                <div><span className="font-medium text-slate-600">Pincode:</span> {customer.pincode || 'N/A'}</div>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Customer since {safeFormat(customer.createdAt, 'dd MMM yyyy')}
                {customer.lastOrderDate && <> • Last order: {safeFormat(customer.lastOrderDate, 'dd MMM yyyy')}</>}
              </div>
            </>
          )}
        </div>

        {/* ===== STATS ROW ===== */}
        <div className="grid grid-cols-4 gap-3 p-4 bg-slate-50 border-b border-slate-100">
          {stats.map((s, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">{s.label}</span>
                <div className={`p-1.5 rounded-md ${s.color}`}><s.icon size={14} /></div>
              </div>
              <div className="text-lg font-bold text-slate-800">{s.value}</div>
            </div>
          ))}
        </div>

        {/* ===== TABS ===== */}
        <div className="flex border-b border-slate-200 bg-white px-4">
          <TabBtn active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} icon={Package} label="Orders" count={orders.length} />
          <TabBtn active={activeTab === 'invoices'} onClick={() => setActiveTab('invoices')} icon={FileText} label="Invoices" count={invoices.length} />
          <TabBtn active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={Clock} label="Timeline" count={logs.length} />
          <TabBtn active={activeTab === 'notes'} onClick={() => setActiveTab('notes')} icon={MessageSquare} label="Notes" />
        </div>

        {/* ===== TAB CONTENT ===== */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'orders' && (
            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="Search by Order ID, AWB, Product, Courier..." value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)} className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {filteredOrders.length === 0 && (
                <div className="text-center text-slate-400 py-10 text-sm">No orders found.</div>
              )}
              <div className="space-y-2">
                {filteredOrders.map(order => {
                  return (
                    <div key={order.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-sm transition">
                      <div className="flex justify-between items-start flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full ${getStatusBadge(order.status)} flex items-center justify-center`}>
                            {order.status === 'Delivered' ? <CheckCircle size={18} /> : order.status === 'RTO' || order.status === 'Cancelled' ? <XCircle size={18} /> : <Package size={18} />}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-slate-800">{order.orderId}</div>
                            <div className="text-xs text-slate-500">{order.product} × {order.qty}</div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {order.trackingId && <span className="font-mono">{order.trackingId} • </span>}
                              {order.courier}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-slate-800">₹{order.codAmount?.toFixed(2) || '0.00'}</div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block mt-1 ${getStatusBadge(order.status)}`}>
                            {order.status}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-1">{safeFormat(order.orderDate, 'dd MMM yyyy')}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'invoices' && (
            <div className="p-4 space-y-2">
              {invoices.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">No invoices generated yet.</div>}
              {invoices.map(inv => (
                <div key={inv.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-sm text-slate-800">{inv.invoiceNumber}</div>
                    <div className="text-xs text-slate-500">{inv.product} • {safeFormat(inv.invoiceDate, 'dd MMM yyyy')}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-bold text-slate-800">₹{inv.total?.toFixed(2) || '0.00'}</div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${inv.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700' : inv.paymentStatus === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {inv.paymentStatus}
                      </span>
                    </div>
                    <button onClick={() => downloadInvoicePDF(inv)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" title="Download PDF">
                      <Download size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="p-4">
              {logs.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">No timeline events.</div>}
              <div className="space-y-0">
                {logs.map((log, i) => (
                  <div key={log.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                        {log.entityType === 'Order' ? <Package size={14} /> : log.entityType === 'NDR' ? <AlertTriangle size={14} /> : log.entityType === 'Followup' ? <Phone size={14} /> : <User size={14} />}
                      </div>
                      {i !== logs.length - 1 && <div className="w-0.5 h-full bg-slate-200 my-1"></div>}
                    </div>
                    <div className="pb-4 flex-1">
                      <div className="flex justify-between items-start">
                        <h4 className="text-sm font-bold text-slate-800">{log.action}</h4>
                        <span className="text-[10px] text-slate-400 shrink-0 ml-2">{safeFormat(log.createdAt, 'dd MMM yyyy, hh:mm a')}</span>
                      </div>
                      {log.notes && <p className="text-xs text-slate-600 mt-0.5">{log.notes}</p>}
                      {log.statusFrom && log.statusTo && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          <span className="line-through opacity-60">{log.statusFrom}</span> → <span className="font-semibold text-blue-600">{log.statusTo}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="p-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h4 className="font-bold text-sm text-slate-800 mb-3">Customer Notes</h4>
                <div className="space-y-2 text-sm text-slate-600">
                  {customer.riskLevel === 'Fake' && <p className="text-red-600 font-medium">⚠️ This customer has been marked as FAKE. Future orders should be verified carefully.</p>}
                  {isHighRTO && <p className="text-amber-600 font-medium">⚠️ High RTO rate ({rtoPercent}%). COD orders need prepayment confirmation.</p>}
                  {isRepeatBuyer && <p className="text-emerald-600 font-medium">⭐ Repeat buyer with {totalOrders} orders and ₹{customer.totalSpend} lifetime spend.</p>}
                  {deliveryPercent >= 80 && <p className="text-emerald-600 font-medium">✅ Reliable customer with {deliveryPercent}% delivery success rate.</p>}
                  {!isRepeatBuyer && !isHighRTO && customer.riskLevel !== 'Fake' && <p className="text-slate-500">No special notes for this customer.</p>}
                </div>
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <h5 className="font-bold text-xs text-slate-700 mb-2">Customer Summary</h5>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div><span className="font-medium">Total Orders:</span> {totalOrders}</div>
                    <div><span className="font-medium">Delivered:</span> {delivered}</div>
                    <div><span className="font-medium">RTO:</span> {rto}</div>
                    <div><span className="font-medium">Delivery Rate:</span> {deliveryPercent}%</div>
                    <div><span className="font-medium">RTO Rate:</span> {rtoPercent}%</div>
                    <div><span className="font-medium">Avg Order Value:</span> ₹{avgOrderValue}</div>
                    <div><span className="font-medium">Total Spend:</span> ₹{customer.totalSpend || 0}</div>
                    <div><span className="font-medium">Risk Level:</span> {customer.riskLevel}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showBookOrder && customerLead && (
        <BookOrderModal leadId={customerLead.id!} onClose={() => setShowBookOrder(false)} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label, count }: any) {
  return (
    <button onClick={onClick} className={`px-4 py-3 flex items-center gap-2 text-sm font-bold border-b-2 transition -mb-[1px] ${active ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      <Icon size={16} /> {label}
      {count !== undefined && <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">{count}</span>}
    </button>
  );
}
