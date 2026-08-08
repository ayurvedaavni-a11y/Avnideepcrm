import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left'
import Save from 'lucide-react/dist/esm/icons/save'
import Printer from 'lucide-react/dist/esm/icons/printer'
import Download from 'lucide-react/dist/esm/icons/download'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import Plus from 'lucide-react/dist/esm/icons/plus'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import { toast } from 'react-hot-toast';
import { downloadInvoicePDF, printInvoice, calculateGST } from '../db/invoiceEngine';
import { getCompanyConfig, getGSTConfig } from '../db/settingsEngine';
import { safeMoney, safeString } from '../lib/safe';
import { resolveCustomerState } from '../db/stateResolver';
import { Popover } from '../components/Popover';

interface EditableItem {
  productId?: number;
  product: string;
  qty: number;
  rate: number;
  discount: number;
  gstRate: number;
  hsnCode?: string;
  availableStock?: number;
  sku?: string;
}

export function InvoiceDetailsPage() {
  const { invoiceNo } = useParams();
  const navigate = useNavigate();
  const invoice = useLiveQuery(() => invoiceNo ? db.invoices.where('invoiceNumber').equals(invoiceNo).first() : undefined, [invoiceNo]);
  const customer = useLiveQuery(() => invoice ? db.customers.get(invoice.customerId) : undefined, [invoice]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<any>(null);
  const [gstCfg, setGstCfg] = useState<any>(null);
  const [customerForm, setCustomerForm] = useState({ name: '', mobile: '', address: '', city: '', state: '', pincode: '' });
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: '', invoiceDate: '', paymentStatus: 'Pending', status: 'Unpaid' as any });
  const [items, setItems] = useState<EditableItem[]>([{ product: '', qty: 1, rate: 0, discount: 0, gstRate: 5, availableStock: 0 }]);
  const [originalItems, setOriginalItems] = useState<EditableItem[]>([]);
  const [shippingCharge, setShippingCharge] = useState(0);
  const [codCharge, setCodCharge] = useState(0);
  const [extraCharge, setExtraCharge] = useState(0);
  const [productSearch, setProductSearch] = useState<string[]>([]);
  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null);
  const productAnchorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const products = useLiveQuery(() => db.products.filter(p => p.isActive !== false).toArray(), []) || [];

  useEffect(() => {
    (async () => {
      const c = await getCompanyConfig();
      const g = await getGSTConfig();
      setCompany(c);
      setGstCfg(g);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (invoice && customer) {
      setCustomerForm({
        name: customer.name || '',
        mobile: customer.mobile || '',
        address: customer.address || '',
        city: customer.city || '',
        state: customer.state || '',
        pincode: customer.pincode || '',
      });
      setInvoiceForm({
        invoiceNumber: invoice.invoiceNumber || '',
        invoiceDate: invoice.invoiceDate || '',
        paymentStatus: invoice.paymentStatus || 'Pending',
        status: invoice.status || 'Unpaid',
      });
      const initItems = [{
        product: invoice.product || '',
        qty: invoice.qty || 1,
        rate: invoice.rate || 0,
        discount: invoice.discount || 0,
        gstRate: invoice.cgst > 0 || invoice.sgst > 0 || invoice.igst > 0 ? 5 : 0,
        availableStock: 0,
      }];
      setItems(initItems);
      setOriginalItems(initItems);
      setShippingCharge(invoice.deliveryCharge || 0);
      setCodCharge(invoice.codCharge || 0);
      setExtraCharge(invoice.roundOff || 0);
      setProductSearch([invoice.product || '']);
    }
  }, [invoice, customer]);

  const customerState = resolveCustomerState({ state: customerForm.state, pincode: customerForm.pincode, address: customerForm.address });
  const companyState = company?.state || 'Unknown';

  const totals = useMemo(() => {
    if (!invoice) return { subtotal: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, grandTotal: 0, sameState: true };

    // Use stored invoice values as source of truth (not recalculated from items)
    const storedSubtotal = safeMoney(invoice.subtotal);
    const storedCgst = safeMoney(invoice.cgst);
    const storedSgst = safeMoney(invoice.sgst);
    const storedIgst = safeMoney(invoice.igst);
    const storedTotal = safeMoney(invoice.total);
    const gstMode = gstCfg?.gstMode || 'exclusive';

    // If items were edited, recalculate from items using the same GST mode
    const itemsEdited = items.some((it, idx) => {
      const origItem = originalItems[idx];
      return origItem && (it.qty !== origItem.qty || it.rate !== origItem.rate || it.discount !== origItem.discount);
    });

    if (itemsEdited) {
      let subtotal = 0;
      let grandCgst = 0, grandSgst = 0, grandIgst = 0;
      for (const item of items) {
        const base = (safeMoney(item.rate) * (item.qty || 0)) - safeMoney(item.discount);
        subtotal += base;
        const gst = calculateGST({ amount: base, gstRate: item.gstRate || gstCfg?.gstRate || 5, gstMode, gstEnabled: gstCfg?.gstEnabled ?? true, customerState, companyState });
        grandCgst += gst.cgst;
        grandSgst += gst.sgst;
        grandIgst += gst.igst;
      }
      const grandTotal = subtotal + grandCgst + grandSgst + grandIgst + safeMoney(shippingCharge) + safeMoney(codCharge) + safeMoney(extraCharge);
      return { subtotal, cgst: grandCgst, sgst: grandSgst, igst: grandIgst, totalTax: grandCgst + grandSgst + grandIgst, grandTotal, sameState: grandCgst > 0 };
    }

    // Not edited — use stored values
    return {
      subtotal: storedSubtotal,
      cgst: storedCgst,
      sgst: storedSgst,
      igst: storedIgst,
      totalTax: storedCgst + storedSgst + storedIgst,
      grandTotal: storedTotal,
      sameState: storedCgst > 0,
    };
  }, [items, originalItems, shippingCharge, codCharge, extraCharge, customerState, companyState, gstCfg, invoice]);

  const updateItem = (idx: number, patch: Partial<EditableItem>) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const removeRow = (idx: number) => {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
    setProductSearch(prev => prev.filter((_, i) => i !== idx));
    if (openDropdownIndex === idx) setOpenDropdownIndex(null);
  };

  const selectProduct = (idx: number, p: any) => {
    updateItem(idx, {
      productId: p.id,
      product: p.name,
      qty: items[idx]?.qty || 1,
      rate: p.sellingPrice || 0,
      gstRate: p.gstRate || 5,
      hsnCode: p.hsnCode || '',
      availableStock: p.stockQty || 0,
      sku: p.sku || '',
    });
    setProductSearch(prev => prev.map((s, i) => i === idx ? p.name : s));
    setOpenDropdownIndex(null);
  };

  const saveInvoice = async () => {
    if (!invoice || !customer) return;
    if (items.some(i => i.productId && (i.qty || 0) > (i.availableStock || 0) + ((originalItems.find(o => o.productId === i.productId)?.qty) || 0))) {
      toast.error('Insufficient stock for one or more products');
      return;
    }

    setSaving(true);
    try {
      await db.customers.update(customer.id!, {
        name: safeString(customerForm.name, customer.name),
        mobile: safeString(customerForm.mobile, customer.mobile),
        address: safeString(customerForm.address),
        city: safeString(customerForm.city),
        state: safeString(customerForm.state),
        pincode: safeString(customerForm.pincode),
        updatedAt: new Date().toISOString(),
      });

      for (const oldItem of originalItems) {
        if (oldItem.productId) {
          const p = await db.products.get(oldItem.productId);
          if (p) {
            await db.products.update(p.id!, { stockQty: (p.stockQty || 0) + (oldItem.qty || 0), updatedAt: new Date().toISOString() });
            await db.inventoryLogs.add({ productId: p.id!, changeType: 'CANCEL_RESTORE', qtyChange: oldItem.qty || 0, qtyBefore: p.stockQty || 0, qtyAfter: (p.stockQty || 0) + (oldItem.qty || 0), reference: `Invoice Edit Restore ${invoice.invoiceNumber}`, createdAt: new Date().toISOString() });
          }
        }
      }
      for (const newItem of items) {
        if (newItem.productId) {
          const p = await db.products.get(newItem.productId);
          if (p) {
            const newStock = Math.max(0, (p.stockQty || 0) - (newItem.qty || 0));
            await db.products.update(p.id!, { stockQty: newStock, updatedAt: new Date().toISOString() });
            await db.inventoryLogs.add({ productId: p.id!, changeType: 'OUT', qtyChange: -(newItem.qty || 0), qtyBefore: p.stockQty || 0, qtyAfter: newStock, reference: `Invoice ${invoice.invoiceNumber}`, createdAt: new Date().toISOString() });
          }
        }
      }

      await db.invoices.update(invoice.id!, {
        invoiceNumber: invoiceForm.invoiceNumber,
        invoiceDate: invoiceForm.invoiceDate,
        paymentStatus: invoiceForm.paymentStatus as any,
        status: invoiceForm.status,
        customerName: customerForm.name,
        customerMobile: customerForm.mobile,
        billingAddress: `${customerForm.address}`,
        shippingAddress: `${customerForm.address}`,
        product: items.map(i => i.product).join(', '),
        qty: items.reduce((s, i) => s + (i.qty || 0), 0),
        rate: items[0]?.rate || 0,
        discount: items.reduce((s, i) => s + safeMoney(i.discount), 0),
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        deliveryCharge: safeMoney(shippingCharge),
        codCharge: safeMoney(codCharge),
        roundOff: safeMoney(extraCharge),
        total: totals.grandTotal,
        amountPaid: invoiceForm.paymentStatus === 'Paid' ? totals.grandTotal : invoice.amountPaid || 0,
        balanceDue: invoiceForm.paymentStatus === 'Paid' ? 0 : Math.max(0, totals.grandTotal - (invoice.amountPaid || 0)),
        placeOfSupply: customerState,
        hsnCode: company?.hsnDefault || '',
        updatedAt: new Date().toISOString(),
      });

      // 3. Sync update back to associated Order and Lead (CRITICAL)
      if (invoice.orderId) {
        await db.orders.update(invoice.orderId, {
          codAmount: totals.grandTotal,
          product: items.map(i => i.product).join(', '),
          qty: items.reduce((s, i) => s + (i.qty || 0), 0),
          updatedAt: new Date().toISOString()
        });

        const orderRef = await db.orders.get(invoice.orderId);
        if (orderRef?.leadId) {
          await db.leads.update(orderRef.leadId, {
            expectedAmount: totals.grandTotal,
            product: items.map(i => i.product).join(', '),
            updatedAt: new Date().toISOString()
          });
        }
      }

      const customerInvoices = await db.invoices.where('customerId').equals(customer.id!).toArray();
      const spend = customerInvoices.filter(i => i.paymentStatus === 'Paid').reduce((s, i) => s + safeMoney(i.total), 0);
      await db.customers.update(customer.id!, { totalSpend: spend, updatedAt: new Date().toISOString() });

      await db.timelineLogs.add({
        customerId: customer.id!,
        entityType: 'Order',
        entityId: invoice.orderId,
        action: `Invoice ${invoice.invoiceNumber} Updated`,
        notes: `Invoice edited and totals recalculated to ₹${totals.grandTotal.toFixed(2)}`,
        agentName: 'Admin',
        createdAt: new Date().toISOString(),
      });

      setOriginalItems(items);
      toast.success('Invoice updated successfully');
      navigate('/invoices');
    } catch (e) {
      toast.error('Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !invoice || !customer || !company || !gstCfg) {
    return <div className="p-10 text-center text-slate-500">Loading invoice…</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/invoices')} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Invoice {invoice.invoiceNumber}</h1>
            <p className="text-slate-500 text-sm">Zoho Books style editable invoice profile</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={async () => { await downloadInvoicePDF({ ...invoice, total: totals.grandTotal, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, deliveryCharge: shippingCharge, codCharge, roundOff: extraCharge, customerName: customerForm.name, customerMobile: customerForm.mobile, billingAddress: customerForm.address, shippingAddress: customerForm.address, product: items.map(i => i.product).join(', '), qty: items.reduce((s, i) => s + i.qty, 0), rate: items[0]?.rate || 0, discount: items.reduce((s, i) => s + safeMoney(i.discount), 0), placeOfSupply: customerState } as any); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center gap-2"><Download size={16} /> Download PDF</button>
          <button onClick={async () => printInvoice({ ...invoice, total: totals.grandTotal, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, deliveryCharge: shippingCharge, codCharge, roundOff: extraCharge, customerName: customerForm.name, customerMobile: customerForm.mobile, billingAddress: customerForm.address, shippingAddress: customerForm.address, product: items.map(i => i.product).join(', '), qty: items.reduce((s, i) => s + i.qty, 0), rate: items[0]?.rate || 0, discount: items.reduce((s, i) => s + safeMoney(i.discount), 0), placeOfSupply: customerState } as any)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 flex items-center gap-2"><Printer size={16} /> Print</button>
          <button onClick={async () => { if (!window.confirm(`Delete invoice ${invoice.invoiceNumber}? Stock will be restored.`)) return; try { for (const item of items) { if (item.productId) { const p = await db.products.get(item.productId); if (p) { await db.products.update(p.id!, { stockQty: (p.stockQty || 0) + (item.qty || 0), updatedAt: new Date().toISOString() }); await db.inventoryLogs.add({ productId: p.id!, changeType: 'CANCEL_RESTORE', qtyChange: item.qty || 0, qtyBefore: p.stockQty || 0, qtyAfter: (p.stockQty || 0) + (item.qty || 0), reference: `Invoice Delete ${invoice.invoiceNumber}`, createdAt: new Date().toISOString() }); } } } await db.invoices.delete(invoice.id!); toast.success('Invoice deleted and stock restored'); navigate('/invoices'); } catch { toast.error('Failed to delete invoice'); } }} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 flex items-center gap-2"><Trash2 size={16} /> Delete</button>
          <button onClick={saveInvoice} disabled={saving} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 flex items-center gap-2 disabled:opacity-50"><Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 className="font-bold text-slate-800 flex items-center gap-2"><FileText size={18} /> Customer Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" value={customerForm.name} onChange={(v) => setCustomerForm({ ...customerForm, name: v })} />
              <Field label="Mobile" value={customerForm.mobile} onChange={(v) => setCustomerForm({ ...customerForm, mobile: v })} />
              <Field label="Address" value={customerForm.address} onChange={(v) => setCustomerForm({ ...customerForm, address: v })} multiline className="col-span-2" />
              <Field label="City" value={customerForm.city} onChange={(v) => setCustomerForm({ ...customerForm, city: v })} />
              <Field label="State" value={customerForm.state} onChange={(v) => setCustomerForm({ ...customerForm, state: v })} />
              <Field label="Pincode" value={customerForm.pincode} onChange={(v) => setCustomerForm({ ...customerForm, pincode: v })} />
              <button onClick={() => { const r = resolveCustomerState({ state: customerForm.state, pincode: customerForm.pincode, address: customerForm.address }); setCustomerForm({ ...customerForm, state: r !== 'Unknown' ? r : customerForm.state }); }} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200">Auto Resolve State</button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 className="font-bold text-slate-800">Invoice Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Invoice Number" value={invoiceForm.invoiceNumber} onChange={(v) => setInvoiceForm({ ...invoiceForm, invoiceNumber: v })} />
              <Field label="Invoice Date" value={invoiceForm.invoiceDate} onChange={(v) => setInvoiceForm({ ...invoiceForm, invoiceDate: v })} />
              <SelectField label="Payment Status" value={invoiceForm.paymentStatus} options={['Pending','Paid','Partial Paid','COD Pending','Cancelled','Refunded']} onChange={(v) => setInvoiceForm({ ...invoiceForm, paymentStatus: v })} />
              <SelectField label="Order Status" value={invoiceForm.status} options={['Unpaid','Paid','Partial Paid','Cancelled','Draft','Active']} onChange={(v) => setInvoiceForm({ ...invoiceForm, status: v })} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex justify-between flex-wrap gap-2 items-center">
              <h2 className="font-bold text-slate-800">Products</h2>
              <button onClick={() => { setItems(prev => [...prev, { product: '', qty: 1, rate: 0, discount: 0, gstRate: 5, availableStock: 0 }]); setProductSearch(prev => [...prev, '']); }} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 flex items-center gap-1"><Plus size={12} /> Add Product</button>
            </div>
            <div className="space-y-3">
              {items.map((item, idx) => {
                const search = productSearch[idx] || '';
                const matches = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()) || p.hsnCode.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
                const base = safeMoney(item.rate) * (item.qty || 0) - safeMoney(item.discount);
                const gst = calculateGST({ amount: base, gstRate: item.gstRate, gstMode: gstCfg?.gstMode, gstEnabled: gstCfg?.gstEnabled, customerState, companyState });
                const rowTotal = base + gst.cgst + gst.sgst + gst.igst;
                const stockError = item.productId && (item.qty || 0) > (item.availableStock || 0);
                return (
                  <div key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3 relative">
                    <div className="grid grid-cols-[1fr_100px_100px_100px_100px_40px] gap-3 items-start">
                      <div className="relative" ref={(el) => { productAnchorRefs.current[idx] = el; }}>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Product</label>
                        <input value={search} onChange={(e) => { const v = e.target.value; setProductSearch(prev => prev.map((s, i) => i === idx ? v : s)); updateItem(idx, { product: v }); setOpenDropdownIndex(idx); }} className="w-full p-2 border border-slate-300 rounded-lg text-sm" placeholder="Search by product, SKU, HSN" onFocus={() => setOpenDropdownIndex(idx)} />
                        <Popover
                          anchor={productAnchorRefs.current[idx]}
                          open={matches.length > 0 && !!search && openDropdownIndex === idx}
                          onClose={() => { /* stays open while typing */ }}
                          width={productAnchorRefs.current[idx]?.offsetWidth || 280}
                          closeOnScroll
                          className="max-h-56"
                        >
                          {matches.map(p => (
                            <button key={p.id} onClick={() => selectProduct(idx, p)} className="w-full text-left p-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                              <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                              <div className="text-xs text-slate-500">SKU: {p.sku} • HSN: {p.hsnCode} • GST: {p.gstRate}% • Stock: {p.stockQty}</div>
                            </button>
                          ))}
                        </Popover>
                      </div>
                      <Field label="Qty" value={item.qty} onChange={(v) => updateItem(idx, { qty: Number(v) || 0 })} type="number" />
                      <Field label="Rate" value={item.rate} onChange={(v) => updateItem(idx, { rate: safeMoney(v) })} type="number" />
                      <Field label="Discount" value={item.discount} onChange={(v) => updateItem(idx, { discount: safeMoney(v) })} type="number" />
                      <Field label="GST %" value={item.gstRate} onChange={(v) => updateItem(idx, { gstRate: safeMoney(v) })} type="number" />
                      <button onClick={() => { if (items.length > 1) { removeRow(idx); } }} className="mt-6 p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    </div>
                    <div className="text-xs text-slate-500 flex justify-between">
                      <span>Line Total</span>
                      <span className="font-bold text-slate-800">₹{rowTotal.toFixed(2)}</span>
                    </div>
                    {stockError && <div className="text-xs text-red-600 font-bold">Insufficient stock</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 sticky top-6">
            <h3 className="font-bold text-slate-800 mb-2">GST Summary</h3>
            <div className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-3 ${gstCfg?.gstMode === 'inclusive' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
              GST Mode: {gstCfg?.gstMode === 'inclusive' ? 'Inclusive' : 'Exclusive'}
            </div>
            <div className="space-y-2 text-sm">
              {gstCfg?.gstMode === 'inclusive' ? (
                <>
                  <div className="flex justify-between"><span className="text-slate-600">Taxable Amount</span><span className="font-bold">₹{totals.subtotal.toFixed(2)}</span></div>
                  {totals.cgst > 0 && <div className="flex justify-between"><span className="text-slate-600">CGST (2.5% Included)</span><span className="font-bold">₹{totals.cgst.toFixed(2)}</span></div>}
                  {totals.sgst > 0 && <div className="flex justify-between"><span className="text-slate-600">SGST (2.5% Included)</span><span className="font-bold">₹{totals.sgst.toFixed(2)}</span></div>}
                  {totals.igst > 0 && <div className="flex justify-between"><span className="text-slate-600">IGST (5% Included)</span><span className="font-bold">₹{totals.igst.toFixed(2)}</span></div>}
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span className="font-bold">₹{totals.subtotal.toFixed(2)}</span></div>
                  {totals.cgst > 0 && <div className="flex justify-between"><span className="text-slate-600">CGST (2.5% Extra)</span><span className="font-bold">₹{totals.cgst.toFixed(2)}</span></div>}
                  {totals.sgst > 0 && <div className="flex justify-between"><span className="text-slate-600">SGST (2.5% Extra)</span><span className="font-bold">₹{totals.sgst.toFixed(2)}</span></div>}
                  {totals.igst > 0 && <div className="flex justify-between"><span className="text-slate-600">IGST (5% Extra)</span><span className="font-bold">₹{totals.igst.toFixed(2)}</span></div>}
                </>
              )}
              <div className="flex justify-between items-center"><span className="text-slate-600">Shipping</span><input type="number" value={shippingCharge} onChange={(e) => setShippingCharge(safeMoney(e.target.value))} className="w-24 p-1 border border-slate-300 rounded text-right text-sm" /></div>
              <div className="flex justify-between items-center"><span className="text-slate-600">COD Charges</span><input type="number" value={codCharge} onChange={(e) => setCodCharge(safeMoney(e.target.value))} className="w-24 p-1 border border-slate-300 rounded text-right text-sm" /></div>
              <div className="flex justify-between items-center"><span className="text-slate-600">Extra</span><input type="number" value={extraCharge} onChange={(e) => setExtraCharge(safeMoney(e.target.value))} className="w-24 p-1 border border-slate-300 rounded text-right text-sm" /></div>
              <div className="border-t pt-3 mt-3 flex justify-between text-base font-bold"><span>Grand Total</span><span className="text-blue-600">₹{totals.grandTotal.toFixed(2)}</span></div>
            </div>
            <div className="mt-4 text-xs text-slate-500 space-y-1">
              <div><strong>Company State:</strong> {company.state}</div>
              <div><strong>Customer State:</strong> {customerState}</div>
              <div><strong>GST Type:</strong> {totals.sameState ? 'CGST + SGST' : 'IGST'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', multiline = false, className = '' }: { label: string; value: any; onChange: (v: string) => void; type?: string; multiline?: boolean; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={`inv-field-${label}`} className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea id={`inv-field-${label}`} name={`inv-field-${label}`} value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      ) : (
        <input id={`inv-field-${label}`} name={`inv-field-${label}`} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      )}
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg text-sm">
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}
