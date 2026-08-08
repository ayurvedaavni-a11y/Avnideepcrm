import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import X from 'lucide-react/dist/esm/icons/x'
import Save from 'lucide-react/dist/esm/icons/save'
import { toast } from 'react-hot-toast';

interface Props {
  orderId: number;
  onClose: () => void;
}

export function OrderEditModal({ orderId, onClose }: Props) {
  const order = useLiveQuery(() => db.orders.get(orderId), [orderId]);
  const customer = useLiveQuery(() => order ? db.customers.get(order.customerId) : undefined, [order]);

  const [form, setForm] = useState({
    // Customer fields
    name: '', address: '', landmark: '', city: '', state: '', pincode: '',
    // Order fields
    product: '', qty: 1, codAmount: 0, discount: 0, deliveryCharge: 0,
    courier: '', trackingId: '', paymentMode: 'COD' as 'COD' | 'Prepaid',
    specialInstructions: '', orderNotes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (order && customer) {
      setForm({
        name: customer.name || '',
        address: customer.address || '',
        landmark: customer.landmark || '',
        city: customer.city || '',
        state: customer.state || '',
        pincode: customer.pincode || '',
        product: order.product || '',
        qty: order.qty || 1,
        codAmount: order.codAmount || 0,
        discount: order.discount || 0,
        deliveryCharge: order.deliveryCharge || 0,
        courier: order.courier || '',
        trackingId: order.trackingId || '',
        paymentMode: order.paymentMode || 'COD',
        specialInstructions: order.specialInstructions || '',
        orderNotes: order.orderNotes || '',
      });
    }
  }, [order, customer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!order || !customer) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();

      // 1. Update Customer
      await db.customers.update(customer.id!, {
        name: form.name,
        address: form.address || undefined,
        landmark: form.landmark || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        pincode: form.pincode || undefined,
        updatedAt: now,
      });

      // 2. Update Order
      await db.orders.update(order.id!, {
        product: form.product,
        qty: form.qty,
        codAmount: form.codAmount,
        discount: form.discount || 0,
        deliveryCharge: form.deliveryCharge || 0,
        courier: form.courier || undefined,
        trackingId: form.trackingId || undefined,
        paymentMode: form.paymentMode,
        specialInstructions: form.specialInstructions || undefined,
        orderNotes: form.orderNotes || undefined,
        updatedAt: now,
      });

      // 3. Timeline entry
      await db.timelineLogs.add({
        customerId: customer.id!,
        entityType: 'Order',
        entityId: order.id!,
        action: 'Order Edited by Admin',
        notes: `Order ${order.orderId} was edited`,
        agentName: 'Admin',
        createdAt: now,
      });

      toast.success('Order updated successfully');
      onClose();
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-800">Edit Order — {order.orderId}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full transition"><X size={18} className="text-slate-500" /></button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto av-scroll-thin p-5 space-y-6">
          {/* Customer Section */}
          <div>
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Customer Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
              <Field label="City" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} />
              <Field label="State" value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))} />
              <Field label="Pincode" value={form.pincode} onChange={v => setForm(f => ({ ...f, pincode: v }))} />
              <div className="col-span-2">
                <Field label="Full Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} multiline />
              </div>
              <div className="col-span-2">
                <Field label="Landmark" value={form.landmark} onChange={v => setForm(f => ({ ...f, landmark: v }))} />
              </div>
            </div>
          </div>

          {/* Order Section */}
          <div>
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Order Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Product" value={form.product} onChange={v => setForm(f => ({ ...f, product: v }))} />
              <Field label="Qty" type="number" value={form.qty} onChange={v => setForm(f => ({ ...f, qty: Number(v) }))} />
              <Field label="COD Amount" type="number" value={form.codAmount} onChange={v => setForm(f => ({ ...f, codAmount: Number(v) }))} />
              <Field label="Discount" type="number" value={form.discount} onChange={v => setForm(f => ({ ...f, discount: Number(v) }))} />
              <Field label="Delivery Charge" type="number" value={form.deliveryCharge} onChange={v => setForm(f => ({ ...f, deliveryCharge: Number(v) }))} />
              <Field label="Payment Mode" value={form.paymentMode} onChange={v => setForm(f => ({ ...f, paymentMode: v as 'COD' | 'Prepaid' }))} />
              <Field label="Courier" value={form.courier} onChange={v => setForm(f => ({ ...f, courier: v }))} />
              <Field label="Tracking ID" value={form.trackingId} onChange={v => setForm(f => ({ ...f, trackingId: v }))} />
              <div className="col-span-2">
                <Field label="Special Instructions" value={form.specialInstructions} onChange={v => setForm(f => ({ ...f, specialInstructions: v }))} multiline />
              </div>
              <div className="col-span-2">
                <Field label="Order Notes" value={form.orderNotes} onChange={v => setForm(f => ({ ...f, orderNotes: v }))} multiline />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-6 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-8 py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-2 hover:scale-105 active:scale-95 transition disabled:opacity-50">
            <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', multiline = false }: {
  label: string; value: any; onChange: (v: string) => void; type?: string; multiline?: boolean;
}) {
  return (
    <div>
      <label htmlFor={`ordedit-${label}`} className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">{label}</label>
      {multiline ? (
        <textarea id={`ordedit-${label}`} name={`ordedit-${label}`} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" rows={2} value={value} onChange={e => onChange(e.target.value)} />
      ) : (
        <input id={`ordedit-${label}`} name={`ordedit-${label}`} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
          type={type} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}