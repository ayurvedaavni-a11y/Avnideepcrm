import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import Eye from 'lucide-react/dist/esm/icons/eye'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import { Customer360Profile } from '../components/Customer360Profile';
import { useDateFilter } from '../context/DateFilterContext';

export function UndeliveredCustomers() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // Get undelivered customers
  const customers = useLiveQuery(() => db.customers.where('currentStatus').equals('Undelivered').reverse().toArray()) || [];

  // Get active NDR cases
  const ndrCases = useLiveQuery(() => db.ndrCases.toArray()) || [];
  
  // Get orders
  const orders = useLiveQuery(() => db.orders.toArray()) || [];

  const { filterByDate } = useDateFilter();

  // Apply global date filter
  const filteredCustomers = useMemo(() => {
    return filterByDate(customers, 'createdAt');
  }, [customers, filterByDate]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <AlertTriangle className="text-orange-500" /> Undelivered Exception Cases
        </h1>
        <p className="text-slate-500 text-sm">Review exceptions, active NDR cycles, and buyer failure rates.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left border-collapse font-sans text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-4">Customer Details</th>
                <th className="p-4">Product Details</th>
                <th className="p-4">NDR Case Status</th>
                <th className="p-4">Attempt Count</th>
                <th className="p-4">Last Response / Action</th>
                <th className="p-4">Risk Profile</th>
                <th className="p-4 text-center">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map(cust => {
                const ndr = ndrCases.find(n => n.customerId === cust.id);
                const order = orders.find(o => o.customerId === cust.id && o.status === 'Undelivered');
                
                const lastAttempt = ndr && ndr.attempts && ndr.attempts.length > 0 
                  ? ndr.attempts[ndr.attempts.length - 1] 
                  : null;

                return (
                  <tr key={cust.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="p-4">
                      <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(cust.id!)}>{cust.name}</div>
                      <div className="text-xs text-slate-500 font-medium">{cust.mobile}</div>
                    </td>
                    <td className="p-4 font-medium text-slate-700">
                      {order?.product || 'Product Exception'}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-bold rounded">
                        {ndr?.status || 'Pending NDR'}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-slate-700 text-center">
                      {ndr?.attemptCount || 1} / 3
                    </td>
                    <td className="p-4 text-slate-600 font-medium max-w-[200px] truncate">
                      {lastAttempt ? lastAttempt.customerResponse : (ndr?.reason || 'No attempt logged')}
                    </td>
                    <td className="p-4">
                      {cust.riskLevel === 'Fake' ? (
                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded flex items-center gap-1 w-max">
                          <AlertTriangle size={12} /> FAKE
                        </span>
                      ) : cust.riskLevel === 'Critical' ? (
                        <span className="px-2 py-1 bg-red-50 text-red-600 text-xs font-bold rounded border border-red-200">
                          CRITICAL RISK
                        </span>
                      ) : (
                        <span className={`px-2 py-1 text-xs font-bold rounded
                          ${cust.riskLevel === 'High' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}
                        `}>
                          {cust.riskLevel} Risk
                        </span>
                      )}
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
                  <td colSpan={7} className="p-12 text-center text-slate-500 bg-slate-50/50">
                    No active undelivered exceptions found for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden space-y-2.5 p-3">
          {filteredCustomers.length === 0 && (
            <div className="p-10 text-center text-slate-500 text-sm">No active undelivered exceptions found for this date range.</div>
          )}
          {filteredCustomers.map(cust => {
            const ndr = ndrCases.find(n => n.customerId === cust.id);
            const order = orders.find(o => o.customerId === cust.id && o.status === 'Undelivered');
            const lastAttempt = ndr && ndr.attempts && ndr.attempts.length > 0 ? ndr.attempts[ndr.attempts.length - 1] : null;
            return (
              <div key={cust.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden av-fade-in">
                <div className="px-3.5 pt-3 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-[15px] leading-tight truncate cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(cust.id!)}>{cust.name}</h4>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">📱 {cust.mobile}</p>
                      <p className="text-[13px] text-slate-600 mt-1.5 truncate">{order?.product || 'Product Exception'}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded">{ndr?.status || 'Pending NDR'}</span>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{ndr?.attemptCount || 1} / 3 attempts</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                    {lastAttempt ? lastAttempt.customerResponse : (ndr?.reason || 'No attempt logged')}
                  </p>
                  <div className="mt-2">
                    {cust.riskLevel === 'Fake' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                        <AlertTriangle size={12} /> FAKE
                      </span>
                    ) : cust.riskLevel === 'Critical' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded border border-red-200">CRITICAL RISK</span>
                    ) : (
                      <span className={`px-2 py-1 text-[10px] font-bold rounded ${cust.riskLevel === 'High' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                        {cust.riskLevel} Risk
                      </span>
                    )}
                  </div>
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
