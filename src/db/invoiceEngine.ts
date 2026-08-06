import { db, Invoice } from './db';
import { toast } from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getGSTConfig, getCompanyConfig } from './settingsEngine';
import { safeMoney } from '../lib/safe';
import { resolveCustomerState } from './stateResolver';

// ===== Centralized GST Decision Engine =====
export function isSameState(customerState: string, companyState: string): boolean {
  const c = String(customerState || '').trim().toLowerCase();
  const co = String(companyState || '').trim().toLowerCase();
  return c === co && c !== '' && c !== 'unknown';
}

/**
 * Round to 2 decimal places safely (avoids floating point issues).
 */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Centralized GST calculation — single source of truth.
 *
 * INCLUSIVE mode (price already contains GST):
 *   Taxable = amount / (1 + gstRate/100)
 *   GST = amount - taxable
 *   Grand Total = amount (unchanged)
 *
 * EXCLUSIVE mode (price excludes GST):
 *   GST = amount * gstRate / 100
 *   Grand Total = amount + GST
 *
 * Same state → CGST = GST/2, SGST = GST/2
 * Different state → IGST = GST, CGST = 0, SGST = 0
 */
export function calculateGST({
  amount,
  gstRate = 5,
  gstMode = 'exclusive',
  gstEnabled = true,
  customerState,
  companyState,
}: {
  amount: number;
  gstRate?: number;
  gstMode?: 'inclusive' | 'exclusive';
  gstEnabled?: boolean;
  customerState: string;
  companyState: string;
}): {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  grandTotal: number;
  sameState: boolean;
} {
  const rawAmount = Number(amount || 0);
  if (!gstEnabled || rawAmount <= 0) {
    return { taxable: rawAmount, cgst: 0, sgst: 0, igst: 0, totalGST: 0, grandTotal: rawAmount, sameState: true };
  }

  const sameState = isSameState(customerState, companyState);
  let taxable: number;
  let totalGST: number;

  if (gstMode === 'inclusive') {
    // Price already includes GST — back-calculate
    taxable = r2(rawAmount / (1 + gstRate / 100));
    totalGST = r2(rawAmount - taxable);
  } else {
    // Exclusive — add GST on top
    taxable = rawAmount;
    totalGST = r2(rawAmount * (gstRate / 100));
  }

  let cgst = 0, sgst = 0, igst = 0;
  if (sameState) {
    cgst = r2(totalGST / 2);
    sgst = r2(totalGST - cgst); // avoid rounding drift
  } else {
    igst = totalGST;
  }

  const grandTotal = gstMode === 'inclusive' ? rawAmount : r2(taxable + cgst + sgst + igst);

  return { taxable, cgst, sgst, igst, totalGST: r2(cgst + sgst + igst), grandTotal, sameState };
}

function sanitizePdfAmount(value: any): string {
  const num = Number(value || 0);
  const safe = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

function numberToWordsIndian(num: number): string {
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten','Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
    return '';
  };
  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);
  let words = '';
  let n = integerPart;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) words += inWords(crore) + ' Crore ';
  if (lakh) words += inWords(lakh) + ' Lakh ';
  if (thousand) words += inWords(thousand) + ' Thousand ';
  if (n) words += inWords(n) + ' ';
  words = words.trim() + ' Rupees';
  if (decimalPart > 0) words += ' and ' + inWords(decimalPart) + ' Paise';
  words += ' Only';
  return words;
}

export async function generateInvoiceNumber(companyCfg?: any): Promise<string> {
  const yearSuffix = (new Date().getFullYear() % 100).toString();
  const prefixBase = (companyCfg?.invoicePrefix || 'AD');
  const prefix = `${prefixBase}${yearSuffix}-`;
  const latest = await db.invoices.filter(inv => inv.invoiceNumber.startsWith(prefix)).reverse().sortBy('invoiceNumber');
  let nextNumber = 1;
  if (latest.length > 0) {
    const lastNum = latest[0].invoiceNumber.replace(prefix, '');
    const parsed = parseInt(lastNum, 10);
    if (!isNaN(parsed)) nextNumber = parsed + 1;
  }
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

export async function autoGenerateInvoice(orderId: number, agentName: string = 'System'): Promise<Invoice | null> {
  try {
    if (orderId <= 0) {
      console.warn('[InvoiceEngine] Cannot auto-generate invoice for orderId <= 0 (manual invoice)');
      return null;
    }

    const gstCfg = await getGSTConfig();
    const companyCfg = await getCompanyConfig();

    const result = await db.transaction('rw', [db.invoices, db.orders, db.customers, db.timelineLogs], async () => {
      // 1. STRICT IDEMPOTENCY: Check if invoice already exists for this orderId
      // This check runs inside an atomic Dexie transaction, so there is NO race condition.
      // Combined with the (now removed) &orderId unique index, the One Order = One Invoice
      // rule is enforced solely by this programmatic check inside the transaction.
      const existing = await db.invoices.where('orderId').equals(orderId).first();
      
      const order = await db.orders.get(orderId);
      if (!order) return null;
      const customer = await db.customers.get(order.customerId);
      if (!customer) return null;

      const rate = safeMoney(order.codAmount);
      const qty = order.qty || 1;
      const lineAmount = rate * qty;

      const customerState = resolveCustomerState({
        state: customer.state,
        pincode: customer.pincode,
        address: customer.address,
      });
      const companyState = companyCfg.state || 'Unknown';

      const gst = calculateGST({ amount: lineAmount, gstRate: gstCfg.gstRate, gstMode: gstCfg.gstMode, gstEnabled: gstCfg.gstEnabled, customerState, companyState });

      const deliveryCharge = safeMoney(gstCfg.deliveryCharge);
      const codCharge = safeMoney(gstCfg.codCharge);
      const totalRaw = gst.grandTotal + deliveryCharge + codCharge;
      const roundOff = gstCfg.roundOffEnabled ? Math.round(totalRaw) - totalRaw : 0;
      const total = totalRaw + roundOff;

      const address = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ');

      if (existing) {
        // 2. ENFORCE UPDATE ONLY: Never overwrite payment fields that were manually set.
        // Only update customer info, product details, and amounts.
        // Payment status, amountPaid, and balanceDue are managed by recordPayment() and syncInvoiceWithOrderStatus().
        
        // Preserve existing payment data — NEVER overwrite paid amounts
        const preservedAmountPaid = existing.amountPaid || 0;
        const preservedBalanceDue = existing.balanceDue ?? existing.total;
        
        // Update fulfillment status from order status
        const fulfillmentMap: Record<string, string> = {
          'Order Booked': 'Pending',
          'Packing': 'Pending',
          'Packed': 'Pending',
          'Ready To Ship': 'Pending',
          'Shipped': 'Shipped',
          'In Transit': 'In Transit',
          'Out For Delivery': 'Out For Delivery',
          'Delivered': 'Delivered',
          'RTO': 'RTO',
          'Cancelled': 'Cancelled',
          'Returned': 'Returned',
        };
        const fulfillmentStatus = (fulfillmentMap[order.status] || 'Pending') as Invoice['fulfillmentStatus'];

        await db.invoices.update(existing.id!, {
          customerName: customer.name,
          customerMobile: customer.mobile,
          billingAddress: address,
          shippingAddress: address,
          product: order.product,
          qty,
          rate,
          subtotal: gst.taxable,
          cgst: gst.cgst,
          sgst: gst.sgst,
          igst: gst.igst,
          total,
          fulfillmentStatus,
          amountPaid: preservedAmountPaid,
          balanceDue: preservedBalanceDue,
          updatedAt: new Date().toISOString()
        });
        return await db.invoices.get(existing.id!);
      }

      // 3. INITIAL CREATION: Only if NO existing invoice for this orderId
      const invoiceNumber = await generateInvoiceNumber(companyCfg);

      // Map order status to fulfillment status
      const initialFulfillmentMap: Record<string, string> = {
        'Order Booked': 'Pending',
        'Packing': 'Pending',
        'Packed': 'Pending',
        'Ready To Ship': 'Pending',
        'Shipped': 'Shipped',
        'In Transit': 'In Transit',
        'Out For Delivery': 'Out For Delivery',
        'Delivered': 'Delivered',
        'RTO': 'RTO',
        'Cancelled': 'Cancelled',
        'Returned': 'Returned',
      };
      const fulfillmentStatus = (initialFulfillmentMap[order.status] || 'Pending') as Invoice['fulfillmentStatus'];

      const invoice: Invoice = {
        invoiceNumber,
        orderId,
        orderNumber: order.orderId, 
        customerId: customer.id!,
        customerName: customer.name,
        customerMobile: customer.mobile,
        billingAddress: address,
        shippingAddress: address,
        product: order.product,
        hsnCode: companyCfg.hsnDefault || '',
        qty,
        rate,
        discount: 0,
        subtotal: gst.taxable,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
        deliveryCharge,
        codCharge,
        roundOff,
        total,
        amountPaid: 0,
        balanceDue: total,
        amountInWords: numberToWordsIndian(total),
        paymentStatus: order.status === 'Delivered' ? 'Paid' : 'COD Pending',
        fulfillmentStatus,
        placeOfSupply: customerState || companyState,
        invoiceDate: new Date().toISOString(),
        status: 'Unpaid',
        source: 'auto',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const newId = await db.invoices.add(invoice);
      
      await db.timelineLogs.add({
        customerId: customer.id!,
        entityType: 'Order',
        entityId: orderId,
        action: `Invoice ${invoiceNumber} Generated`,
        notes: `Order ${order.orderId} bound to unique invoice ${invoiceNumber}`,
        agentName,
        createdAt: new Date().toISOString(),
      });

      return { ...invoice, id: newId };
    });
    return result || null;
  } catch (err) {
    console.error('[InvoiceEngine] Auto-generate failed:', err);
    return null;
  }
}

/**
 * ORDER STATUS → INVOICE FULFILLMENT STATUS MAPPING
 * 
 * Order Status          → Invoice Fulfillment Status
 * ─────────────────────────────────────────────────
 * Order Booked / Packing / Packed / Ready To Ship  → Pending
 * Shipped                                           → Shipped
 * In Transit                                        → In Transit
 * Out For Delivery                                  → Out For Delivery
 * Delivered                                         → Delivered  +  payment: Paid (COD auto-collect)
 * RTO                                               → RTO        +  payment: Cancelled
 * Cancelled                                         → Cancelled  +  payment: Cancelled
 * Returned                                          → Returned
 *
 * STRICT RULE: One Order = One Invoice. NEVER create a new invoice.
 * Only update the existing invoice's fulfillmentStatus and paymentStatus.
 */
export async function syncInvoiceWithOrderStatus(orderId: number, orderStatus: string) {
  try {
    const invoice = await db.invoices.where('orderId').equals(orderId).first();
    if (!invoice) {
      console.warn(`[InvoiceEngine] No invoice found for order ${orderId}, skipping sync`);
      return;
    }

    // ===== STEP 1: Map order status to fulfillment status =====
    const fulfillmentStatusMap: Record<string, string> = {
      'Order Booked': 'Pending',
      'Packing': 'Pending',
      'Packed': 'Pending',
      'Ready To Ship': 'Pending',
      'Shipped': 'Shipped',
      'In Transit': 'In Transit',
      'Out For Delivery': 'Out For Delivery',
      'Delivered': 'Delivered',
      'RTO': 'RTO',
      'Cancelled': 'Cancelled',
      'Returned': 'Returned',
      'Undelivered': 'Pending',
    };

    const newFulfillmentStatus = fulfillmentStatusMap[orderStatus] || 'Pending';
    
    // ===== STEP 2: Determine payment-related status changes =====
    let paymentStatus = invoice.paymentStatus;
    let status = invoice.status;
    let amountPaid = invoice.amountPaid || 0;
    let balanceDue = invoice.balanceDue ?? invoice.total;

    // Only auto-update payment if it hasn't been manually changed
    const wasPaymentManuallySet = invoice.amountPaid && invoice.amountPaid > 0 && invoice.status === 'Paid';

    if (orderStatus === 'Delivered') {
      // Auto mark as paid ONLY if not already paid manually
      if (!wasPaymentManuallySet) {
        paymentStatus = 'Paid';
        status = 'Paid';
        amountPaid = invoice.total;
        balanceDue = 0;
      }
    } else if (orderStatus === 'RTO' || orderStatus === 'Cancelled') {
      // Never overwrite actual payments with cancellations
      if (!wasPaymentManuallySet) {
        paymentStatus = 'Cancelled';
        status = 'Cancelled';
      }
    }

    // ===== STEP 3: Check if anything actually changed =====
    const fulfillmentChanged = invoice.fulfillmentStatus !== newFulfillmentStatus;
    const paymentChanged = paymentStatus !== invoice.paymentStatus || status !== invoice.status;

    if (!fulfillmentChanged && !paymentChanged) {
      return; // Nothing to update
    }

    // ===== STEP 4: Apply updates =====
    await db.invoices.update(invoice.id!, {
      fulfillmentStatus: newFulfillmentStatus as Invoice['fulfillmentStatus'],
      paymentStatus,
      status,
      amountPaid,
      balanceDue,
      updatedAt: new Date().toISOString(),
    });

    // ===== STEP 5: Auto-create COD payment record (only once!) =====
    if (orderStatus === 'Delivered' && invoice.id) {
      // Check if a COD auto-payment already exists for this invoice
      const existingAutoPayment = await db.payments
        .where('invoiceId').equals(invoice.id)
        .filter(p => p.method === 'COD' && (p.reference?.includes('Auto on delivery') ?? false))
        .first();
      
      if (!existingAutoPayment) {
        await db.payments.add({
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          amount: invoice.total,
          method: 'COD',
          reference: `Auto on delivery (Order ${orderId})`,
          paymentDate: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      }
    }

    // ===== STEP 6: Log timeline event =====
    let actionParts: string[] = [];
    if (fulfillmentChanged) actionParts.push(`${newFulfillmentStatus}`);
    if (paymentChanged && orderStatus === 'Delivered') actionParts.push('PAID');
    if (paymentChanged && (orderStatus === 'RTO' || orderStatus === 'Cancelled')) actionParts.push('CANCELLED');
    
    if (actionParts.length > 0) {
      await db.timelineLogs.add({
        customerId: invoice.customerId,
        entityType: 'Order',
        entityId: orderId,
        action: `Invoice ${invoice.invoiceNumber} — ${actionParts.join(' / ')}`,
        notes: `Order status: ${orderStatus} → Invoice fulfillment: ${newFulfillmentStatus} | Payment: ${paymentStatus}`,
        agentName: 'System',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[InvoiceEngine] Sync failed:', err);
  }
}

export async function recordPayment(invoiceId: number, amount: number, method: 'Cash' | 'UPI' | 'Bank Transfer' | 'Card' | 'COD' | 'Cheque' | 'Other', reference: string = '', notes: string = ''): Promise<boolean> {
  try {
    return await db.transaction('rw', [db.invoices, db.payments, db.timelineLogs], async () => {
      const invoice = await db.invoices.get(invoiceId);
      if (!invoice) return false;
      await db.payments.add({ invoiceId, customerId: invoice.customerId, amount, method, reference, notes, paymentDate: new Date().toISOString(), createdAt: new Date().toISOString() });
      const newPaid = (invoice.amountPaid || 0) + amount;
      const newBalance = Math.max(0, invoice.total - newPaid);
      let newStatus: Invoice['status'] = invoice.status;
      let newPaymentStatus: Invoice['paymentStatus'] = invoice.paymentStatus;
      if (newBalance <= 0.01) { newStatus = 'Paid'; newPaymentStatus = 'Paid'; }
      else if (newPaid > 0) { newStatus = 'Partial Paid'; newPaymentStatus = 'Partial Paid'; }
      await db.invoices.update(invoiceId, { amountPaid: newPaid, balanceDue: newBalance, status: newStatus, paymentStatus: newPaymentStatus, updatedAt: new Date().toISOString() });
      await db.timelineLogs.add({ customerId: invoice.customerId, entityType: 'Order', entityId: invoice.orderId, action: `Payment Recorded — ₹${amount.toFixed(2)} (${method})`, notes: `Invoice ${invoice.invoiceNumber}: ${reference || 'Manual entry'}. Balance: ₹${newBalance.toFixed(2)}`, agentName: 'Admin', createdAt: new Date().toISOString() });
      return true;
    });
  } catch (err) {
    console.error('[InvoiceEngine] recordPayment failed:', err);
    return false;
  }
}

export async function createManualInvoice(payload: {
  customerId: number;
  orderId?: number;  // If provided, invoice links to actual order (fixes lead→invoice sync bug)
  items: Array<{ productId?: number; productName: string; hsnCode: string; qty: number; rate: number; discount: number; gstRate: number }>;
  deliveryCharge?: number;
  codCharge?: number;
  notes?: string;
}): Promise<Invoice | null> {
  try {
    const gstCfg = await getGSTConfig();
    const companyCfg = await getCompanyConfig();

    return await db.transaction('rw', [db.invoices, db.invoiceItems, db.customers, db.timelineLogs, db.products, db.inventoryLogs], async () => {
      const customer = await db.customers.get(payload.customerId);
      if (!customer) return null;

      const customerState = resolveCustomerState({
        state: customer.state,
        pincode: customer.pincode,
        address: customer.address,
      });
      const companyState = companyCfg.state || 'Unknown';

      let grandSubtotal = 0, grandCgst = 0, grandSgst = 0, grandIgst = 0;
      const processedItems: any[] = [];

      for (const it of payload.items) {
        const qty = Number(it.qty) || 1;
        const rate = safeMoney(it.rate);
        const discount = safeMoney(it.discount);
        const lineAmount = qty * rate - discount;
        const gst = calculateGST({ amount: lineAmount, gstRate: it.gstRate || gstCfg.gstRate, gstMode: gstCfg.gstMode, gstEnabled: gstCfg.gstEnabled, customerState, companyState });
        // Use gst.taxable as the true taxable amount (handles both inclusive and exclusive correctly)
        grandSubtotal += gst.taxable;
        grandCgst += gst.cgst;
        grandSgst += gst.sgst;
        grandIgst += gst.igst;
        processedItems.push({ productId: it.productId, productName: it.productName, hsnCode: it.hsnCode || companyCfg.hsnDefault, qty, rate, discount, gstRate: it.gstRate || gstCfg.gstRate, taxableAmount: gst.taxable, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst, total: gst.grandTotal });
      }

      const delivery = safeMoney(payload.deliveryCharge) || safeMoney(gstCfg.deliveryCharge);
      const cod = safeMoney(payload.codCharge) || safeMoney(gstCfg.codCharge);
      const rawTotal = grandSubtotal + grandCgst + grandSgst + grandIgst + delivery + cod;
      const roundOff = gstCfg.roundOffEnabled ? Math.round(rawTotal) - rawTotal : 0;
      const finalTotal = rawTotal + roundOff;
      const invoiceNumber = await generateInvoiceNumber(companyCfg);
      const address = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ');

      // Use payload.orderId if provided (links invoice to actual order for proper status sync),
      // otherwise use a unique negative orderId for standalone manual invoices
      // (negative prevents collision with auto-generated positive orderIds)
      const manualOrderId = payload.orderId ?? -(Date.now() * 10000 + Math.floor(Math.random() * 10000));
      const invoice: Invoice = {
        invoiceNumber,
        orderId: manualOrderId,
        customerId: customer.id!,
        customerName: customer.name,
        customerMobile: customer.mobile,
        billingAddress: address,
        shippingAddress: address,
        product: processedItems.map(p => p.productName).join(', '),
        hsnCode: processedItems[0]?.hsnCode || companyCfg.hsnDefault,
        qty: processedItems.reduce((a, b) => a + b.qty, 0),
        rate: processedItems[0]?.rate || 0,
        discount: 0,
        subtotal: grandSubtotal,
        cgst: grandCgst,
        sgst: grandSgst,
        igst: grandIgst,
        deliveryCharge: delivery,
        codCharge: cod,
        roundOff,
        total: finalTotal,
        amountPaid: 0,
        balanceDue: finalTotal,
        amountInWords: numberToWordsIndian(finalTotal),
        paymentStatus: 'Pending',
        placeOfSupply: customerState || companyState,
        invoiceDate: new Date().toISOString(),
        status: 'Unpaid',
        notes: payload.notes,
        source: 'manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const newId = await db.invoices.add(invoice);
      invoice.id = newId;
      for (const item of processedItems) {
        await db.invoiceItems.add({ ...item, invoiceId: newId });
        if (item.productId) {
          const product = await db.products.get(item.productId);
          if (product && product.id) {
            const newStock = Math.max(0, (product.stockQty || 0) - item.qty);
            await db.products.update(product.id, { stockQty: newStock, updatedAt: new Date().toISOString() });
            await db.inventoryLogs.add({ productId: product.id, changeType: 'OUT', qtyChange: -item.qty, qtyBefore: product.stockQty, qtyAfter: newStock, reference: `Manual Invoice ${invoiceNumber}`, agentName: 'Admin', createdAt: new Date().toISOString() });
          }
        }
      }
      await db.timelineLogs.add({ customerId: customer.id!, entityType: 'Order', entityId: 0, action: `Manual Invoice ${invoiceNumber} Created`, notes: `Manual invoice for ₹${finalTotal.toFixed(2)} — ${processedItems.length} items | GST: ${grandCgst > 0 ? 'CGST+SGST' : 'IGST'}`, agentName: 'Admin', createdAt: new Date().toISOString() });
      return invoice;
    });
  } catch (err) {
    console.error('[InvoiceEngine] createManualInvoice failed:', err);
    return null;
  }
}

export function generateInvoicePDF(invoice: Invoice, companyCfg: any): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(companyCfg.name, 14, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(companyCfg.tagline, 14, y + 10);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('TAX INVOICE', pageWidth - 14, y + 4, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, pageWidth - 14, y + 10, { align: 'right' });
  doc.text(`Date: ${new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}`, pageWidth - 14, y + 15, { align: 'right' });

  y += 22; doc.setDrawColor(226, 232, 240); doc.line(14, y, pageWidth - 14, y);

  y += 6;
  doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  doc.text(`${companyCfg.address}`, 14, y);
  doc.text(`${companyCfg.city}`, 14, y + 4);
  doc.text(`GSTIN: ${companyCfg.gstin}`, 14, y + 8);
  doc.text(`Phone: ${companyCfg.phone}  |  Email: ${companyCfg.email}`, 14, y + 12);

  const statusColor: [number, number, number] = invoice.paymentStatus === 'Paid' ? [16, 185, 129] : invoice.paymentStatus === 'Cancelled' ? [239, 68, 68] : [245, 158, 11];
  doc.setFillColor(...statusColor);
  doc.roundedRect(pageWidth - 50, y, 36, 8, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(invoice.paymentStatus.toUpperCase(), pageWidth - 32, y + 5.5, { align: 'center' });

  y += 20;
  doc.setFillColor(248, 250, 252);
  doc.rect(14, y, (pageWidth - 28) / 2 - 2, 30, 'F');
  doc.rect(14 + (pageWidth - 28) / 2 + 2, y, (pageWidth - 28) / 2 - 2, 30, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text('BILL TO', 18, y + 5);
  doc.text('SHIP TO', 18 + (pageWidth - 28) / 2 + 2, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(invoice.customerName, 18, y + 11);
  doc.text(`Mobile: ${invoice.customerMobile}`, 18, y + 16);
  const billLines = doc.splitTextToSize(invoice.billingAddress || 'N/A', (pageWidth - 28) / 2 - 8);
  doc.text(billLines.slice(0, 2), 18, y + 21);
  doc.text(invoice.customerName, 18 + (pageWidth - 28) / 2 + 2, y + 11);
  doc.text(`Mobile: ${invoice.customerMobile}`, 18 + (pageWidth - 28) / 2 + 2, y + 16);
  const shipLines = doc.splitTextToSize(invoice.shippingAddress || 'N/A', (pageWidth - 28) / 2 - 8);
  doc.text(shipLines.slice(0, 2), 18 + (pageWidth - 28) / 2 + 2, y + 21);

  y += 36; doc.setFontSize(8); doc.text(`Place of Supply: ${invoice.placeOfSupply}`, 14, y); doc.text(`Payment Mode: COD`, pageWidth - 14, y, { align: 'right' });

  y += 5;
  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Discount', 'Amount']],
    body: [['1', invoice.product, invoice.hsnCode, String(invoice.qty), `INR ${sanitizePdfAmount(invoice.rate)}`, `INR ${sanitizePdfAmount(invoice.discount)}`, `INR ${sanitizePdfAmount(invoice.subtotal)}`]],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255,255,255], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: [51,65,85] },
    margin: { left: 14, right: 14 },
  });

  let finalY = (doc as any).lastAutoTable.finalY + 8;
  const rightCol = pageWidth - 14;
  const labelCol = pageWidth - 70;
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);

  // GST Mode badge
  const gstMode = companyCfg?.gstMode || 'exclusive';
  const gstLabel = gstMode === 'inclusive' ? ' (Included)' : ' (Extra)';
  const subLabel = gstMode === 'inclusive' ? 'Taxable Amount:' : 'Subtotal:';

  // Smart subtotal display: if subtotal equals total (old buggy data), recalculate taxable
  const totalTax = safeMoney(invoice.cgst) + safeMoney(invoice.sgst) + safeMoney(invoice.igst);
  const displaySubtotal = (gstMode === 'inclusive' && Math.abs(safeMoney(invoice.subtotal) - safeMoney(invoice.total)) < 0.01)
    ? safeMoney(invoice.total) - totalTax
    : safeMoney(invoice.subtotal);

  doc.text(subLabel, labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(displaySubtotal)}`, rightCol, finalY, { align: 'right' });

  if (invoice.cgst > 0) {
    finalY += 5;
    doc.text(`CGST (2.5%${gstLabel}):`, labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(invoice.cgst)}`, rightCol, finalY, { align: 'right' });
    finalY += 5;
    doc.text(`SGST (2.5%${gstLabel}):`, labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(invoice.sgst)}`, rightCol, finalY, { align: 'right' });
  } else if (invoice.igst > 0) {
    finalY += 5;
    doc.text(`IGST (5%${gstLabel}):`, labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(invoice.igst)}`, rightCol, finalY, { align: 'right' });
  }

  if (invoice.deliveryCharge) { finalY += 5; doc.text('Shipping:', labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(invoice.deliveryCharge)}`, rightCol, finalY, { align: 'right' }); }
  if (invoice.codCharge) { finalY += 5; doc.text('COD Charge:', labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(invoice.codCharge)}`, rightCol, finalY, { align: 'right' }); }

  finalY += 8; doc.setDrawColor(15, 23, 42); doc.setLineWidth(0.3); doc.line(labelCol, finalY - 4, rightCol, finalY - 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
  const totalLabel = gstMode === 'inclusive' ? 'Grand Total (Inclusive GST):' : 'Grand Total:';
  doc.text(totalLabel, labelCol, finalY); doc.text(`INR ${sanitizePdfAmount(invoice.total)}`, rightCol, finalY, { align: 'right' });

  finalY += 10; doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text('Amount in Words:', 14, finalY);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);
  const wordsLines = doc.splitTextToSize(invoice.amountInWords, pageWidth - 28);
  doc.text(wordsLines, 14, finalY + 5);

  finalY += 16; doc.setFillColor(248, 250, 252); doc.rect(14, finalY, pageWidth - 28, 28, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text('Bank Details:', 18, finalY + 5);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);
  doc.text(`Bank: ${companyCfg.bankName}`, 18, finalY + 10);
  doc.text(`A/C: ${companyCfg.bankAccount}`, 18, finalY + 14);
  doc.text(`IFSC: ${companyCfg.bankIFSC}`, 18, finalY + 18);

  doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(`For ${companyCfg.name}`, pageWidth - 18, finalY + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
  doc.text('Authorized Signatory', pageWidth - 18, finalY + 24, { align: 'right' });

  finalY += 34; doc.setFontSize(7); doc.setTextColor(100, 116, 139);
  doc.text('Terms & Conditions:', 14, finalY);
  const terms = String(companyCfg.termsConditions || '').split('\n');
  terms.slice(0, 3).forEach((line, idx) => doc.text(line, 14, finalY + 4 + idx * 4));

  return doc;
}

export async function downloadInvoicePDF(invoice: Invoice) {
  try {
    const companyCfg = await getCompanyConfig();
    const doc = generateInvoicePDF(invoice, companyCfg);
    const filename = `Invoice_${invoice.invoiceNumber}_${invoice.customerName.replace(/\s+/g, '_')}.pdf`;
    const electronAPI = (window as any).electron;
    if (electronAPI?.saveExportedExcel) {
      const base64Data = doc.output('datauristring').split(',')[1];
      const saveResult = await electronAPI.saveInvoicePDF ? await electronAPI.saveInvoicePDF(filename, base64Data) : await electronAPI.saveExportedExcel(filename, base64Data);
      if (saveResult?.success || saveResult?.ok) toast.success(`Invoice saved: ${saveResult.path || filename}`); else doc.save(filename);
    } else { doc.save(filename); }
    await db.timelineLogs.add({ customerId: invoice.customerId, entityType: 'Order', entityId: invoice.orderId, action: `Invoice ${invoice.invoiceNumber} Downloaded`, notes: 'PDF invoice downloaded by user', agentName: 'Admin', createdAt: new Date().toISOString() });
  } catch (err) {
    console.error('[InvoiceEngine] Download failed:', err);
    toast.error('Failed to download invoice');
  }
}

export async function printInvoice(invoice: Invoice) {
  try {
    const companyCfg = await getCompanyConfig();
    const doc = generateInvoicePDF(invoice, companyCfg);
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url);
    if (printWindow) printWindow.addEventListener('load', () => printWindow.print());
    await db.timelineLogs.add({ customerId: invoice.customerId, entityType: 'Order', entityId: invoice.orderId, action: `Invoice ${invoice.invoiceNumber} Printed`, notes: 'Invoice sent to printer', agentName: 'Admin', createdAt: new Date().toISOString() });
  } catch (err) {
    console.error('[InvoiceEngine] Print failed:', err);
    toast.error('Failed to print invoice');
  }
}

export async function cancelInvoice(invoiceId: number, reason: string = '') {
  try {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) return;
    await db.invoices.update(invoiceId, { status: 'Cancelled', paymentStatus: 'Cancelled', notes: reason, updatedAt: new Date().toISOString() });
    await db.timelineLogs.add({ customerId: invoice.customerId, entityType: 'Order', entityId: invoice.orderId, action: `Invoice ${invoice.invoiceNumber} Cancelled`, notes: reason || 'Invoice cancelled by agent', agentName: 'Admin', createdAt: new Date().toISOString() });
    toast.success(`Invoice ${invoice.invoiceNumber} cancelled`);
  } catch { toast.error('Failed to cancel invoice'); }
}
