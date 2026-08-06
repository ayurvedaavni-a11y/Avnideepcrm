import { useEffect, useState } from 'react';
import { db, Customer } from '../db/db';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import X from 'lucide-react/dist/esm/icons/x'
import Package from 'lucide-react/dist/esm/icons/package'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import Receipt from 'lucide-react/dist/esm/icons/receipt'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'

interface Props {
  customer: Customer;
  onMerge: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

export function DuplicateCustomerAlert({ customer, onMerge, onContinue, onCancel }: Props) {
  const [orders, setOrders] = useState<any[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const o = await db.orders.where('customerId').equals(customer.id!).reverse().sortBy('orderDate');
      setOrders(o);
      const inv = await db.invoices
        .where('customerId').equals(customer.id!)
        .filter(i => ['Pending', 'COD Pending', 'Partial Paid'].includes(i.paymentStatus) && i.status !== 'Cancelled')
        .toArray();
      setPendingInvoices(inv);
    })();
  }, [customer.id]);

  const isFake = customer.riskLevel === 'Fake';
  const isHighRisk = customer.riskLevel === 'High' || customer.riskLevel === 'Critical';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className={`p-5 border-b ${isFake ? 'bg-red-50 border-red-200' : isHighRisk ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'} rounded-t-2xl flex justify-between items-start`}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={28} className={isFake ? 'text-red-600' : isHighRisk ? 'text-amber-600' : 'text-blue-600'} />
            <div>
              <h2 className="text-xl font-bold text-slate-900">Existing Customer Found</h2>
              <p className="text-sm text-slate-600 mt-0.5">
                {isFake ? '⚠ WARNING: This customer is BLACKLISTED as fake.' :
                 isHighRisk ? '⚠ HIGH RISK customer with previous RTOs.' :
                 'A customer with this mobile number already exists.'}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/50 rounded-full">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Customer Card */}
        <div className="p-5 border-b border-slate-100">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Customer</div>
                <div className="text-lg font-bold text-slate-900">{customer.name}</div>
                <div className="text-sm text-slate-600">{customer.mobile}</div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                isFake ? 'bg-red-600 text-white' :
                isHighRisk ? 'bg-amber-100 text-amber-700' :
                'bg-emerald-100 text-emerald-700'
              }`}>
                {customer.riskLevel} Risk
              </span>
            </div>

            {(customer.address || customer.city) && (
              <div className="text-xs text-slate-600 border-t border-slate-200 pt-2">
                📍 {[customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ')}
              </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <StatTile icon={Package} label="Total Orders" value={customer.totalOrders || 0} color="text-blue-600 bg-blue-50" />
            <StatTile icon={CheckCircle} label="Delivered" value={customer.delivered || 0} color="text-emerald-600 bg-emerald-50" />
            <StatTile icon={XCircle} label="RTO" value={customer.rto || 0} color="text-red-600 bg-red-50" />
            <StatTile icon={Receipt} label="Lifetime ₹" value={`${customer.totalSpend || 0}`} color="text-purple-600 bg-purple-50" />
          </div>

          {/* Pending Invoices Alert */}
          {pendingInvoices.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="font-bold text-amber-800 text-sm flex items-center gap-2 mb-1">
                <Receipt size={14} /> {pendingInvoices.length} Pending Invoice{pendingInvoices.length !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-amber-700">
                Total pending: ₹{pendingInvoices.reduce((s, i) => s + (i.balanceDue ?? i.total), 0).toFixed(2)}
              </div>
            </div>
          )}

          {/* Recent Orders */}
          {orders.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Recent Order History (last 5)</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {orders.slice(0, 5).map(o => (
                  <div key={o.id} className="flex justify-between items-center bg-white border border-slate-100 rounded-lg px-3 py-2 text-xs">
                    <div>
                      <span className="font-mono font-bold text-slate-700">{o.orderId}</span>
                      <span className="ml-2 text-slate-500">{o.product}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700">₹{o.codAmount}</span>
                      <StatusPill status={o.status} />
                    </div>
                  </div>
                ))}
              </div>
              {orders.length === 0 && (
                <div className="text-xs text-slate-400 italic">No previous orders</div>
              )}
            </div>
          )}
        </div>

        {/* Action Footer */}
        <div className="p-5 bg-slate-50 rounded-b-2xl border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-lg font-bold text-slate-700 hover:bg-slate-200 transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onMerge}
            className="px-5 py-2 rounded-lg font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition text-sm flex items-center gap-1"
            title="Use existing customer details and merge"
          >
            Merge & Use Existing
          </button>
          <button
            onClick={onContinue}
            disabled={isFake}
            title={isFake ? 'Cannot continue — customer is blacklisted' : 'Create new lead/order for this customer'}
            className={`px-5 py-2 rounded-lg font-bold text-white transition text-sm flex items-center gap-1 ${
              isFake ? 'bg-slate-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-sm'
            }`}
          >
            Continue Anyway <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, color }: any) {
  return (
    <div className={`p-2 rounded-lg ${color}`}>
      <Icon size={14} className="mb-1" />
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Delivered: 'bg-emerald-100 text-emerald-700',
    RTO: 'bg-red-100 text-red-700',
    Cancelled: 'bg-slate-100 text-slate-600',
    'Order Booked': 'bg-amber-100 text-amber-700',
    Shipped: 'bg-blue-100 text-blue-700',
    Undelivered: 'bg-orange-100 text-orange-700',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${colors[status] || 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

/**
 * Look up a customer by mobile and use this component to handle the duplicate flow.
 */
export function useDuplicateCustomerCheck() {
  const [pending, setPending] = useState<{ customer: Customer; onResult: (action: 'merge' | 'continue' | 'cancel') => void } | null>(null);

  const checkForDuplicate = async (mobile: string): Promise<'merge' | 'continue' | 'cancel' | 'none'> => {
    if (!mobile || mobile.length !== 10 || !/^\d{10}$/.test(mobile)) return 'none';
    const existing = await db.customers.where('mobile').equals(mobile).first();
    if (!existing) return 'none';

    return new Promise((resolve) => {
      setPending({ customer: existing, onResult: (action) => { setPending(null); resolve(action); } });
    });
  };

  const modal = pending ? (
    <DuplicateCustomerAlert
      customer={pending.customer}
      onMerge={() => pending.onResult('merge')}
      onContinue={() => pending.onResult('continue')}
      onCancel={() => pending.onResult('cancel')}
    />
  ) : null;

  return { checkForDuplicate, duplicateModal: modal };
}
