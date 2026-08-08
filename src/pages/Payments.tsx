import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Invoice } from '../db/db';
import Wallet from 'lucide-react/dist/esm/icons/wallet'
import Plus from 'lucide-react/dist/esm/icons/plus'
import X from 'lucide-react/dist/esm/icons/x'
import Search from 'lucide-react/dist/esm/icons/search'
import { toast } from 'react-hot-toast';
import { recordPayment } from '../db/invoiceEngine';
import { safeFormat } from '../lib/safeFormat';
import { useDateFilter } from '../context/DateFilterContext';

export function Payments() {
  const invoices = useLiveQuery(() => db.invoices.reverse().toArray()) || [];
  const payments = useLiveQuery(() => db.payments.reverse().toArray()) || [];
  const [search, setSearch] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  const { filterByDate } = useDateFilter();

  // Apply global date filter to invoices
  const dateFilteredInvoices = useMemo(() => {
    return filterByDate(invoices, 'invoiceDate');
  }, [invoices, filterByDate]);

  // Apply global date filter to payments
  const dateFilteredPayments = useMemo(() => {
    return filterByDate(payments, 'paymentDate');
  }, [payments, filterByDate]);

  const pendingInvoices = useMemo(() => {
    return dateFilteredInvoices.filter(inv =>
      ['Unpaid', 'Partial Paid', 'Active'].includes(inv.status) &&
      (inv.balanceDue ?? inv.total) > 0 &&
      (!search ||
        inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
        inv.customerName.toLowerCase().includes(search.toLowerCase()) ||
        inv.customerMobile.includes(search))
    );
  }, [dateFilteredInvoices, search]);

  const stats = useMemo(() => ({
    totalReceivable: pendingInvoices.reduce((s, i) => s + (i.balanceDue ?? i.total), 0),
    totalPaid: dateFilteredPayments.reduce((s, p) => s + p.amount, 0),
    pendingCount: pendingInvoices.length,
    paidCount: dateFilteredInvoices.filter(i => i.status === 'Paid').length,
  }), [pendingInvoices, dateFilteredPayments, dateFilteredInvoices]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Wallet className="text-emerald-600" /> Payments & Receivables
        </h1>
        <p className="text-slate-500 text-sm">Track payments, COD collections, and outstanding balances.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Total Receivable" value={`₹${stats.totalReceivable.toFixed(0)}`} color="text-red-600" />
        <StatBox label="Pending Invoices" value={stats.pendingCount} color="text-amber-600" />
        <StatBox label="Total Collected" value={`₹${stats.totalPaid.toFixed(0)}`} color="text-emerald-600" />
        <StatBox label="Paid Invoices" value={stats.paidCount} color="text-blue-600" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input id="payment-search" name="payment-search" aria-label="Search payments" type="text" placeholder="Search by invoice, customer, or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 text-sm">Outstanding Invoices ({pendingInvoices.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-4">Invoice #</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Date</th>
                <th className="p-4">Total</th>
                <th className="p-4">Paid</th>
                <th className="p-4">Balance</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvoices.map(inv => (
                <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-4 font-mono font-bold text-slate-800">{inv.invoiceNumber}</td>
                  <td className="p-4">
                    <div className="font-bold text-slate-800">{inv.customerName}</div>
                    <div className="text-xs text-slate-500">{inv.customerMobile}</div>
                  </td>
                  <td className="p-4 text-slate-600">{safeFormat(inv.invoiceDate, 'dd MMM yyyy')}</td>
                  <td className="p-4 font-bold text-slate-700">₹{inv.total.toFixed(2)}</td>
                  <td className="p-4 text-emerald-600 font-bold">₹{(inv.amountPaid || 0).toFixed(2)}</td>
                  <td className="p-4 text-red-600 font-bold">₹{(inv.balanceDue ?? inv.total).toFixed(2)}</td>
                  <td className="p-4"><StatusBadge status={inv.status} /></td>
                  <td className="p-4 text-center">
                    <button onClick={() => setPaymentInvoice(inv)} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700 flex items-center gap-1 mx-auto">
                      <Plus size={12} /> Record Payment
                    </button>
                  </td>
                </tr>
              ))}
              {pendingInvoices.length === 0 && (
                <tr><td colSpan={8} className="p-12 text-center text-slate-500">No outstanding invoices 🎉</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* Recent Payments */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800 text-sm">Recent Payments ({dateFilteredPayments.length})</h2>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0">
              <tr className="bg-slate-50 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-3">Date</th>
                <th className="p-3">Invoice</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Method</th>
                <th className="p-3">Reference</th>
              </tr>
            </thead>
            <tbody>
              {dateFilteredPayments.slice(0, 50).map(pmt => {
                const inv = invoices.find(i => i.id === pmt.invoiceId);
                return (
                  <tr key={pmt.id} className="border-b border-slate-100">
                    <td className="p-3 text-slate-600 text-xs">{safeFormat(pmt.paymentDate, 'dd MMM yyyy HH:mm')}</td>
                    <td className="p-3 font-mono text-slate-700 text-xs">{inv?.invoiceNumber || `INV#${pmt.invoiceId}`}</td>
                    <td className="p-3 font-bold text-emerald-600">₹{pmt.amount.toFixed(2)}</td>
                    <td className="p-3 text-slate-700 text-xs">{pmt.method}</td>
                    <td className="p-3 text-slate-500 text-xs">{pmt.reference || '—'}</td>
                  </tr>
                );
              })}
              {dateFilteredPayments.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500 text-sm">No payments recorded yet for this date range.</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>

      {paymentInvoice && <PaymentModal invoice={paymentInvoice} onClose={() => setPaymentInvoice(null)} />}
    </div>
  );
}

function StatBox({ label, value, color }: any) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-xs uppercase font-bold text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: any = {
    Paid: 'bg-emerald-100 text-emerald-700',
    'Partial Paid': 'bg-amber-100 text-amber-700',
    Unpaid: 'bg-red-100 text-red-700',
    Active: 'bg-blue-100 text-blue-700',
    Cancelled: 'bg-slate-100 text-slate-600',
    Draft: 'bg-slate-100 text-slate-600',
  };
  return <span className={`px-2 py-1 text-xs font-bold rounded ${colors[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>;
}

function PaymentModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const balance = invoice.balanceDue ?? invoice.total;
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer' | 'Card' | 'COD' | 'Cheque' | 'Other'>('Cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (amount <= 0 || amount > balance) {
      toast.error('Invalid amount');
      return;
    }
    setSaving(true);
    const ok = await recordPayment(invoice.id!, amount, method, reference, notes);
    if (ok) {
      toast.success('Payment recorded');
      onClose();
    } else {
      toast.error('Failed to record payment');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-slate-100 flex justify-between flex-wrap gap-2 items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Record Payment</h2>
            <p className="text-xs text-slate-500">{invoice.invoiceNumber} — {invoice.customerName}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 p-3 rounded-lg flex justify-between text-sm">
            <span className="text-slate-600">Balance Due:</span>
            <span className="font-bold text-red-600">₹{balance.toFixed(2)}</span>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Amount Received</label>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Payment Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="w-full p-2 border border-slate-300 rounded-lg text-sm">
              <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option><option>COD</option><option>Cheque</option><option>Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Reference (UTR / Txn ID)</label>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving…' : 'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}
