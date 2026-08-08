import { useState, useMemo, useCallback, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle'
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import Clock from 'lucide-react/dist/esm/icons/clock'
import Phone from 'lucide-react/dist/esm/icons/phone'
import X from 'lucide-react/dist/esm/icons/x'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import { toast } from 'react-hot-toast';
import { updateOrderStatus } from '../db/workflow';
import { useDateFilter } from '../context/DateFilterContext';

// ===== Pagination =====
const PAGE_SIZE = 20;

interface NDRAttempt {
  attemptNumber: number;
  date: string;
  time: string;
  agentName: string;
  customerResponse: string;
  retryDate?: string;
  notes: string;
}

export function NDRPanel() {
  const ndrCases = useLiveQuery(() => db.ndrCases.filter(n => n.status !== 'Resolved').reverse().toArray()) || [];
  const allOrders = useLiveQuery(() => db.orders.toArray(), []) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [page, setPage] = useState(0);

  const { filterByDate } = useDateFilter();

  // OPTIMIZATION: Build order & customer maps ONCE instead of per-row useLiveQuery
  const orderMap = useMemo(() => new Map(allOrders.map(o => [o.id!, o])), [allOrders]);
  const customerMap = useMemo(() => new Map(allCustomers.map(c => [c.id!, c])), [allCustomers]);

  // Apply global date filter
  const filteredNDRCases = useMemo(() => {
    return filterByDate(ndrCases, 'createdAt');
  }, [ndrCases, filterByDate]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredNDRCases.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedCases = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filteredNDRCases.slice(start, start + PAGE_SIZE);
  }, [filteredNDRCases, safePage]);

  const handleNDRQuickAction = useCallback(async (caseId: number, outcome: string) => {
    try {
      const ndrCase = await db.ndrCases.get(caseId);
      if (!ndrCase) return;
      await handleSaveNDRAction(caseId, outcome, 'Quick action from panel', 'Quick Resolve', '', 'Actioned via Quick Button');
    } catch (e) {
      toast.error('Quick action failed');
    }
  }, []);

  const handleSaveNDRAction = useCallback(async (caseId: number, status: string, notes: string, reason: string, retryDate: string, customerResponse: string) => {
    try {
      const ndrCase = await db.ndrCases.get(caseId);
      if (!ndrCase) return;

      const newAttemptCount = (ndrCase.attemptCount || 0) + 1;
      
      const newAttempt: NDRAttempt = {
        attemptNumber: newAttemptCount,
        date: new Date().toISOString().slice(0,10),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        agentName: 'Admin Agent',
        customerResponse,
        retryDate: retryDate || undefined,
        notes
      };

      const currentAttempts = (ndrCase as any).attempts || [];
      const updatedAttempts = [...currentAttempts, newAttempt];

      const updateData: any = { 
        status, 
        reason,
        attemptCount: newAttemptCount,
        attempts: updatedAttempts,
        updatedAt: new Date().toISOString() 
      };

      if (retryDate) updateData.retryDate = retryDate;

      await db.ndrCases.update(caseId, updateData);

      await db.timelineLogs.add({
        customerId: ndrCase.customerId,
        entityType: 'NDR',
        entityId: caseId,
        action: `NDR Attempt ${newAttemptCount}`,
        notes: `Outcome: ${status} | Reason: ${reason} | Customer Reply: ${customerResponse}. Notes: ${notes}`,
        agentName: 'Admin Agent',
        createdAt: new Date().toISOString()
      });

      if (['Delivered', 'RTO', 'Customer Refused', 'Wrong Address', 'Wrong Number', 'Fake Customer', 'Reattempt Scheduled', 'Out For Reattempt'].includes(status)) {
        let finalStatus: any = 'Undelivered';
        if (status === 'Delivered') finalStatus = 'Delivered';
        else if (status === 'RTO') finalStatus = 'RTO';
        else if (status === 'Reattempt Scheduled') finalStatus = 'In Transit';
        else if (status === 'Out For Reattempt') finalStatus = 'Out For Delivery';
        else if (['Fake Customer', 'Customer Refused', 'Wrong Address', 'Wrong Number'].includes(status)) finalStatus = 'Cancelled';

        // UNIFIED write path: bumps updated_at (delta-sync safe), syncs customer
        // counters, appends an Order {status} timeline entry + scan history.
        await updateOrderStatus(ndrCase.orderId, finalStatus, { agentName: 'Admin' });

        if (status !== 'Reattempt Scheduled' && status !== 'Out For Reattempt') {
          await db.ndrCases.update(caseId, { status: 'Resolved', updatedAt: new Date().toISOString() });
        }
      }

      toast.success(`NDR Action saved.`);
      setSelectedCase(null);
    } catch (e) {
      toast.error('Failed to update NDR');
    }
  }, []);

  const onCaseAction = useCallback((ndr: any) => setSelectedCase(ndr), []);
  const onCaseQuickAction = useCallback(
    (caseId: number, outcome: string) => handleNDRQuickAction(caseId, outcome),
    [handleNDRQuickAction]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">NDR Panel</h1>
          <p className="text-slate-500 text-sm">Monitor and resolve courier delivery exceptions dynamically.</p>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-medium text-xs">Page {safePage + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      
      <div className="grid gap-6">
        {paginatedCases.map(ndr => (
          <NDRCaseCardWrapper 
            key={ndr.id}
            ndr={ndr}
            order={orderMap.get(ndr.orderId)}
            customer={customerMap.get(ndr.customerId)}
            onAction={onCaseAction}
            onQuickAction={onCaseQuickAction}
          />
        ))}
        {paginatedCases.length === 0 && (
          <div className="bg-white p-12 text-center rounded-xl border border-slate-200 shadow-sm text-slate-500 font-medium">
            No active NDR cases for this date range! Your delivery pipeline is clear.
          </div>
        )}
      </div>

      {selectedCase && (
        <NDRActionModal 
          ndrCase={selectedCase}
          order={orderMap.get(selectedCase.orderId)}
          customer={customerMap.get(selectedCase.customerId)}
          onClose={() => setSelectedCase(null)} 
          onSave={handleSaveNDRAction}
        />
      )}
    </div>
  );
}

// ===== NDRCaseCard (memoized - no useLiveQuery!) =====
const NDRCaseCard = memo(function NDRCaseCard({ ndr, order, customer, onAction, onQuickAction }: any) {
  if (!order || !customer) return null;

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500"></div>
      
      <div className="flex justify-between items-start pl-2">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-slate-800">{customer.name}</h3>
            <span className="text-sm font-semibold text-slate-500">({customer.mobile})</span>
            {customer.riskLevel === 'Fake' && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded flex items-center gap-1">
                <AlertCircle size={12} /> FAKE CUSTOMER
              </span>
            )}
          </div>
          <div className="text-sm text-slate-600 flex items-center gap-4">
            <span>Order ID: <strong>{order.orderId}</strong></span>
            <span>•</span>
            <span>Tracking ID: <strong>{order.trackingId}</strong></span>
            <span>•</span>
            <span>COD Amount: <strong>₹{order.codAmount}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => onQuickAction('Delivered')}
            className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-bold hover:bg-emerald-100 transition">
            Mark Delivered
          </button>
          <button onClick={() => onQuickAction('RTO')}
            className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-100 rounded-lg text-xs font-bold hover:bg-red-100 transition">
            Mark RTO
          </button>
          <button onClick={onAction}
            className="px-4 py-1.5 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition text-xs shadow-sm ml-2">
            Take Action / Reattempt
          </button>
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 pl-3">
        <div className="flex justify-between flex-wrap gap-2 items-center mb-3">
          <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
            <Clock size={14} /> Attempt History Logs ({ndr.attemptCount})
          </div>
          <a href={`tel:${customer.mobile}`} className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
            <Phone size={12} /> Call Customer Now
          </a>
        </div>
        <div className="space-y-3">
          {ndr.attempts && ndr.attempts.length > 0 ? (
            ndr.attempts.map((att: any, idx: number) => (
              <div key={idx} className="bg-white p-3 rounded border border-slate-200 flex flex-col gap-1 text-sm">
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span className="text-blue-600">Attempt {att.attemptNumber}</span>
                  <span>{att.date} • {att.time}</span>
                </div>
                <p className="text-slate-800 font-semibold mt-0.5">Response: <span className="font-normal text-slate-600">"{att.customerResponse}"</span></p>
                {att.notes && <p className="text-xs text-slate-500 italic">Notes: {att.notes}</p>}
                {att.retryDate && (
                  <p className="text-xs font-bold text-amber-600 flex items-center gap-1 mt-1">
                    <Calendar size={12} /> Next Retry Scheduled: {att.retryDate}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400 italic">Current NDR Status: {ndr.status} (Reason: {ndr.reason})</p>
          )}
        </div>
      </div>
    </div>
  );
});

// ===== NDRCaseCardWrapper — bridges stable callbacks to memo(NDRCaseCard) =====
const NDRCaseCardWrapper = memo(function NDRCaseCardWrapper({ ndr, order, customer, onAction, onQuickAction }: any) {
  const handleAction = useCallback(() => onAction(ndr), [ndr, onAction]);
  const handleQuickAction = useCallback(
    (outcome: string) => onQuickAction(ndr.id!, outcome),
    [ndr.id, onQuickAction]
  );
  return (
    <NDRCaseCard 
      ndr={ndr}
      order={order}
      customer={customer}
      onAction={handleAction}
      onQuickAction={handleQuickAction}
    />
  );
});

const REASONS_BY_STATUS: Record<string, string[]> = {
  'Reattempt Scheduled': [
    'Customer Not Available', 'Customer Requested Reschedule', 'Wrong Address',
    'Wrong Number', 'Address Issue', 'Time Slot Mismatch',
  ],
  'Out For Reattempt': [
    'Reattempt In Progress', 'Courier On The Way', 'Customer Confirmed Reattempt',
  ],
  'Delivered': [
    'Delivered Successfully', 'Customer Received', 'Reattempt Successful',
    'Courier Delivered', 'Customer Confirmed', 'Resolved Successfully', 'Closed Successfully',
  ],
  'RTO': [
    'Customer Not Available', 'Refused Delivery', 'Wrong Address', 'Wrong Number',
    'Address Issue', 'Damaged', 'Lost In Transit', 'Multiple Reattempts Failed',
  ],
  'Customer Refused': [
    'Refused Delivery', 'Customer Changed Mind', 'COD Rejected', 'Customer Not Interested',
  ],
  'Wrong Address': [
    'Address Issue', 'Incomplete Address', 'Address Not Found', 'Customer Moved',
  ],
  'Wrong Number': [
    'Phone Switched Off', 'Wrong Phone Number', 'Number Unreachable', 'Customer Not Available',
  ],
  'Fake Customer': ['Fake Customer', 'Fake Order', 'Suspicious Activity', 'Duplicate Order'],
  'Cancelled': ['Customer Cancelled', 'Duplicate Order', 'Fake Order', 'COD Rejected'],
};

function getReasonsForStatus(status: string): string[] {
  return REASONS_BY_STATUS[status] || REASONS_BY_STATUS['Reattempt Scheduled'];
}

function NDRActionModal({ ndrCase, onClose, onSave }: any) {
  const [status, setStatus] = useState('Reattempt Scheduled');
  const initialReasons = getReasonsForStatus('Reattempt Scheduled');
  const [reason, setReason] = useState(initialReasons[0]);
  const [customerResponse, setCustomerResponse] = useState('');
  const [retryDate, setRetryDate] = useState('');
  const [notes, setNotes] = useState('');

  const availableReasons = getReasonsForStatus(status);
  const isResolved = status === 'Delivered';

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    const validReasons = getReasonsForStatus(newStatus);
    if (!validReasons.includes(reason)) setReason(validReasons[0]);
    if (newStatus !== 'Reattempt Scheduled') setRetryDate('');
  };

  const handleSubmit = () => {
    if (!customerResponse.trim()) {
      toast.error('Customer response is required');
      return;
    }
    if (status === 'Reattempt Scheduled' && !retryDate) {
      toast.error('Retry date is required for scheduled reattempts');
      return;
    }
    if (!availableReasons.includes(reason)) {
      toast.error('Invalid status / reason combination — please re-select');
      return;
    }
    onSave(ndrCase.id, status, notes, reason, retryDate, customerResponse);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Log NDR Attempt</h2>
            <p className="text-slate-500 text-sm mt-1">Create dynamic attempt logs and schedule reattempts</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X size={20} className="text-slate-400" /></button>
        </div>
        
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">NDR Status *</label>
              <select value={status} onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-medium">
                <option value="Reattempt Scheduled">Reattempt Scheduled</option>
                <option value="Out For Reattempt">Out For Reattempt</option>
                <option value="Delivered">Delivered (Resolved)</option>
                <option value="RTO">RTO (Returned)</option>
                <option value="Customer Refused">Customer Refused</option>
                <option value="Wrong Address">Wrong Address</option>
                <option value="Wrong Number">Wrong Number</option>
                <option value="Fake Customer">Fake Customer</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}
                className={`w-full p-2.5 border rounded-lg outline-none focus:ring-2 font-medium ${
                  isResolved ? 'border-emerald-200 bg-emerald-50/30 focus:ring-emerald-500' : 'border-slate-300 focus:ring-blue-500'
                }`}>
                {availableReasons.map(r => (<option key={r} value={r}>{r}</option>))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer Reply / Statement *</label>
            <input type="text" required value={customerResponse}
              onChange={(e) => setCustomerResponse(e.target.value)}
              placeholder="e.g., Requested delivery for tomorrow morning"
              className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {status === 'Reattempt Scheduled' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Next Retry Date *</label>
              <input type="date" required value={retryDate}
                onChange={(e) => setRetryDate(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Agent Action Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter internal details..."
              className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 rows-2" />
          </div>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-6 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handleSubmit}
            className="px-6 py-2 rounded-lg font-medium text-white bg-slate-900 hover:bg-slate-800 transition flex items-center gap-2">
            Save Attempt & Action
          </button>
        </div>
      </div>
    </div>
  );
}
