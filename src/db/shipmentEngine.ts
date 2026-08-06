// AVNIDEEP CRM PRO — Shiprocket-Style Shipment Tracking Engine
// Centralized shipment management with courier timeline, status normalization, and analytics

// ===== Normalized Shipment Statuses =====
export type ShipmentStatus =
  | 'Shipment Created'
  | 'Picked Up'
  | 'In Transit'
  | 'Out For Delivery'
  | 'Delivered'
  | 'Undelivered'
  | 'NDR'
  | 'RTO Initiated'
  | 'RTO In Transit'
  | 'RTO Delivered'
  | 'Cancelled'
  | 'Lost'
  | 'Damaged';

// ===== Status Normalization Map (covers 60+ courier statuses) =====
export const STATUS_NORMALIZATION: Record<string, ShipmentStatus> = {
  // Created
  'shipment created': 'Shipment Created',
  'order booked': 'Shipment Created',
  'booking confirmed': 'Shipment Created',
  'manifested': 'Shipment Created',
  'label generated': 'Shipment Created',
  'ready to ship': 'Shipment Created',

  // Picked Up
  'picked up': 'Picked Up',
  'pickup done': 'Picked Up',
  'pickup complete': 'Picked Up',
  'shipment picked up': 'Picked Up',
  'bagged': 'Picked Up',
  'bags scanned': 'Picked Up',

  // In Transit
  'in transit': 'In Transit',
  'dispatched': 'In Transit',
  'reached hub': 'In Transit',
  'hub scan': 'In Transit',
  'hub in': 'In Transit',
  'hub out': 'In Transit',
  'inward': 'In Transit',
  'outward': 'In Transit',
  'forwarded': 'In Transit',
  'connected': 'In Transit',
  'interconnected': 'In Transit',
  'shipment booked': 'In Transit',

  // Out For Delivery
  'out for delivery': 'Out For Delivery',
  'ofd': 'Out For Delivery',
  'out for delivery(manual)': 'Out For Delivery',
  'with delivery agent': 'Out For Delivery',
  'assigned to rider': 'Out For Delivery',

  // Delivered
  'delivered': 'Delivered',
  'delivered successfully': 'Delivered',
  'shipment delivered': 'Delivered',
  'consignee received': 'Delivered',
  'delivered to customer': 'Delivered',
  'signed by recipient': 'Delivered',
  'delivered in hand': 'Delivered',
  'delivered at location': 'Delivered',
  'completed': 'Delivered',

  // Undelivered / NDR
  'undelivered': 'Undelivered',
  'customer not available': 'NDR',
  'customer not reachable': 'NDR',
  'customer unreachable': 'NDR',
  'address issue': 'NDR',
  'wrong address': 'NDR',
  'refused': 'NDR',
  'refused delivery': 'NDR',
  'otp failed': 'NDR',
  'delivery attempt failed': 'NDR',
  'attempt failed': 'NDR',
  'ndr created': 'NDR',
  'ndr': 'NDR',
  'return requested': 'NDR',
  'buyer requested cancellation': 'NDR',
  'cancellation requested': 'NDR',

  // RTO
  'rto initiated': 'RTO Initiated',
  'rto': 'RTO Initiated',
  'return to origin': 'RTO Initiated',
  'rto requested': 'RTO Initiated',
  'rto in transit': 'RTO In Transit',
  'rto dispatched': 'RTO In Transit',
  'rto hub scan': 'RTO In Transit',
  'rto ofd': 'RTO In Transit',
  'rto delivered': 'RTO Delivered',
  'rto completed': 'RTO Delivered',

  // Cancelled
  'cancelled': 'Cancelled',
  'cancel': 'Cancelled',
  'cancelled before dispatch': 'Cancelled',
  'seller cancelled': 'Cancelled',

  // Lost / Damaged
  'lost': 'Lost',
  'lost in transit': 'Lost',
  'damaged': 'Damaged',
  'package damaged': 'Damaged',
};

// ===== NDR-triggering statuses (auto-create NDR case) =====
export const NDR_TRIGGER_STATUSES: ShipmentStatus[] = [
  'NDR', 'Undelivered'
];

// ===== Terminal statuses (no further action expected) =====
export const TERMINAL_STATUSES: ShipmentStatus[] = [
  'Delivered', 'RTO Delivered', 'Cancelled', 'Lost', 'Damaged'
];

// ===== Revenue-eligible statuses =====
export const REVENUE_STATUSES: ShipmentStatus[] = [
  'Delivered'
];

// ===== CRM status mapping (Shipment → Lead/Order status) =====
export const CRM_STATUS_MAP: Record<ShipmentStatus, string> = {
  'Shipment Created': 'Order Booked',
  'Picked Up': 'Shipped',
  'In Transit': 'In Transit',
  'Out For Delivery': 'Out For Delivery',
  'Delivered': 'Delivered',
  'Undelivered': 'Undelivered',
  'NDR': 'Undelivered',
  'RTO Initiated': 'RTO',
  'RTO In Transit': 'RTO',
  'RTO Delivered': 'RTO',
  'Cancelled': 'Cancelled',
  'Lost': 'Cancelled',
  'Damaged': 'Cancelled',
};

// ===== Status Color Map for UI =====
export const STATUS_COLORS: Record<ShipmentStatus, string> = {
  'Shipment Created': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Picked Up': 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  'In Transit': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Out For Delivery': 'bg-amber-50 text-amber-700 border border-amber-200',
  'Delivered': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'Undelivered': 'bg-orange-100 text-orange-700 border border-orange-200',
  'NDR': 'bg-red-50 text-red-700 border border-red-200',
  'RTO Initiated': 'bg-rose-50 text-rose-700 border border-rose-200',
  'RTO In Transit': 'bg-rose-50 text-rose-700 border border-rose-200',
  'RTO Delivered': 'bg-red-100 text-red-700 border border-red-200',
  'Cancelled': 'bg-slate-100 text-slate-600 border border-slate-200',
  'Lost': 'bg-red-100 text-red-700 border border-red-200',
  'Damaged': 'bg-red-100 text-red-700 border border-red-200',
};

// ===== Courier Performance Interface =====
export interface CourierMetrics {
  courier: string;
  totalShipments: number;
  delivered: number;
  rto: number;
  ndr: number;
  inTransit: number;
  deliveryRate: number;
  rtoRate: number;
  ndrRate: number;
  avgDeliveryDays: number;
}

// ===== Normalize any raw status string to ShipmentStatus =====
export function normalizeShipmentStatus(rawStatus: string): ShipmentStatus {
  const cleaned = rawStatus.toLowerCase().trim();
  if (!cleaned) return 'In Transit';

  // PRIORITY-BASED matching: check longest/most specific patterns FIRST
  // This prevents "RTO Delivered" from matching "delivered" incorrectly

  // Priority 1: RTO variants (must check BEFORE plain "Delivered")
  if (cleaned.includes('rto delivered') || cleaned.includes('rto completed')) return 'RTO Delivered';
  if (cleaned.includes('rto in transit') || cleaned.includes('rto dispatched') || cleaned.includes('rto hub scan') || cleaned.includes('rto ofd')) return 'RTO In Transit';
  if (cleaned.includes('rto initiated') || cleaned === 'rto' || cleaned.startsWith('rto') || cleaned.includes('return to origin') || cleaned.includes('return requested')) return 'RTO Initiated';

  // Priority 2: NDR / Undelivered
  if (cleaned.includes('ndr') || cleaned.includes('customer not') || cleaned.includes('unreachable') || cleaned.includes('address issue') || cleaned.includes('wrong address') || cleaned.includes('refused') || cleaned.includes('otp failed') || cleaned.includes('attempt failed')) return 'NDR';
  if (cleaned.includes('undelivered')) return 'Undelivered';

  // Priority 3: Pure delivery
  if (cleaned === 'delivered' || cleaned === 'delivered successfully' || cleaned.includes('shipment delivered') || cleaned.includes('consignee received') || cleaned.includes('delivered to customer') || cleaned.includes('signed by') || cleaned.includes('delivered in hand') || cleaned.includes('completed')) return 'Delivered';

  // Priority 4: Out For Delivery
  if (cleaned.includes('out for delivery') || cleaned === 'ofd' || cleaned.includes('with delivery agent') || cleaned.includes('assigned to rider')) return 'Out For Delivery';

  // Priority 5: In Transit
  if (cleaned.includes('in transit') || cleaned.includes('dispatched') || cleaned.includes('reached hub') || cleaned.includes('hub scan') || cleaned.includes('hub in') || cleaned.includes('hub out') || cleaned.includes('inward') || cleaned.includes('outward') || cleaned.includes('forwarded') || cleaned.includes('connected') || cleaned.includes('interconnected') || cleaned.includes('shipment booked')) return 'In Transit';

  // Priority 6: Picked Up
  if (cleaned.includes('picked up') || cleaned.includes('pickup done') || cleaned.includes('pickup complete') || cleaned.includes('bagged') || cleaned.includes('bags scanned')) return 'Picked Up';

  // Priority 7: Shipment Created
  if (cleaned.includes('shipment created') || cleaned.includes('order booked') || cleaned.includes('booking confirmed') || cleaned.includes('manifested') || cleaned.includes('label generated') || cleaned.includes('ready to ship')) return 'Shipment Created';

  // Priority 8: Cancelled
  if (cleaned.includes('cancelled') || cleaned === 'cancel') return 'Cancelled';

  // Priority 9: Lost / Damaged
  if (cleaned.includes('lost')) return 'Lost';
  if (cleaned.includes('damaged')) return 'Damaged';

  return 'In Transit';
}

// ===== Create Shipment Timeline Entry =====
export interface TimelineEntry {
  date: string;
  status: ShipmentStatus;
  location: string;
  remarks: string;
}

export function createTimelineEntry(
  date: string,
  status: ShipmentStatus,
  location: string = '',
  remarks: string = ''
): TimelineEntry {
  return { date, status, location, remarks };
}

// ===== Calculate Courier Performance Metrics =====
export async function calculateCourierMetrics(orders: any[]): Promise<CourierMetrics[]> {
  const courierMap = new Map<string, {
    total: number; delivered: number; rto: number; ndr: number; inTransit: number;
    deliveryDays: number[]; deliveryDaySum: number; deliveryDayCount: number;
  }>();

  for (const o of orders) {
    const c = o.courier || 'Unknown';
    if (!courierMap.has(c)) courierMap.set(c, { total:0, delivered:0, rto:0, ndr:0, inTransit:0, deliveryDays:[], deliveryDaySum:0, deliveryDayCount:0 });
    const stats = courierMap.get(c)!;
    stats.total++;

    if (o.status === 'Delivered') {
      stats.delivered++;
      // Calculate delivery days if both dates exist
      if (o.orderDate && o.updatedAt) {
        const start = new Date(o.orderDate).getTime();
        const end = new Date(o.updatedAt).getTime();
        if (start && end && end > start) {
          const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
          stats.deliveryDaySum += days;
          stats.deliveryDayCount++;
        }
      }
    } else if (o.status && o.status.startsWith('RTO')) {
      // Catches: 'RTO Initiated', 'RTO In Transit', 'RTO Delivered'
      stats.rto++;
    } else if (o.status === 'Undelivered' || o.status === 'NDR') {
      stats.ndr++;
    } else {
      stats.inTransit++;
    }
  }

  const metrics: CourierMetrics[] = [];
  for (const [courier, s] of courierMap.entries()) {
    metrics.push({
      courier,
      totalShipments: s.total,
      delivered: s.delivered,
      rto: s.rto,
      ndr: s.ndr,
      inTransit: s.inTransit,
      deliveryRate: s.total > 0 ? Math.round((s.delivered / s.total) * 100) : 0,
      rtoRate: s.total > 0 ? Math.round((s.rto / s.total) * 100) : 0,
      ndrRate: s.total > 0 ? Math.round((s.ndr / s.total) * 100) : 0,
      avgDeliveryDays: s.deliveryDayCount > 0 ? Math.round(s.deliveryDaySum / s.deliveryDayCount) : 0,
    });
  }
  return metrics.sort((a, b) => b.totalShipments - a.totalShipments);
}
