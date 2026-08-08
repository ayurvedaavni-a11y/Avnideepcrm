import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Product } from '../db/db';
import Package from 'lucide-react/dist/esm/icons/package'
import Plus from 'lucide-react/dist/esm/icons/plus'
import Search from 'lucide-react/dist/esm/icons/search'
import Edit2 from 'lucide-react/dist/esm/icons/edit-2'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import X from 'lucide-react/dist/esm/icons/x'
import History from 'lucide-react/dist/esm/icons/history'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import { toast } from 'react-hot-toast';
import { adjustStock } from '../db/inventoryEngine';
import { safeFormat } from '../lib/safeFormat';

const EMPTY_PRODUCT: Omit<Product, 'id'> = {
  sku: '',
  name: '',
  description: '',
  hsnCode: '4901',
  category: '',
  purchasePrice: 0,
  sellingPrice: 0,
  gstRate: 18,
  stockQty: 0,
  lowStockAlert: 5,
  unit: 'PCS',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

export function Inventory() {
  const products = useLiveQuery(() => db.products.reverse().toArray()) || [];
  const [searchTerm, setSearchTerm] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const filtered = useMemo(() => {
    return products.filter(p =>
      !searchTerm ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const stats = useMemo(() => ({
    total: products.length,
    lowStock: products.filter(p => p.stockQty <= p.lowStockAlert).length,
    outOfStock: products.filter(p => p.stockQty === 0).length,
    inventoryValue: products.reduce((sum, p) => sum + (p.stockQty * p.purchasePrice), 0),
  }), [products]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Package className="text-blue-600" /> Inventory Management
          </h1>
          <p className="text-slate-500 text-sm">Manage products, stock levels, and pricing.</p>
        </div>
        <button
          onClick={() => { setEditingProduct(null); setIsFormOpen(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-bold text-sm shadow-sm"
        >
          <Plus size={16} /> Add Product
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Products" value={stats.total} color="bg-blue-50 text-blue-700" />
        <StatCard label="Low Stock" value={stats.lowStock} color="bg-amber-50 text-amber-700" />
        <StatCard label="Out of Stock" value={stats.outOfStock} color="bg-red-50 text-red-700" />
        <StatCard label="Stock Value" value={`₹${stats.inventoryValue.toFixed(0)}`} color="bg-emerald-50 text-emerald-700" />
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by name, SKU, or category…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="text-sm font-bold text-slate-500">{filtered.length} products</div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-4">SKU / Product</th>
                <th className="p-4">HSN</th>
                <th className="p-4">Stock</th>
                <th className="p-4">Purchase</th>
                <th className="p-4">Selling</th>
                <th className="p-4">GST</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td className="p-4">
                    <div className="font-bold text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{p.sku} {p.category && `• ${p.category}`}</div>
                  </td>
                  <td className="p-4 font-mono text-slate-600">{p.hsnCode}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{p.stockQty} {p.unit}</span>
                      {p.stockQty <= p.lowStockAlert && (
                        <AlertTriangle size={14} className="text-amber-500" />
                      )}
                    </div>
                    <div className="text-xs text-slate-400">Alert at {p.lowStockAlert}</div>
                  </td>
                  <td className="p-4 text-slate-700">₹{p.purchasePrice}</td>
                  <td className="p-4 font-bold text-emerald-600">₹{p.sellingPrice}</td>
                  <td className="p-4 text-slate-600">{p.gstRate}%</td>
                  <td className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button title="Stock History" onClick={() => setHistoryProduct(p)} className="p-1.5 text-slate-600 hover:bg-slate-100 rounded">
                        <History size={14} />
                      </button>
                      <button title="Edit" onClick={() => { setEditingProduct(p); setIsFormOpen(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                        <Edit2 size={14} />
                      </button>
                      <button title="Delete" onClick={async () => {
                        if (window.confirm(`Delete product "${p.name}"?`)) {
                          await db.products.delete(p.id!);
                          toast.success('Product deleted');
                        }
                      }} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-12 text-center text-slate-500"><Package size={32} className="mx-auto text-slate-300 mb-2" />No products yet. Click "Add Product" to start.</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>

      {isFormOpen && <ProductForm product={editingProduct} onClose={() => { setIsFormOpen(false); setEditingProduct(null); }} />}
      {historyProduct && <StockHistoryModal product={historyProduct} onClose={() => setHistoryProduct(null)} />}
    </div>
  );
}

function StatCard({ label, value, color }: any) {
  return (
    <div className={`p-4 rounded-xl border border-slate-200 bg-white shadow-sm`}>
      <div className={`text-xs uppercase font-bold tracking-wider px-2 py-1 rounded inline-block mb-2 ${color}`}>{label}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [form, setForm] = useState<Omit<Product, 'id'>>(product ? { ...product } : { ...EMPTY_PRODUCT });

  const handleSave = async () => {
    if (!form.sku.trim() || !form.name.trim()) {
      toast.error('SKU and Name are required');
      return;
    }
    try {
      const now = new Date().toISOString();
      if (product?.id) {
        await db.products.update(product.id, { ...form, updatedAt: now });
        toast.success('Product updated');
      } else {
        const existing = await db.products.where('sku').equals(form.sku).first();
        if (existing) {
          toast.error('SKU already exists');
          return;
        }
        const id = await db.products.add({ ...form, createdAt: now, updatedAt: now });
        // Initial stock log
        if (form.stockQty > 0 && id) {
          await db.inventoryLogs.add({
            productId: id as number,
            changeType: 'IN',
            qtyChange: form.stockQty,
            qtyBefore: 0,
            qtyAfter: form.stockQty,
            reference: 'Initial stock',
            agentName: 'Admin',
            createdAt: now,
          });
        }
        toast.success('Product created');
      }
      onClose();
    } catch (e) {
      toast.error('Failed to save product');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between flex-wrap gap-2 items-center">
          <h2 className="text-lg font-bold text-slate-800">{product ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500" /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="SKU *" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} />
            <FormField label="Product Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </div>
          <FormField label="Description" value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} multiline />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Category" value={form.category || ''} onChange={(v) => setForm({ ...form, category: v })} />
            <FormField label="HSN Code" value={form.hsnCode} onChange={(v) => setForm({ ...form, hsnCode: v })} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <FormField label="Purchase Price" type="number" value={form.purchasePrice} onChange={(v) => setForm({ ...form, purchasePrice: Number(v) || 0 })} />
            <FormField label="Selling Price" type="number" value={form.sellingPrice} onChange={(v) => setForm({ ...form, sellingPrice: Number(v) || 0 })} />
            <FormField label="GST %" type="number" value={form.gstRate} onChange={(v) => setForm({ ...form, gstRate: Number(v) || 0 })} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <FormField label="Stock Quantity" type="number" value={form.stockQty} onChange={(v) => setForm({ ...form, stockQty: Number(v) || 0 })} />
            <FormField label="Low Stock Alert" type="number" value={form.lowStockAlert} onChange={(v) => setForm({ ...form, lowStockAlert: Number(v) || 0 })} />
            <FormField label="Unit" value={form.unit || 'PCS'} onChange={(v) => setForm({ ...form, unit: v })} />
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition">Save Product</button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', multiline = false }: { label: string; value: any; onChange: (v: string) => void; type?: string; multiline?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      )}
    </div>
  );
}

function StockHistoryModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const logs = useLiveQuery(() => db.inventoryLogs.where('productId').equals(product.id!).reverse().sortBy('createdAt'), [product.id]) || [];
  const [adjQty, setAdjQty] = useState(0);
  const [adjNote, setAdjNote] = useState('');

  const handleAdjust = async () => {
    if (!adjQty) return toast.error('Enter quantity to adjust');
    const ok = await adjustStock(product.id!, adjQty, 'ADJUSTMENT', 'Manual adjustment', undefined, 'Admin', adjNote);
    if (ok) {
      toast.success(`Stock ${adjQty > 0 ? 'added' : 'reduced'} successfully`);
      setAdjQty(0);
      setAdjNote('');
    } else {
      toast.error('Adjustment blocked (would go negative)');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{product.name} — Stock History</h2>
            <p className="text-xs text-slate-500">Current Stock: <strong>{product.stockQty} {product.unit}</strong></p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} /></button>
        </div>
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-700 mb-1">Adjust Quantity (use negative for OUT)</label>
            <input type="number" value={adjQty} onChange={(e) => setAdjQty(Number(e.target.value))} className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-700 mb-1">Note</label>
            <input type="text" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="e.g., Restock, Damage..." className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <button onClick={handleAdjust} className="px-4 py-2 bg-slate-900 text-white font-bold rounded-lg text-sm hover:bg-slate-800">Apply</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {logs.map(log => (
            <div key={log.id} className="bg-white p-3 border border-slate-200 rounded-lg flex justify-between items-center text-sm">
              <div>
                <div className="font-bold text-slate-800">
                  {log.changeType} • <span className={log.qtyChange > 0 ? 'text-emerald-600' : 'text-red-600'}>{log.qtyChange > 0 ? '+' : ''}{log.qtyChange}</span>
                </div>
                <div className="text-xs text-slate-500">{log.reference || log.notes || '—'}</div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>{safeFormat(log.createdAt, 'dd MMM yyyy, HH:mm')}</div>
                <div className="font-bold text-slate-700">{log.qtyBefore} → {log.qtyAfter}</div>
              </div>
            </div>
          ))}
          {logs.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">No movement history yet.</div>}
        </div>
      </div>
    </div>
  );
}
