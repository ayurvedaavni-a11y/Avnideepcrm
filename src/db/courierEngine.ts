// AVNIDEEP CRM PRO — Smart Courier Import Engine
// Auto-detects courier type, maps raw columns, and normalizes statuses

// ===== Column Name Mappings (raw → normalized) =====
const COLUMN_MAPS: Record<string, string[]> = {
  phone: ['mobile', 'phone', 'consignee mobile', 'customer phone', 'buyer phone', 'recipient phone', 'contact no', 'contact_number', 'phone number', 'mobile no', 'mobile_number'],
  name: ['consignee', 'customer name', 'buyer name', 'recipient name', 'recipient', 'customer', 'name', 'buyer', 'consignee name'],
  address: ['address', 'consignee address', 'delivery address', 'shipping address', 'billing address', 'customer address', 'recipient address', 'full address'],
  city: ['city', 'destination city', 'consignee city', 'delivery city', 'customer city', 'recipient city'],
  state: ['state', 'destination state', 'consignee state', 'delivery state', 'customer state'],
  pincode: ['pincode', 'pin code', 'pin', 'pin_code', 'zip', 'zipcode', 'delivery pincode', 'destination pincode'],
  tracking: ['awb', 'awb number', 'tracking id', 'tracking_id', 'tracking', 'shipment id', 'shipment_id', 'lr number', 'airwaybill', 'airwaybill number', 'awb no', 'awb_no', 'consignment no'],
  orderId: ['order id', 'order_id', 'order number', 'order_number', 'reference number', 'reference_no', 'client order id', 'client_order_id', 'order', 'ref no', 'ref_no'],
  status: ['shipment status', 'current status', 'delivery status', 'order status', 'status', 'current_status', 'shipment_status', 'awb status', 'scan', 'remarks', 'delivery remarks'],
  cod: ['cod amount', 'cod_amount', 'amount', 'invoice value', 'invoice_value', 'collectable value', 'collectable_value', 'cod', 'total amount', 'total_amount', 'value', 'order amount', 'collectable_value', 'collectable value', 'amount to collect', 'amount_to_collect', 'shipment value', 'shipment_value', 'invoice amount', 'invoice_amount', 'payable amount', 'payable_amount', 'remittance value', 'remittance_value', 'order value', 'order_value', 'total_amt', 'total_amt', 'item_total', 'item total', 'net_amount', 'net amount', 'cod_charge', 'cod charge', 'total_collection', 'total collection', 'delivery_amount', 'delivery amount', 'payment_amount', 'payment amount'],
  product: ['product', 'item', 'description', 'product name', 'product_name', 'sku', 'item description', 'item_description', 'goods description'],
  quantity: ['quantity', 'qty', 'total quantity', 'total_qty', 'item count', 'pieces', 'no of items'],
  courier: ['courier', 'courier name', 'courier_partner', 'shipped by', 'logistics provider'],
  date: ['date', 'pickup date', 'pickup_date', 'order date', 'order_date', 'shipment date', 'shipment_date', 'dispatch date', 'dispatch_date', 'booking date', 'booking_date', 'created date', 'created_date'],
  deliveredDate: ['delivered date', 'delivered_date', 'delivery date', 'delivery_date', 'completed date', 'completed_date'],
};

// ===== Courier Template Detection =====
interface CourierTemplate {
  name: string;
  code: string;
  signatureColumns: string[];
}

const COURIER_TEMPLATES: CourierTemplate[] = [
  { name: 'Delhivery', code: 'delhivery', signatureColumns: ['awb', 'pickup date', 'consignee', 'pickup_location'] },
  { name: 'Ekart', code: 'ekart', signatureColumns: ['shipment no', 'ekart status', 'seller', 'seller sku'] },
  { name: 'Ecom Express', code: 'ecom_express', signatureColumns: ['awb number', 'customer name', 'ecom express', 'manifest'] },
  { name: 'Xpressbees', code: 'xpressbees', signatureColumns: ['awb', 'consignee name', 'xpressbees', 'forwarder'] },
  { name: 'Shadowfax', code: 'shadowfax', signatureColumns: ['order id', 'shadowfax', 'rider', 'tracking'] },
  { name: 'Amazon Shipping', code: 'amazon', signatureColumns: ['amazon', 'seller flex', 'order id', 'awb'] },
  { name: 'India Post', code: 'indiapost', signatureColumns: ['article no', 'article_number', 'india post', 'booking post office'] },
];

// ===== Status Mapping (courier → CRM) =====
// ===== Detection Functions =====

export interface ColumnMapping {
  phone?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  tracking?: string;
  orderId?: string;
  status?: string;
  cod?: string;
  product?: string;
  quantity?: string;
  courier?: string;
  date?: string;
  deliveredDate?: string;
}

export interface SheetInfo {
  name: string;
  rows: number;
}

export interface ImportStats {
  total: number;
  valid: number;
  duplicateOrderIds: number;
  duplicateTracking: number;
  invalidPhone: number;
  detectedCourier: string;
  sheets: SheetInfo[];
}

/**
 * Auto-detect columns in a flattened header row
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  for (const [field, aliases] of Object.entries(COLUMN_MAPS)) {
    for (const a of aliases) {
      const idx = lowerHeaders.findIndex((h, i) => !used.has(i) && (h === a || h.includes(a)));
      if (idx !== -1) {
        (mapping as any)[field] = headers[idx];
        used.add(idx);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Detect courier name from headers and sheet data sample
 */
export function detectCourier(headers: string[], sampleRow: any): string {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const headerStr = lowerHeaders.join(' ');

  for (const tpl of COURIER_TEMPLATES) {
    const matchCount = tpl.signatureColumns.filter(sc => headerStr.includes(sc)).length;
    if (matchCount >= 2) return tpl.name;
  }

  // Fallback: try matching any cell in first row against courier names
  if (sampleRow) {
    const rowStr = JSON.stringify(sampleRow).toLowerCase();
    for (const tpl of COURIER_TEMPLATES) {
      if (rowStr.includes(tpl.code)) return tpl.name;
    }
  }

  return 'Unknown Courier';
}

/**
 * Extract a value from a row using the detected column mapping
 */
export function getValue(row: any, mapping: ColumnMapping, field: keyof ColumnMapping): string {
  const col = mapping[field];
  if (!col) return '';
  const val = row[col];
  return val !== undefined && val !== null ? String(val).trim() : '';
}

/**
 * Normalize a courier status string into CRM status
 * Uses PRIORITY-BASED matching — checks specific patterns BEFORE generic ones.
 * Prevents "RTO Delivered" from incorrectly matching "Delivered".
 */
export function normalizeStatus(rawStatus: string): string {
  const lower = rawStatus.toLowerCase().trim();
  if (!lower) return 'In Transit';

  // Priority 1: RTO variants (MUST check before plain "delivered")
  if (lower.includes('rto delivered') || lower.includes('rto completed')) return 'RTO';
  if (lower.includes('rto in transit') || lower.includes('rto dispatched') || lower.includes('rto ofd') || lower.includes('rto hub scan')) return 'RTO';
  if (lower.startsWith('rto') || lower.includes('rto initiated') || lower.includes('return to origin') || lower === 'rto') return 'RTO';

  // Priority 2: NDR / Undelivered
  if (lower.includes('ndr') || lower.includes('customer not') || lower.includes('unreachable') || lower.includes('attempt failed') || lower.includes('return requested')) return 'Undelivered';
  if (lower.includes('undelivered')) return 'Undelivered';

  // Priority 3: Pure delivery success
  if (lower === 'delivered' || lower === 'delivered successfully' || lower.includes('shipment delivered') || lower.includes('consignee received') || lower.includes('delivered to customer') || lower.includes('completed') || lower.includes('signed by') || lower.includes('delivered in hand') || lower.includes('delivered at location')) return 'Delivered';

  // Priority 4: Out For Delivery
  if (lower.includes('out for delivery') || lower === 'ofd' || lower.includes('with delivery agent') || lower.includes('assigned to rider')) return 'Out For Delivery';

  // Priority 5: Shipped / In Transit
  if (lower.includes('in transit') || lower.includes('bag in transit') || lower.includes('shipment booked') || lower.includes('hub scan') || lower.includes('hub in') || lower.includes('hub out') || lower.includes('inward') || lower.includes('outward')) return 'In Transit';
  if (lower.includes('shipped') || lower.includes('dispatched') || lower.includes('ready to ship') || lower.includes('pickup done') || lower.includes('picked up') || lower.includes('pickup complete') || lower === 'booked' || lower.includes('manifested')) return 'Shipped';

  // Priority 6: Cancelled
  if (lower.includes('cancelled') || lower === 'cancel') return 'Cancelled';

  return 'In Transit';
}

/**
 * Normalize a phone number (strip non-digits, validate)
 * Supports Excel scientific notation and all Indian mobile formats.
 */
export function normalizePhone(phone: any): string {
  if (phone === undefined || phone === null) return '';

  let value = phone;

  // Excel scientific notation fix
  if (typeof value === 'number') {
    value = Math.round(value).toString();
  }

  value = String(value || '')
    .replace(/[^0-9]/g, '')
    .trim();

  if (value.startsWith('91') && value.length === 12) {
    value = value.slice(2);
  }
  if (value.startsWith('0') && value.length === 11) {
    value = value.slice(1);
  }

  if (/^[6-9]\d{9}$/.test(value)) {
    return value;
  }

  return '';
}

/**
 * Analyze a file's headers and sample to produce a preview
 */
export function analyzeCourierFile(
  rows: any[],
  headers: string[],
  sheetNames: string[]
): { mapping: ColumnMapping; courier: string; preview: ImportStats } {
  const sampleRow = rows.length > 0 ? rows[0] : null;
  const mapping = detectColumns(headers);
  const courier = detectCourier(headers, sampleRow);

  const phoneAliases = COLUMN_MAPS['phone'];
  const phoneCol = headers.find(h => phoneAliases.some(a => h.toLowerCase().includes(a))) || '';
  const trackingCol = mapping.tracking || '';
  const orderCol = mapping.orderId || '';

  const seenTracking = new Set<string>();
  const seenOrders = new Set<string>();

  let valid = 0;
  let dupOrders = 0;
  let dupTracking = 0;
  let invalidPhone = 0;

  for (const row of rows) {
    const rawPhone = phoneCol ? String(row[phoneCol] || '').trim() : '';
    const phone = normalizePhone(rawPhone);
    if (!phone || phone.length !== 10) {
      invalidPhone++;
      continue;
    }

    const tracking = trackingCol ? String(row[trackingCol] || '').trim() : '';
    const order = orderCol ? String(row[orderCol] || '').trim() : '';

    let isDuplicate = false;

    if (tracking && seenTracking.has(tracking)) { dupTracking++; isDuplicate = true; }
    else if (tracking) seenTracking.add(tracking);

    if (!isDuplicate && order && seenOrders.has(order)) { dupOrders++; isDuplicate = true; }
    else if (order) seenOrders.add(order);

    if (!isDuplicate) valid++;
  }

  return {
    mapping,
    courier,
    preview: {
      total: rows.length,
      valid,
      duplicateOrderIds: dupOrders,
      duplicateTracking: dupTracking,
      invalidPhone,
      detectedCourier: courier,
      sheets: sheetNames.map(name => ({ name, rows: 0 })),
    },
  };
}
