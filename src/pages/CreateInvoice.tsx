import { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Customer, Product } from '../db/db';
import FilePlus from 'lucide-react/dist/esm/icons/file-plus'
import Plus from 'lucide-react/dist/esm/icons/plus'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import Search from 'lucide-react/dist/esm/icons/search'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import { toast } from 'react-hot-toast';
import { createManualInvoice, downloadInvoicePDF } from '../db/invoiceEngine';
import { getGSTConfig } from '../db/settingsEngine';
import { useNavigate } from 'react-router-dom';
import { safeMoney } from '../lib/safe';
import { Popover } from '../components/Popover';

interface LineItem {
  productId?: number;
  productName: string;
  hsnCode: string;
  qty: number;
  rate: number;
  discount: number;
  gstRate: number;
  availableStock?: number;
  sku?: string;
}

const EMPTY_ITEM: LineItem = {
  productName: '',
  hsnCode: '4901',
  qty: 1,
  rate: 0,
  discount: 0,
  gstRate: 5,
  availableStock: 0,
  sku: '',
};

export function CreateInvoice() {
  const customers = useLiveQuery(() => db.customers.toArray()) || [];
  const products = useLiveQuery(() => db.products.filter(p => p.isActive !== false).toArray()) || [];
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const customerAnchorRef = useRef<HTMLDivElement>(null);
  const productAnchorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);
  const [productQueries, setProductQueries] = useState<string[]>(['']);
  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null);
  const [deliveryCharge, setDeliveryCharge] = useState(0);
  const [codCharge, setCodCharge] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const gst = await getGSTConfig();
      setDeliveryCharge(gst.deliveryCharge);
      setCodCharge(gst.codCharge);
    })();
  }, []);

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.mobile.includes(customerSearch)
  ).slice(0, 8);

  const updateItem = (idx: number, patch: Partial<LineItem>) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const addItemRow = () => {
    setItems(prev => [...prev, { ...EMPTY_ITEM }]);
    setProductQueries(prev => [...prev, '']);
  };

  const removeItemRow = (idx: number) => {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
    setProductQueries(prev => prev.filter((_, i) => i !== idx));
    if (openDropdownIndex === idx) setOpenDropdownIndex(null);
  };

  const handleSelectProduct = (idx: number, p: Product) => {
    updateItem(idx, {
      productId: p.id,
      productName: p.name,
      hsnCode: p.hsnCode,
      rate: safeMoney(p.sellingPrice),
      gstRate: safeMoney(p.gstRate),
      availableStock: p.stockQty,
      sku: p.sku,
    });
    setProductQueries(prev => prev.map((q, i) => i === idx ? p.name : q));
    setOpenDropdownIndex(null);
  };

  const lineSuggestions = (idx: number) => {
    const q = (productQueries[idx] || '').toLowerCase().trim();
    return products.filter(p => {
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.hsnCode || '').toLowerCase().includes(q);
    }).slice(0, 8);
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const item of items) {
      const taxable = safeMoney(item.qty) * safeMoney(item.rate) - safeMoney(item.discount);
      const tax = taxable * (safeMoney(item.gstRate) / 100);
      subtotal += taxable;
      gst += tax;
    }
    const total = subtotal + gst;
    return { subtotal, gst, total };
  }, [items]);

  const grandTotal = totals.total + safeMoney(deliveryCharge) + safeMoney(codCharge);

  const hasStockError = items.some(it => it.productId && (it.qty || 0) > (it.availableStock || 0));

  const handleSave = async () => {
    if (!selectedCustomer) {
      toast.error('Please select a customer');
      return;
    }
    if (items.length === 0 || items.some(it => !it.productName.trim())) {
      toast.error('Add at least one valid item');
      return;
    }
    if (hasStockError) {
      toast.error('Insufficient stock for one or more products');
      return;
    }

    setSaving(true);
    try {
      const inv = await createManualInvoice({
        customerId: selectedCustomer.id!,
        items,
        deliveryCharge,
        codCharge,
        notes,
      });
      if (inv) {
        toast.success(`Invoice ${inv.invoiceNumber} created`);
        await downloadInvoicePDF(inv);
        navigate('/invoices');
      } else {
        toast.error('Invoice creation failed');
      }
    } catch (e) {
      toast.error('Invoice creation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FilePlus className="text-blue-600" /> Create Manual Invoice
          </h1>
          <p className="text-slate-500 text-sm">Generate a new invoice without an associated order.</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-bold text-sm shadow-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save & Download PDF'}
        </button>
      </div>

      {/* Customer Picker */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <h2 className="font-bold text-slate-800">Bill To</h2>
        {selectedCustomer ? (
          <div className="flex justify-between items-center bg-slate-50 border border-slate-200 p-3 rounded-lg">
            <div>
              <div className="font-bold text-slate-800">{selectedCustomer.name}</div>
              <div className="text-xs text-slate-500">{selectedCustomer.mobile} • {[selectedCustomer.address, selectedCustomer.city, selectedCustomer.state].filter(Boolean).join(', ')}</div>
            </div>
            <button onClick={() => setSelectedCustomer(null)} className="text-sm text-red-600 font-bold">Change</button>
          </div>
        ) : (
          <div className="relative" ref={customerAnchorRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              id="invoice-customer-search"
              name="invoice-customer-search"
              aria-label="Search customer"
              type="text"
              autoComplete="search"
              placeholder="Search customer by name or mobile…"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Popover
              anchor={customerAnchorRef.current}
              open={!!customerSearch && filteredCustomers.length > 0}
              onClose={() => { /* stays open while typing */ }}
              width={customerAnchorRef.current?.offsetWidth || 360}
              closeOnScroll
              className="max-h-60"
            >
              {filteredCustomers.map(c => (
                <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }} className="w-full text-left p-3 hover:bg-slate-50 border-b border-slate-100">
                  <div className="font-bold text-slate-800 text-sm">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.mobile}</div>
                </button>
              ))}
            </Popover>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex justify-between flex-wrap gap-2 items-center mb-4">
          <h2 className="font-bold text-slate-800">Line Items</h2>
          <button onClick={addItemRow} className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded flex items-center gap-1 hover:bg-slate-800">
            <Plus size={12} /> Add Item
          </button>
        </div>

        <div className="space-y-4">
          {items.map((item, idx) => {
            const suggestions = lineSuggestions(idx);
            const taxable = safeMoney(item.qty) * safeMoney(item.rate) - safeMoney(item.discount);
            const rowGst = taxable * (safeMoney(item.gstRate) / 100);
            const rowTotal = taxable + rowGst;
            const stockError = item.productId && (item.qty || 0) > (item.availableStock || 0);

            return (
              <div key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3 relative">
                <div className="grid grid-cols-1 md:grid-cols-[1.2fr_120px_120px_120px_120px_44px] gap-3 items-start">
                  <div className="relative" ref={(el) => { productAnchorRefs.current[idx] = el; }}>
                    <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">Product</label>
                    <input
                      value={productQueries[idx] || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setProductQueries(prev => prev.map((q, i) => i === idx ? v : q));
                        updateItem(idx, { productName: v });
                        setOpenDropdownIndex(idx);
                      }}
                      onFocus={() => setOpenDropdownIndex(idx)}
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      autoComplete="search"
                      placeholder="Search by product, SKU, HSN"
                    />
                    <Popover
                      anchor={productAnchorRefs.current[idx]}
                      open={openDropdownIndex === idx && suggestions.length > 0}
                      onClose={() => { /* stays open while typing */ }}
                      width={productAnchorRefs.current[idx]?.offsetWidth || 300}
                      closeOnScroll
                      className="max-h-56"
                    >
                      {suggestions.map(p => (
                        <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelectProduct(idx, p)} className="w-full text-left p-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                          <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                          <div className="text-xs text-slate-500">SKU: {p.sku} • HSN: {p.hsnCode} • GST: {p.gstRate}% • Stock: {p.stockQty}</div>
                        </button>
                      ))}
                    </Popover>
                    {item.sku && <div className="text-[10px] text-slate-400 mt-1">SKU: {item.sku}</div>}
                  </div>

                  <Field label="Qty" value={item.qty} onChange={(v) => updateItem(idx, { qty: Number(v) || 0 })} type="number" />
                  <Field label="Rate" value={item.rate} onChange={(v) => updateItem(idx, { rate: safeMoney(v) })} type="number" />
                  <Field label="Discount" value={item.discount} onChange={(v) => updateItem(idx, { discount: safeMoney(v) })} type="number" />
                  <Field label="GST %" value={item.gstRate} onChange={(v) => updateItem(idx, { gstRate: safeMoney(v) })} type="number" />
                  <button onClick={() => removeItemRow(idx)} disabled={items.length === 1} className="mt-6 p-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30"><Trash2 size={16} /></button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-50 rounded-lg p-2"><span className="text-slate-500">HSN</span><div className="font-bold text-slate-800">{item.hsnCode || '—'}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><span className="text-slate-500">Available Stock</span><div className={`font-bold ${stockError ? 'text-red-600' : 'text-slate-800'}`}>{item.availableStock ?? '—'}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><span className="text-slate-500">Line GST</span><div className="font-bold text-slate-800">₹{rowGst.toFixed(2)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><span className="text-slate-500">Line Total</span><div className="font-bold text-blue-600">₹{rowTotal.toFixed(2)}</div></div>
                </div>
                {stockError && (
                  <div className="text-xs text-red-600 font-bold flex items-center gap-1"><AlertTriangle size={12} /> Insufficient stock</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Totals & Charges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 className="font-bold text-slate-800">Notes</h3>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full p-2 border border-slate-300 rounded-lg text-sm" placeholder="Additional notes for the invoice…" />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex justify-between text-sm"><span className="text-slate-600">Subtotal</span><span className="font-bold">₹{totals.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-600">GST</span><span className="font-bold">₹{totals.gst.toFixed(2)}</span></div>
          <div className="flex justify-between items-center text-sm">
            <label className="text-slate-600">Delivery</label>
            <input type="number" value={deliveryCharge} onChange={(e) => setDeliveryCharge(safeMoney(e.target.value))} className="w-24 p-1 border border-slate-300 rounded text-right text-sm" />
          </div>
          <div className="flex justify-between items-center text-sm">
            <label className="text-slate-600">COD Charge</label>
            <input type="number" value={codCharge} onChange={(e) => setCodCharge(safeMoney(e.target.value))} className="w-24 p-1 border border-slate-300 rounded text-right text-sm" />
          </div>
          <div className="border-t pt-3 flex justify-between text-base"><span className="font-bold text-slate-800">Grand Total</span><span className="font-bold text-blue-600 text-lg">₹{grandTotal.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: any; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
    </div>
  );
}
