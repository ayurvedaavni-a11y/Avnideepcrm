// AVNIDEEP CRM PRO — Centralized Strict Data Models

export type LeadStatus =
  | 'New Lead'
  | 'Interested'
  | 'Callback'
  | 'Followup'
  | 'Order Booked'
  | 'Not Interested'
  | 'Ring'
  | 'Fake Lead';

export type OrderStatus =
  | 'Pending'
  | 'Order Booked'
  | 'Packing'
  | 'Packed'
  | 'Ready To Ship'
  | 'Shipped'
  | 'In Transit'
  | 'Out For Delivery'
  | 'Delivered'
  | 'Undelivered'
  | 'RTO'
  | 'Cancelled';

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
  currentStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id?: number;
  customerId: number;
  product: string;
  source: string;
  expectedAmount: number;
  priority: 'Low' | 'Medium' | 'High';
  status: LeadStatus;
  assignedAgent: string;
  notes: string;
  followupDate?: string;
  followupTime?: string;
  createdAt: string;
  updatedAt: string;
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
  status: OrderStatus;
  orderDate: string;
  shipmentDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shipment {
  id?: number;
  orderId: number;
  awb?: string;
  courier?: string;
  customerName?: string;
  phone?: string;
  address?: string;
  pincode?: string;
  codAmount?: number;
  shipmentStatus: string;
  scansHistory?: string;
  pickupDate?: string;
  dispatchDate?: string;
  deliveryDate?: string;
  rtoDate?: string;
  ndrReason?: string;
  deliveryAttempts?: number;
  courierRemarks?: string;
  currentHub?: string;
  expectedDeliveryDate?: string;
  lastUpdate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id?: number;
  invoiceNumber: string;
  orderId: number;
  customerId: number;
  customerName: string;
  customerMobile: string;
  billingAddress: string;
  shippingAddress: string;
  customerGSTIN?: string;
  product: string;
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

export interface CompanySettings {
  name: string;
  tagline: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode?: string;
  gstin: string;
  phone: string;
  email: string;
  logoBase64?: string;
  signatureBase64?: string;
  bankName: string;
  bankAccount: string;
  bankIFSC: string;
  termsConditions: string;
  invoicePrefix: string;
  hsnDefault: string;
}

export interface GSTSettings {
  gstEnabled: boolean;
  gstRate: number;
  gstMode: 'exclusive' | 'inclusive';
  gstBeforeDiscount: boolean;
  deliveryCharge: number;
  codCharge: number;
  roundOffEnabled: boolean;
  currency: string;
}
