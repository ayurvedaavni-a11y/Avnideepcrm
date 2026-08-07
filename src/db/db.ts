import Dexie, { Table } from 'dexie';
import { cleanupAllDuplicateLeads, migrateLogisticsToOrders } from './workflow';

export interface Customer {
  id?: number;
  mobile: string;
  name: string;
  alternateNumber?: string;
  address?: string;
  pincode?: string;
  city?: string;
  district?: string;
  state?: string;
  totalOrders: number;
  delivered: number;
  rto: number;
  cancelled: number;
  fakeCount: number;
  totalSpend: number;
  lastOrderDate?: string;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical' | 'Fake';
  currentStatus: LeadStatus;
  createdAt: string;
  updatedAt: string;
}

export type LeadStatus =
  | 'New Lead' | 'Assigned' | 'Calling' | 'Interested' | 'Ring' | 'Callback' | 'Callback Requested'
  | 'Followup' | 'Not Reachable' | 'Busy' | 'Order Booked' | 'Order Confirmed' | 'Order Cancelled'
  | 'Packing' | 'Packed' | 'Ready To Ship' | 'Shipped' | 'In Transit' | 'Out For Delivery'
  | 'Delivered' | 'Undelivered' | 'RTO' | 'Cancelled' | 'Wrong Number' | 'Duplicate Lead'
  | 'Already Purchased' | 'Closed' | 'Not Interested' | 'Fake Lead' | 'Fake Customer' | 'NDR Pending';

export interface Lead {
  id?: number;
  customerId: number;
  product: string;
  source: string;
  expectedAmount: number;
  priority: 'Low' | 'Medium' | 'High';
  status: LeadStatus;
  assignedAgent: string;
  assignedTo?: string;
  assignedAt?: string;
  callCount?: number;
  firstCallAt?: string;
  lastCallAt?: string;
  reminderDate?: string;
  reminderTime?: string;
  reminderReason?: string;
  notes: string;
  followupDate?: string;
  followupTime?: string;
  createdAt: string;
  updatedAt: string;
}

// Complete call history — every call is appended, never overwritten.
export interface CallLogEntry {
  id?: number;
  leadId: number;
  customerId?: number;
  telecallerId?: string;
  telecallerName: string;
  status: string;
  notes: string;
  followupDate?: string;
  followupTime?: string;
  reminderDate?: string;
  reminderTime?: string;
  reminderReason?: string;
  /** Call duration in seconds (telecaller-entered after a call). */
  durationSec?: number;
  createdAt: string;
}

export interface Order {
  id?: number;
  orderId: string;
  leadId?: number;
  customerId: number;
  product: string;
  qty: number;
  codAmount: number;
  courier?: string;
  trackingId?: string;
  status: 'Order Booked' | 'Packing' | 'Packed' | 'Ready To Ship' | 'Shipped' | 'In Transit' | 'Out For Delivery' | 'Delivered' | 'Undelivered' | 'RTO' | 'Cancelled';
  orderDate: string;
  shipmentDate?: string;
  /** Immutable booking attribution — the telecaller who booked this order.
   *  Stamped at creation and never follows a later lead reassignment, so
   *  commission always goes to the right person. */
  bookedBy?: string;
  bookedByName?: string;
  /** Set the moment the order reaches 'Delivered' (commission windows). */
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NDRCase {
  id?: number;
  orderId: number;
  customerId: number;
  reason: string;
  status: 'Pending' | 'Reattempt Scheduled' | 'Out For Reattempt' | 'Delivered' | 'RTO' | 'Cancelled' | 'Fake' | 'Resolved';
  attemptCount: number;
  agentName?: string;
  retryDate?: string;
  nextAction?: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  notes?: string;
  attempts?: any[];
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id?: number;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  isRead: boolean;
  linkTo?: string;
  createdAt: string;
}

export interface TimelineLog {
  id?: number;
  customerId: number;
  entityType: 'Lead' | 'Order' | 'NDR' | 'Customer' | 'Followup' | 'Note';
  entityId?: number;
  action: string;
  statusFrom?: string;
  statusTo?: string;
  notes?: string;
  agentName?: string;
  createdAt: string;
}

export interface Logistics {
  id?: number;
  orderId: number;
  status: 'Shipped' | 'In Transit' | 'Out For Delivery' | 'Delivered' | 'Undelivered' | 'RTO' | 'Cancelled';
  dispatchDate: string;
  lastUpdate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentScan {
  id?: number;
  orderId: number;
  logisticsId: number;
  status: string;
  normalizedStatus?: string;
  location?: string;
  remarks?: string;
  scanDate: string;
  source: 'import' | 'manual' | 'api';
  createdAt: string;
}

export interface Invoice {
  id?: number;
  invoiceNumber: string;
  orderId: number;          // 0 for manual invoices
  orderNumber?: string;
  customerId: number;
  customerName: string;
  customerMobile: string;
  billingAddress: string;
  shippingAddress: string;
  customerGSTIN?: string;
  product: string;          // For single-product orders (legacy); items[] preferred
  hsnCode: string;
  qty: number;
  rate: number;
  discount: number;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  deliveryCharge?: number;
  codCharge?: number;
  roundOff?: number;
  total: number;
  amountPaid?: number;
  balanceDue?: number;
  amountInWords: string;
  paymentStatus: 'Pending' | 'Paid' | 'Partial Paid' | 'COD Pending' | 'Cancelled' | 'Refunded';
  placeOfSupply: string;
  invoiceDate: string;
  status: 'Draft' | 'Active' | 'Unpaid' | 'Paid' | 'Partial Paid' | 'Cancelled';
  /** Tracks order fulfillment lifecycle: Pending → Shipped → In Transit → Out For Delivery → Delivered / RTO / Cancelled / Returned */
  fulfillmentStatus?: 'Pending' | 'Shipped' | 'In Transit' | 'Out For Delivery' | 'Delivered' | 'RTO' | 'Cancelled' | 'Returned';
  notes?: string;
  source?: 'auto' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id?: number;
  sku: string;
  name: string;
  description?: string;
  hsnCode: string;
  category?: string;
  purchasePrice: number;
  sellingPrice: number;
  gstRate: number;
  stockQty: number;
  lowStockAlert: number;
  unit?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLog {
  id?: number;
  productId: number;
  changeType: 'IN' | 'OUT' | 'ADJUSTMENT' | 'RTO_RESTORE' | 'CANCEL_RESTORE';
  qtyChange: number;
  qtyBefore: number;
  qtyAfter: number;
  reference?: string;
  orderId?: number;
  notes?: string;
  agentName?: string;
  createdAt: string;
}

export interface InvoiceItem {
  id?: number;
  invoiceId: number;
  productId?: number;
  productName: string;
  hsnCode: string;
  qty: number;
  rate: number;
  discount: number;
  gstRate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Payment {
  id?: number;
  invoiceId: number;
  customerId: number;
  amount: number;
  method: 'Cash' | 'UPI' | 'Bank Transfer' | 'Card' | 'COD' | 'Cheque' | 'Other';
  reference?: string;
  paymentDate: string;
  notes?: string;
  createdAt: string;
}

export interface SpaceLFollowup {
  id?: number;
  leadId: number;
  customerId: number;
  action: 'Scheduled' | 'Called' | 'WhatsApp' | 'Interested' | 'Not Interested' | 'Snoozed' | 'Re-engaged' | 'Order Booked' | 'Note' | 'Missed' | 'Converted';
  status: 'pending' | 'completed' | 'missed' | 'skipped';
  scheduledDate?: string;
  scheduledTime?: string;
  completedAt?: string;
  notes: string;
  agentName: string;
  nextFollowupDate?: string;
  nextFollowupTime?: string;
  createdAt: string;
}

export interface InvoiceSettings {
  id?: number;
  key: string;
  value: string;
  updatedAt: string;
}

export interface SyncMapEntry {
  id?: number;
  localTable: string;
  localId: number;
  cloudId: number;
}

export interface SyncQueueEntry {
  id?: number;
  table: string;
  action: 'insert' | 'update' | 'delete';
  localId?: number;
  record?: any;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
  createdAt: string;
}

export class CRMDatabase extends Dexie {
  customers!: Table<Customer, number>;
  leads!: Table<Lead, number>;
  orders!: Table<Order, number>;
  logistics!: Table<Logistics, number>;
  ndrCases!: Table<NDRCase, number>;
  notifications!: Table<Notification, number>;
  timelineLogs!: Table<TimelineLog, number>;
  invoices!: Table<Invoice, number>;
  products!: Table<Product, number>;
  inventoryLogs!: Table<InventoryLog, number>;
  invoiceItems!: Table<InvoiceItem, number>;
  payments!: Table<Payment, number>;
  invoiceSettings!: Table<InvoiceSettings, number>;
  shipmentScans!: Table<ShipmentScan, number>;
  spacelFollowups!: Table<SpaceLFollowup, number>;
  callLogs!: Table<CallLogEntry, number>;
  syncMap!: Table<SyncMapEntry, number>;
  syncQueue!: Table<SyncQueueEntry, number>;

  constructor() {
    super('AvnideepCRMProDB');
    this.version(12).stores({
      customers: '++id, &mobile, name, riskLevel, currentStatus, lastOrderDate',
      leads: '++id, customerId, status, followupDate, priority, assignedAgent',
      orders: '++id, &orderId, leadId, customerId, status, trackingId, orderDate',
      logistics: '++id, orderId, status, dispatchDate',
      ndrCases: '++id, orderId, customerId, status, retryDate',
      notifications: '++id, isRead, createdAt',
      timelineLogs: '++id, customerId, entityType, entityId, createdAt',
      invoices: '++id, &invoiceNumber, orderId, orderNumber, customerId, paymentStatus, status, invoiceDate',
      // NOTE: &orderId removed intentionally. The One Order = One Invoice rule is enforced
      // programmatically inside autoGenerateInvoice() which runs inside an atomic Dexie
      // transaction. Manual invoices use orderId=0 and would break with a unique constraint.
      // The programmatic check + atomic transaction is race-condition-safe.
      products: '++id, &sku, name, hsnCode, category, isActive',
      inventoryLogs: '++id, productId, changeType, createdAt',
      invoiceItems: '++id, invoiceId, productId',
      payments: '++id, invoiceId, customerId, paymentDate',
      invoiceSettings: '++id, &key',
      shipmentScans: '++id, orderId, logisticsId, scanDate',
      spacelFollowups: '++id, leadId, customerId, action, status, scheduledDate, createdAt',
      syncMap: '++id, [localTable+localId], [localTable+cloudId]',
      syncQueue: '++id, table, createdAt',
    });

    this.version(13).stores({
      customers: '++id, &mobile, name, riskLevel, currentStatus, lastOrderDate',
      leads: '++id, customerId, status, followupDate, priority, assignedAgent, assignedTo',
      orders: '++id, &orderId, leadId, customerId, status, trackingId, orderDate',
      logistics: '++id, orderId, status, dispatchDate',
      ndrCases: '++id, orderId, customerId, status, retryDate',
      notifications: '++id, isRead, createdAt',
      timelineLogs: '++id, customerId, entityType, entityId, createdAt',
      invoices: '++id, &invoiceNumber, orderId, orderNumber, customerId, paymentStatus, status, invoiceDate',
      products: '++id, &sku, name, hsnCode, category, isActive',
      inventoryLogs: '++id, productId, changeType, createdAt',
      invoiceItems: '++id, invoiceId, productId',
      payments: '++id, invoiceId, customerId, paymentDate',
      invoiceSettings: '++id, &key',
      shipmentScans: '++id, orderId, logisticsId, scanDate',
      spacelFollowups: '++id, leadId, customerId, action, status, scheduledDate, createdAt',
      callLogs: '++id, leadId, customerId, telecallerId, status, createdAt',
      syncMap: '++id, [localTable+localId], [localTable+cloudId]',
      syncQueue: '++id, table, createdAt',
    });
  }
}

export const db = new CRMDatabase();

// ===================================================================
// PRODUCTION SAFETY: Auto DB corruption recovery
// ===================================================================
db.open().catch(async (error) => {
  console.error("Failed to open local database, attempting automatic recovery:", error);
  try {
    await db.delete();
    await db.open();
    window.location.reload();
  } catch (err) {
    console.error("Critical database initialization error:", err);
  }
});

// ===================================================================
// PRODUCTION SAFETY: Startup dedup cleanup
// On every app start, scan for and remove duplicate lead records.
// This ensures that even if a bug creates duplicates during a session,
// the next app startup will clean them up automatically.
// 
// Runs AFTER the database is confirmed open (via db.open().then())
// to avoid any race conditions with database initialization.
// ===================================================================
db.open().then(async () => {
  try {
    await cleanupAllDuplicateLeads();
  } catch (error) {
    // Silent fail — dedup is a safety net, not a critical path
    console.warn('[DB] Startup dedup skipped:', error);
  }
  // SINGLE SOURCE OF TRUTH: fold any legacy logistics-record status into the
  // order and drop the local table — order.status is the only master status.
  try {
    const n = await migrateLogisticsToOrders();
    if (n > 0) console.log('[DB] Reconciled', n, 'order(s) from legacy logistics records');
  } catch (error) {
    console.warn('[DB] Logistics reconciliation skipped:', error);
  }
});
