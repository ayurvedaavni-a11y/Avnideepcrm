import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import X from 'lucide-react/dist/esm/icons/x'
import Search from 'lucide-react/dist/esm/icons/search'
import MapPin from 'lucide-react/dist/esm/icons/map-pin'
import Package from 'lucide-react/dist/esm/icons/package'
import Calculator from 'lucide-react/dist/esm/icons/calculator'
import Info from 'lucide-react/dist/esm/icons/info'
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import { createManualInvoice, calculateGST } from '../db/invoiceEngine';
import { getGSTConfig, getCompanyConfig } from '../db/settingsEngine';
import { resolveCustomerLocation } from '../db/stateResolver';
import { safeMoney } from '../lib/safe';
import { removeDuplicateLeads } from '../db/workflow';

interface Props {
  leadId: number;
  onClose: () => void;
}

export function BookOrderModal({ leadId, onClose }: Props) {
  // 1. Data Subscriptions
  const lead = useLiveQuery(() => db.leads.get(leadId), [leadId]);
  const customer = useLiveQuery(() => lead ? db.customers.get(lead.customerId) : undefined, [lead]);
  const products = useLiveQuery(() => db.products.filter(p => p.isActive).toArray()) || [];
  
  // 2. Settings State
  const [gstCfg, setGstCfg] = useState<any>(null);
  const [companyCfg, setCompanyCfg] = useState<any>(null);

  // 3. Form State
  const [formData, setFormData] = useState({
    name: '',
    mobile: '',
    altMobile: '',
    address: '',
    landmark: '',
    pincode: '',
    city: '',
    state: '',
    productId: undefined as number | undefined,
    productSearch: '',
    quantity: 1,
    sellingPrice: 0,
    discount: 0,
    deliveryCharge: 0,
    codCharge: 0,
    paymentMode: 'COD' as 'COD' | 'Prepaid',
    courier: '',
    specialInstructions: '',
    orderNotes: '',
    notes: ''
  });

  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const { isAdmin } = useAuth();
  const [saving, setSaving] = useState(false);

  // 4. Initial Load
  useEffect(() => {
    (async () => {
      const g = await getGSTConfig();
      const c = await getCompanyConfig();
      setGstCfg(g);
      setCompanyCfg(c);
    })();
  }, []);

  useEffect(() => {
    if (customer && lead) {
      setFormData(prev => ({
        ...prev,
        name: customer.name || '',
        mobile: customer.mobile || '',
        altMobile: customer.alternateNumber || '',
        address: customer.address || '',
        pincode: customer.pincode || '',
        city: customer.city || '',
        state: customer.state || '',
        sellingPrice: lead.expectedAmount || 0,
        notes: lead.notes || ''
      }));
    }
  }, [customer, lead]);

  // 5. Pincode Auto-detect
  useEffect(() => {
    const pin = formData.pincode;
    if (pin.length === 6 && /^\d{6}$/.test(pin)) {
      const resolved = resolveCustomerLocation({ pincode: pin });
      if (resolved.state !== 'Unknown') {
        setFormData(prev => ({
          ...prev,
          state: prev.state || resolved.state,
          city: prev.city || resolved.city
        }));
      }
    }
  }, [formData.pincode]);

  // 6. Calculations
  const selectedProduct = useMemo(() => 
    products.find(p => p.id === formData.productId), 
    [products, formData.productId]
  );

  const filteredProducts = useMemo(() => {
    const q = formData.productSearch.toLowerCase();
    if (!q) return products.slice(0, 10);
    return products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.sku.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [products, formData.productSearch]);

  const totals = useMemo(() => {
    const amount = safeMoney(formData.sellingPrice);
    const qty = safeMoney(formData.quantity) || 1;
    const disc = safeMoney(formData.discount);
    const deliv = safeMoney(formData.deliveryCharge);
    const cod = safeMoney(formData.codCharge);
    
    const lineTotal = (amount * qty) - disc;
    
    // Use centralized GST engine
    const gstResult = calculateGST({
      amount: lineTotal,
      gstRate: selectedProduct?.gstRate ?? gstCfg?.gstRate ?? 5,
      gstMode: gstCfg?.gstMode ?? 'exclusive',
      gstEnabled: gstCfg?.gstEnabled ?? true,
      customerState: formData.state || 'Unknown',
      companyState: companyCfg?.state || 'Unknown'
    });

    const grandTotal = gstResult.grandTotal + deliv + cod;
    const roundOff = gstCfg?.roundOffEnabled ? Math.round(grandTotal) - grandTotal : 0;

    return {
      ...gstResult,
      subtotal: lineTotal,
      delivery: deliv,
      cod: cod,
      roundOff,
      finalTotal: grandTotal + roundOff,
      mode: gstCfg?.gstMode ?? 'exclusive'
    };
  }, [formData, selectedProduct, gstCfg, companyCfg]);

  // 7. Actions
  const handleSelectProduct = (p: any) => {
    setFormData(prev => ({
      ...prev,
      productId: p.id,
      productSearch: p.name,
      sellingPrice: p.sellingPrice,
    }));
    setShowProductDropdown(false);
  };

  const handleSave = async () => {
    if (!lead || !customer) return;
    if (formData.sellingPrice <= 0) {
      toast.error('Please enter a valid price');
      return;
    }
    setSaving(true);

    try {
      // 🛡️ IDEMPOTENCY GUARD — ONE LEAD = ONE ORDER (root-cause fix for the
      // duplicate-orders bug). Before this guard, EVERY save created a brand-new
      // order row with a fresh random orderId — so booking the same lead twice
      // (double-click, re-open modal, or book + auto-convert) produced duplicate
      // crm_orders records (e.g. one Out For Delivery + one Order Booked for the
      // same customer). The existing order is the single lifecycle record;
      // status advances THROUGH it — never create a second one.
      const existingOrder = await db.orders.where('leadId').equals(lead.id!).first();
      if (existingOrder) {
        toast.error(`An order already exists for this lead (${existingOrder.orderId}) — status: ${existingOrder.status}. No duplicate created.`);
        return;
      }

      // 1. Update Customer
      await db.customers.update(customer.id!, {
        name: formData.name,
        mobile: formData.mobile,
        alternateNumber: formData.altMobile,
        address: formData.address,
        landmark: formData.landmark || '',
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
        notes: formData.notes || '',
        currentStatus: 'Order Booked',
        totalOrders: (customer.totalOrders || 0) + 1,
        updatedAt: new Date().toISOString()
      });

      // 2. Create Order
      const orderId = `ORD-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
      const nowIso = new Date().toISOString();
      // IMMUTABLE booking attribution — commission credit stays with the
      // telecaller who converted this lead, even if the lead is reassigned later.
      const bookedBy = lead?.assignedTo || undefined;
      const bookedByName = lead?.assignedAgent || undefined;
      const newOrderId = await db.orders.add({
        orderId,
        customerId: customer.id!,
        leadId: lead.id!,
        product: selectedProduct?.name || formData.productSearch || 'General Item',
        qty: formData.quantity,
        codAmount: totals.finalTotal,
        discount: formData.discount || 0,
        deliveryCharge: formData.deliveryCharge || 0,
        codCharge: formData.codCharge || 0,
        paymentMode: formData.paymentMode || 'COD',
        specialInstructions: formData.specialInstructions || '',
        orderNotes: formData.orderNotes || '',
        status: 'Order Booked',
        orderDate: nowIso,
        bookedBy,
        bookedByName,
        createdAt: nowIso,
        updatedAt: nowIso
      });

      // 3. (No logistics record — order.status is the single source of truth.)

      // 4. Reduce Inventory
      if (selectedProduct?.id) {
        const newStock = Math.max(0, (selectedProduct.stockQty || 0) - formData.quantity);
        await db.products.update(selectedProduct.id, { stockQty: newStock });
        await db.inventoryLogs.add({
          productId: selectedProduct.id,
          changeType: 'OUT',
          qtyChange: -formData.quantity,
          qtyBefore: selectedProduct.stockQty,
          qtyAfter: newStock,
          reference: `Order ${orderId}`,
          createdAt: new Date().toISOString()
        });
      }

      // 5. Create Invoice — pass actual orderId so syncInvoiceWithOrderStatus() can find it
      await createManualInvoice({
        customerId: customer.id!,
        orderId: newOrderId,  // 🔥 CRITICAL FIX: Link invoice to real order for proper status sync
        items: [{
          productId: selectedProduct?.id,
          productName: selectedProduct?.name || formData.productSearch || 'Item',
          hsnCode: selectedProduct?.hsnCode || '4901',
          qty: formData.quantity,
          rate: formData.sellingPrice,
          discount: formData.discount,
          gstRate: selectedProduct?.gstRate ?? gstCfg?.gstRate ?? 5
        }],
        deliveryCharge: formData.deliveryCharge,
        codCharge: formData.codCharge,
        notes: formData.notes
      });

      // 6. Update Lead
      await db.leads.update(lead.id!, { 
        status: 'Order Booked',
        expectedAmount: totals.finalTotal // Sync final calculated amount back to lead
      });

      // 7. Timeline
      await db.timelineLogs.add({
        customerId: customer.id!,
        entityType: 'Order',
        entityId: newOrderId,
        action: 'Order Booked',
        notes: `Order ${orderId} created from Lead conversion. Total: ₹${totals.finalTotal}`,
        agentName: 'System',
        createdAt: new Date().toISOString()
      });

      // ✋ PRODUCTION SAFETY: After booking order, ensure no duplicate lead remains
      await removeDuplicateLeads(customer.id!);

      toast.success('Order Booked Successfully!');
      onClose();
    } catch (e: any) {
      toast.error('Booking failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!lead || !customer) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[95vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <Package size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">Convert Lead to Order</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Order Processing Engine</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={24} className="text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 bg-white grid grid-cols-1 md:grid-cols-2 gap-10">
          
          {/* Section 1: Customer */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <MapPin size={18} className="text-blue-600" />
              <h3 className="font-extrabold text-slate-700 uppercase text-xs tracking-wider">Customer & Shipping</h3>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              <Input label="Full Name" value={formData.name} onChange={v => setFormData({...formData, name: v})} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="bookorder-mobile" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Mobile</label>
                  <input
                    id="bookorder-mobile"
                    name="bookorder-mobile"
                    className="w-full p-3 bg-slate-100 border border-slate-200 rounded-2xl text-sm font-medium"
                    value={formData.mobile}
                    readOnly={!isAdmin}
                    title={!isAdmin ? "🔒 Mobile cannot be changed" : undefined}
                    tabIndex={-1}
                  />
                  {!isAdmin && <p className="text-[9px] text-amber-600 font-bold mt-1 ml-1">🔒 Mobile locked</p>}
                </div>
                <Input label="Alt Mobile" value={formData.altMobile} onChange={v => setFormData({...formData, altMobile: v})} />
              </div>
              <Input label="Full Address" value={formData.address} onChange={v => setFormData({...formData, address: v})} multiline />
              <Input label="Landmark" value={formData.landmark} onChange={v => setFormData({...formData, landmark: v})} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Input label="Pincode" value={formData.pincode} onChange={v => setFormData({...formData, pincode: v})} maxLength={6} />
                <Input label="City" value={formData.city} onChange={v => setFormData({...formData, city: v})} />
                <Input label="State" value={formData.state} onChange={v => setFormData({...formData, state: v})} />
              </div>
            </div>
          </div>

          {/* Section 2: Order Details */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <Calculator size={18} className="text-blue-600" />
              <h3 className="font-extrabold text-slate-700 uppercase text-xs tracking-wider">Order & Pricing</h3>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <label htmlFor="bookorder-product" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Select Product</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                  <input 
                    id="bookorder-product"
                    name="bookorder-product"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all outline-none"
                    placeholder="Search inventory..."
                    value={formData.productSearch}
                    onFocus={() => setShowProductDropdown(true)}
                    onChange={e => {
                      setFormData({...formData, productSearch: e.target.value, productId: undefined});
                      setShowProductDropdown(true);
                    }}
                  />
                </div>
                {showProductDropdown && filteredProducts.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 shadow-2xl rounded-2xl z-[110] overflow-hidden border-t-4 border-t-blue-600">
                    {filteredProducts.map(p => (
                      <button key={p.id} onClick={() => handleSelectProduct(p)} className="w-full p-4 text-left hover:bg-blue-50 border-b border-slate-50 flex justify-between items-center transition-colors">
                        <div>
                          <div className="font-bold text-slate-800">{p.name}</div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase">{p.sku} • HSN: {p.hsnCode}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-blue-600 text-sm">₹{p.sellingPrice}</div>
                          <div className={`text-[10px] font-bold ${p.stockQty > 5 ? 'text-emerald-500' : 'text-red-500'}`}>Stock: {p.stockQty}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedProduct && (
                  <div className="mt-3 flex items-center gap-2 bg-blue-50/50 p-2 rounded-xl border border-blue-100/50">
                    <Info size={12} className="text-blue-600" />
                    <span className="text-[10px] font-bold text-blue-800 uppercase">
                      Stock: {selectedProduct.stockQty} → Remaining: {Math.max(0, selectedProduct.stockQty - formData.quantity)}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Input label="Qty" type="number" value={formData.quantity} onChange={v => setFormData({...formData, quantity: Number(v)})} />
                <Input label="Price" type="number" value={formData.sellingPrice} onChange={v => setFormData({...formData, sellingPrice: Number(v)})} />
                <Input label="Discount" type="number" value={formData.discount} onChange={v => setFormData({...formData, discount: Number(v)})} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Delivery" type="number" value={formData.deliveryCharge} onChange={v => setFormData({...formData, deliveryCharge: Number(v)})} />
                <Input label="COD Charge" type="number" value={formData.codCharge} onChange={v => setFormData({...formData, codCharge: Number(v)})} />
              </div>

              <div className="space-y-3">
                <Input label="Special Instructions" value={formData.specialInstructions} onChange={v => setFormData({...formData, specialInstructions: v})} multiline />
                <Input label="Order Remarks / Notes" value={formData.orderNotes} onChange={v => setFormData({...formData, orderNotes: v})} multiline />
              </div>

              {/* Order Summary */}
              <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-slate-200 mt-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Calculator size={80} />
                </div>
                <div className="space-y-2.5 relative z-10">
                  <div className="flex justify-between text-xs font-bold opacity-60">
                    <span>{totals.mode === 'inclusive' ? 'SUBTOTAL (INCL GST)' : 'SUBTOTAL'}</span>
                    <span>₹{totals.subtotal.toFixed(2)}</span>
                  </div>
                  
                  {totals.mode === 'inclusive' ? (
                    <>
                      <div className="flex justify-between text-xs font-bold text-blue-300">
                        <span>TAXABLE AMOUNT</span>
                        <span>₹{totals.taxable.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs font-bold text-blue-300">
                        <span>GST INCLUDED</span>
                        <span>₹{totals.totalGST.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-xs font-bold text-blue-300">
                      <span>GST EXTRA</span>
                      <span>₹{totals.totalGST.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-xs font-bold opacity-60">
                    <span>CHARGES (DELIVERY + COD)</span>
                    <span>₹{(totals.delivery + totals.cod).toFixed(2)}</span>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex justify-between items-end">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest opacity-40">Final Payable</div>
                      <div className="text-3xl font-black tracking-tighter">₹{totals.finalTotal.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${totals.mode === 'inclusive' ? 'bg-amber-500' : 'bg-blue-500'}`}>
                        {totals.mode.toUpperCase()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-4">
          <button 
            onClick={onClose}
            className="px-8 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-200 transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="px-10 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-lg shadow-slate-200 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? 'Processing...' : 'Complete Booking'}
          </button>
        </div>
      </div>
      
      {/* Click outside detection */}
      {showProductDropdown && (
        <div className="fixed inset-0 z-[105]" onClick={() => setShowProductDropdown(false)}></div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', multiline = false, maxLength }: { label: string; value: any; onChange: (v: string) => void; type?: string; multiline?: boolean; maxLength?: number }) {
  return (
    <div>
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      {multiline ? (
        <textarea 
          className="w-full p-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all outline-none"
          rows={2}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <input 
          className="w-full p-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all outline-none font-medium"
          type={type}
          value={value}
          maxLength={maxLength}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
