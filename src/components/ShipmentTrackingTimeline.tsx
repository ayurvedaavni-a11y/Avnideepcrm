import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import X from 'lucide-react/dist/esm/icons/x'
import Package from 'lucide-react/dist/esm/icons/package'
import Truck from 'lucide-react/dist/esm/icons/truck'
import MapPin from 'lucide-react/dist/esm/icons/map-pin'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import { safeFormat } from '../lib/safeFormat';
import { normalizeShipmentStatus, STATUS_COLORS, TimelineEntry } from '../db/shipmentEngine';

interface Props {
  orderId: number;
  isOpen: boolean;
  onClose: () => void;
}

export function ShipmentTrackingTimeline({ orderId, isOpen, onClose }: Props) {
  const order = useLiveQuery(() => db.orders.get(orderId), [orderId]);
  const customer = useLiveQuery(() => order ? db.customers.get(order.customerId) : undefined, [order]);
  const logs = useLiveQuery(() => db.timelineLogs.where('entityId').equals(orderId).filter(l => l.entityType === 'Order').reverse().sortBy('createdAt'), [orderId]);

  if (!isOpen || !order) return null;

  // Build timeline from existing logs and order data
  const timeline: TimelineEntry[] = (logs || []).map(log => ({
    date: log.createdAt,
    status: normalizeShipmentStatus(log.action.replace('Order Created via ', '').replace('Order ', '').replace('Logistics Update: ', '')),
    location: '',
    remarks: log.notes || '',
  }));

  // Add order creation as first entry if not in logs
  if (timeline.length === 0) {
    timeline.push({
      date: order.createdAt || order.orderDate,
      status: 'Shipment Created',
      location: '',
      remarks: `Order ${order.orderId} created`,
    });
  }

  // Ensure current status is at the top
  const currentStatus = normalizeShipmentStatus(order.status);
  if (timeline.length === 0 || timeline[0].status !== currentStatus) {
    timeline.unshift({
      date: order.updatedAt || new Date().toISOString(),
      status: currentStatus,
      location: '',
      remarks: `Current status: ${order.status}`,
    });
  }

  const getStatusIcon = (status: string) => {
    if (status === 'Delivered') return CheckCircle;
    if (status === 'RTO Delivered' || status === 'Cancelled' || status === 'Lost' || status === 'Damaged') return XCircle;
    if (status === 'Out For Delivery' || status === 'Picked Up') return Truck;
    if (status === 'In Transit') return MapPin;
    if (status === 'NDR' || status === 'Undelivered') return AlertTriangle;
    if (status === 'RTO Initiated' || status === 'RTO In Transit') return RefreshCw;
    return Package;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Tracking Timeline</h2>
            <p className="text-slate-500 text-sm mt-0.5">
              {customer?.name || 'Unknown'} — {order.orderId}
              {order.trackingId && <span className="ml-2 font-mono text-xs">AWB: {order.trackingId}</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition"><X size={20} className="text-slate-500" /></button>
        </div>

        {/* Current Status Card */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-bold uppercase">Current Status</span>
              <div className={`mt-1 px-3 py-1.5 rounded-full text-xs font-bold inline-block ${STATUS_COLORS[currentStatus] || 'bg-slate-100 text-slate-700'}`}>
                {currentStatus}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 font-bold uppercase">COD Amount</span>
              <div className="text-lg font-bold text-slate-800">₹{order.codAmount?.toFixed(2) || '0.00'}</div>
            </div>
          </div>
          {order.courier && (
            <div className="mt-2 text-xs text-slate-500">
              <span className="font-medium">Courier:</span> {order.courier}
              {order.trackingId && <span className="ml-3 font-medium">AWB:</span>}
              {order.trackingId && <span className="font-mono ml-1">{order.trackingId}</span>}
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-0">
            {timeline.map((entry, idx) => {
              const Icon = getStatusIcon(entry.status);
              const isLatest = idx === 0;
              const isCurrent = entry.status === currentStatus;
              return (
                <div key={idx} className="flex gap-4">
                  {/* Timeline Connector */}
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      isCurrent ? 'bg-blue-100 text-blue-600 ring-2 ring-blue-300' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon size={isCurrent ? 20 : 16} />
                    </div>
                    {idx !== timeline.length - 1 && (
                      <div className="w-0.5 h-full min-h-[24px] bg-slate-200 my-1"></div>
                    )}
                  </div>
                  {/* Content */}
                  <div className={`pb-6 flex-1 ${isLatest ? '' : ''}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className={`font-bold text-sm ${isCurrent ? 'text-blue-700' : 'text-slate-700'}`}>
                          {entry.status}
                          {isCurrent && <span className="ml-2 text-[10px] text-blue-500 font-medium">(Current)</span>}
                        </h4>
                        {entry.remarks && (
                          <p className="text-xs text-slate-500 mt-0.5">{entry.remarks}</p>
                        )}
                        {entry.location && (
                          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                            <MapPin size={10} /> {entry.location}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 shrink-0 ml-4">
                        {safeFormat(entry.date, 'dd MMM yyyy, hh:mm a')}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
