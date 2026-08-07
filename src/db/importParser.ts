// =====================================================================
// importParser.ts — shared CSV parsing + column mapping + normalization
// used by the Bulk Import module. Kept free of React/Dexie so it can be
// unit-tested directly.
// =====================================================================

export const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'customer name', 'customer', 'customername', 'full name', 'fullname', 'buyer', 'buyer name', 'buyername', 'consignee', 'consignee name'],
  mobile: ['mobile', 'phone', 'phone number', 'contact', 'mob', 'mob no', 'mobile no', 'mobileno', 'phone no', 'phoneno', 'contact no', 'contactno', 'customer mobile', 'customermobile', 'whatsapp', 'whatsapp number', 'consignee mobile', 'consigneemobile'],
  product: ['product', 'product name', 'productname', 'item', 'item name', 'product interested', 'interested product', 'sku', 'item description'],
  status: ['status', 'lead status', 'leadstatus', 'order status', 'shipment status', 'delivery status', 'current status'],
  source: ['source', 'lead source', 'leadsource', 'source of lead', 'platform', 'channel', 'channel name'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments', 'feedback', 'agent notes', 'delivery notes', 'remark'],
  address: ['address', 'full address', 'fulladdress', 'delivery address', 'customer address', 'billing address', 'consignee address', 'shipping address'],
  city: ['city', 'town', 'destination city'],
  state: ['state', 'province', 'region', 'destination state'],
  pincode: ['pincode', 'pin code', 'pin', 'zipcode', 'zip', 'postal code', 'delivery pincode'],
  amount: ['amount', 'expected amount', 'price', 'value', 'expectedamount', 'lead amount', 'expected price', 'cod amount', 'order amount', 'total amount', 'invoice value', 'collectable value'],
  followupDate: ['followup date', 'followup_date', 'follow up date', 'next call date', 'callback date', 'next followup', 'next call'],
  followupTime: ['followup time', 'followup_time', 'follow up time', 'next call time', 'callback time'],
  orderId: ['order id', 'orderid', 'order_id', 'order number', 'orderno', 'order_no', 'ref no', 'reference number', 'reference no'],
  courier: ['courier', 'courier name', 'couriername', 'courier partner', 'shipping partner', 'carrier', 'logistics partner'],
  trackingId: ['tracking id', 'trackingid', 'tracking_id', 'tracking number', 'trackingno', 'tracking_no', 'awb', 'awb no', 'awb number', 'awb_no', 'airwaybill', 'airwaybill number', 'consignment no'],
};

export const STATUS_MAP: Record<string, string> = {
  'new lead': 'New Lead', 'interested': 'Interested', 'callback': 'Callback',
  'followup': 'Followup', 'follow-up': 'Followup', 'follow up': 'Followup',
  'ring': 'Ring', 'calling': 'Ring',
  'order booked': 'Order Booked', 'not interested': 'Not Interested',
  'fake': 'Fake Lead', 'fake lead': 'Fake Lead',
  'delivered': 'Delivered', 'undelivered': 'Undelivered', 'intransit': 'In Transit',
  'in transit': 'In Transit', 'shipped': 'Shipped', 'rto': 'RTO',
  'pending': 'Order Booked', 'out for delivery': 'Out For Delivery',
  'in-transit': 'In Transit', 'delivered successfully': 'Delivered',
  'rto delivered': 'RTO', 'rto initiated': 'RTO', 'cancelled': 'Cancelled',
  'packed': 'Packed',
};

/**
 * Robust CSV parser: quoted fields, commas/newlines inside quotes, CRLF and a
 * UTF-8 BOM. Returns normalized { headers, rows } of string values.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  let s = String(text).replace(/^\uFEFF/, ''); // strip BOM
  if (s.startsWith('\r\n')) s = s.slice(2);
  const cells: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      cells.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++; // CRLF
      cells.push(cur); cur = '';
      cells.push('\n'); // row separator token
    } else {
      cur += ch;
    }
  }
  cells.push(cur);

  const rowsRaw: string[][] = [[]];
  for (const c of cells) {
    if (c === '\n') { rowsRaw.push([]); continue; }
    rowsRaw[rowsRaw.length - 1].push(c.trim());
  }
  while (rowsRaw.length && rowsRaw[rowsRaw.length - 1].every((v) => v === '')) rowsRaw.pop();

  if (!rowsRaw.length) return { headers: [], rows: [] };
  const headers = rowsRaw[0];
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < rowsRaw.length; r++) {
    const raw = rowsRaw[r];
    if (!raw.length || raw.every((v) => v === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = raw[c] ?? '';
    rows.push(obj);
  }
  return { headers, rows };
}

export function findColumn(row: Record<string, unknown>, field: string): string | null {
  const aliases = COLUMN_ALIASES[field];
  if (!aliases) return null;
  const rowKeys = Object.keys(row);
  for (const alias of aliases) {
    const match = rowKeys.find((k) => k.toLowerCase().trim() === alias);
    if (match) return match;
  }
  for (const alias of aliases) {
    const match = rowKeys.find((k) => k.toLowerCase().trim().includes(alias));
    if (match) return match;
  }
  return null;
}

export function getVal(row: Record<string, unknown>, field: string): string {
  const col = findColumn(row, field);
  if (!col) return '';
  const val = row[col];
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

/** Normalize any phone-ish value to a valid Indian 10-digit mobile, or ''. */
export function normalizeMobile(value: unknown): string {
  if (value === undefined || value === null) return '';
  let str = String(value).trim();
  // Excel stores long numbers in scientific notation (9.98877E+09) — recover.
  if (/[eE]/.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && Number.isFinite(num)) str = String(Math.trunc(num));
  }
  str = str.replace(/[\s\-\(\)\+]/g, '');
  if (str.startsWith('91') && str.length === 12) str = str.slice(2);
  if (str.startsWith('0') && str.length === 11) str = str.slice(1);
  if (/^[6-9]\d{9}$/.test(str)) return str;
  return '';
}
