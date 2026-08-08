import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import Eye from 'lucide-react/dist/esm/icons/eye'
import FileCheck from 'lucide-react/dist/esm/icons/file-check'
import { Customer360Profile } from '../components/Customer360Profile';
import { safeFormat } from '../lib/safeFormat';
import { useDateFilter } from '../context/DateFilterContext';

export function DeliveredCustomers() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // Get delivered customers
  const customers = useLiveQuery(() => db.customers.where('currentStatus').equals('Delivered').reverse().toArray()) || [];

  // Map orders for details
  const orders = useLiveQuery(() => db.orders.where('status').equals('Delivered').toArray()) || [];

  const { filterByDate } = useDateFilter();

  // Apply global date filter
  const filteredCustomers = useMemo(() => {
    return filterByDate(customers, 'createdAt');
  }, [customers, filterByDate]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FileCheck className="text-emerald-600" /> Delivered Customers Registry
        </h1>
        <p className="text-slate-500 text-sm">Review successfully delivered orders and customer stats.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left border-collapse font-sans text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-4">Customer Details</th>
                <th className="p-4">Product Details</th>
                <th className="p-4">COD Amount</th>
                <th className="p-4">Delivered Date</th>
                <th className="p-4">Tracking ID</th>
                <th className="p-4">Total Orders</th>
                <th className="p-4">Lifetime Spend</th>
                <th className="p-4 text-center">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map(cust => {
                const order = orders.find(o => o.customerId === cust.id);
                return (
                  <tr key={cust.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="p-4">
                      <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(cust.id!)}>{cust.name}</div>
                      <div className="text-xs text-slate-500 font-medium">{cust.mobile}</div>
                    </td>
                    <td className="p-4 font-medium text-slate-700">
                      {order?.product || 'Product Shipped'}
                    </td>
                    <td className="p-4 font-bold text-slate-800">
                      ₹{order?.codAmount || cust.totalSpend}
                    </td>
                    <td className="p-4 text-slate-500 font-medium">
                      {order?.updatedAt ? safeFormat(order.updatedAt, 'dd MMM yyyy') : 'Recently'}
                    </td>
                    <td className="p-4 font-mono text-slate-600">
                      {order?.trackingId || <span className="text-amber-600">Tracking ID not assigned yet</span>}
                    </td>
                    <td className="p-4 font-bold text-slate-600">
                      {cust.totalOrders}
                    </td>
                    <td className="p-4 font-bold text-blue-600">
                      ₹{cust.totalSpend}
                    </td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => setSelectedCustomerId(cust.id!)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition text-xs shadow-sm"
                      >
                        <Eye size={12} /> Timeline
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500 bg-slate-50/50">
                    No delivered customer profiles found for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden space-y-2.5 p-3">
          {filteredCustomers.length === 0 && (
            <div className="p-10 text-center text-slate-500 text-sm">No delivered customer profiles found for this date range.</div>
          )}
          {filteredCustomers.map(cust => {
            const order = orders.find(o => o.customerId === cust.id);
            return (
              <div key={cust.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden av-fade-in">
                <div className="px-3.5 pt-3 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-[15px] leading-tight truncate cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(cust.id!)}>{cust.name}</h4>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">📱 {cust.mobile}</p>
                      <p className="text-[13px] text-slate-600 mt-1.5 truncate">{order?.product || 'Product Shipped'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-emerald-600 text-base">₹{order?.codAmount || cust.totalSpend}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{order?.updatedAt ? safeFormat(order.updatedAt, 'dd MMM yyyy') : 'Recently'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2.5 text-center">
                    <div className="bg-slate-50 rounded-lg py-1.5">
                      <div className="font-bold text-slate-700 text-sm">{cust.totalOrders}</div>
                      <div className="text-[9px] text-slate-400 font-bold uppercase">Total Orders</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg py-1.5">
                      <div className="font-bold text-blue-700 text-sm">₹{cust.totalSpend}</div>
                      <div className="text-[9px] text-blue-500 font-bold uppercase">Lifetime</div>
                    </div>
                  </div>
                  <p className="text-xs font-mono text-slate-600 mt-2 break-all">
                    {order?.trackingId ? `📦 ${order.trackingId}` : <span className="text-amber-600">Tracking ID not assigned yet</span>}
                  </p>
                </div>
                <div className="px-3 pb-3">
                  <button onClick={() => setSelectedCustomerId(cust.id!)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs active:scale-95 transition-transform">
                    <Eye size={14} /> Timeline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedCustomerId && (
        <Customer360Profile 
          customerId={selectedCustomerId} 
          isOpen={true} 
          onClose={() => setSelectedCustomerId(null)} 
        />
      )}
    </div>
  );
}
