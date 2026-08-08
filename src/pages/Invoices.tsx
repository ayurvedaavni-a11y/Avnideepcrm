import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, Invoice } from '../db/db';
import FileText from 'lucide-react/dist/esm/icons/file-text'
import Download from 'lucide-react/dist/esm/icons/download'
import Printer from 'lucide-react/dist/esm/icons/printer'
import Search from 'lucide-react/dist/esm/icons/search'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import FileDown from 'lucide-react/dist/esm/icons/file-down'
import Eye from 'lucide-react/dist/esm/icons/eye'
import Plus from 'lucide-react/dist/esm/icons/plus'
import { safeFormat } from '../lib/safeFormat';
import { toast } from 'react-hot-toast';
import { downloadInvoicePDF, printInvoice, cancelInvoice, autoGenerateInvoice, generateInvoicePDF } from '../db/invoiceEngine';
import { useNavigate } from 'react-router-dom';
// exceljs imported dynamically in handleBulkExport
import { useDateFilter } from '../context/DateFilterContext';

export function Invoices() {
  const invoices = useLiveQuery(() => db.invoices.reverse().toArray()) || [];
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Paid' | 'Cancelled'>('All');
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const navigate = useNavigate();

  const { filterByDate } = useDateFilter();

  // Apply global date filter
  const dateFilteredInvoices = useMemo(() => {
    return filterByDate(invoices, 'invoiceDate');
  }, [invoices, filterByDate]);

  // Filtering logic (local filters on top of global date filter)
  const filtered = useMemo(() => {
    return dateFilteredInvoices.filter(inv => {
      const matchSearch = !searchTerm ||
        inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.customerMobile.includes(searchTerm);
      const matchStatus = statusFilter === 'All' || inv.paymentStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [dateFilteredInvoices, searchTerm, statusFilter]);

  // Generate missing invoices for existing orders (back-fill helper)
  // FIX: Improved duplicate detection — sorts deterministically and keeps the BEST invoice
  const handleBackfillInvoices = async () => {
    try {
      // 1. PRUNE DUPLICATES FIRST (deterministic keep: newest invoice with most complete data)
      const allInvoices = await db.invoices.toArray();
      const orderInvoiceMap = new Map<number, typeof allInvoices>();
      
      // Group invoices by orderId (skip orderId <= 0 which are manual invoices)
      for (const inv of allInvoices) {
        if (!inv.orderId || inv.orderId <= 0) continue;
        const list = orderInvoiceMap.get(inv.orderId) || [];
        list.push(inv);
        orderInvoiceMap.set(inv.orderId, list);
      }

      const toDelete: number[] = [];
      for (const invs of orderInvoiceMap.values()) {
        if (invs.length > 1) {
          // Keep the invoice with the MOST complete data (prefer paid over unpaid, newer over older)
          const sorted = [...invs].sort((a, b) => {
            // Prefer Paid over non-Paid
            if (a.paymentStatus === 'Paid' && b.paymentStatus !== 'Paid') return -1;
            if (b.paymentStatus === 'Paid' && a.paymentStatus !== 'Paid') return 1;
            // Prefer newer (higher id) — Dexie auto-increment
            return (b.id || 0) - (a.id || 0);
          });
          // Keep the best one, delete the rest
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].id) toDelete.push(sorted[i].id!);
          }
        }
      }
      
      if (toDelete.length > 0) {
        await db.invoices.bulkDelete(toDelete);
        console.warn(`[Backfill] Removed ${toDelete.length} duplicate invoice(s)`);
      }

      // 2. GENERATE MISSING (inside atomic transaction per order)
      const orders = await db.orders.toArray();
      let created = 0;
      for (const o of orders) {
        if (!o.id) continue;
        const existing = await db.invoices.where('orderId').equals(o.id).first();
        if (!existing) {
          const inv = await autoGenerateInvoice(o.id, 'Admin');
          if (inv) created++;
        }
      }
      toast.success(created > 0 ? `Generated ${created} missing invoices` : 'Database sync complete');
    } catch (e) {
      console.error('[Backfill] Error:', e);
      toast.error('Sync failed');
    }
  };

  // Bulk Excel export
  const handleBulkExport = async () => {
    if (filtered.length === 0) {
      toast.error('No invoices to export');
      return;
    }
    try {
      const { default: ExcelJS } = await import('exceljs');
      const headers = ['Invoice No', 'Date', 'Customer Name', 'Mobile', 'Product', 'Qty', 'Rate', 'Subtotal', 'CGST', 'SGST', 'IGST', 'Total', 'Payment Status', 'Status', 'Place of Supply'];
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Invoices');
      ws.addRow(headers);
      for (const inv of filtered) {
        ws.addRow([
          inv.invoiceNumber,
          safeFormat(inv.invoiceDate, 'dd MMM yyyy'),
          inv.customerName,
          inv.customerMobile,
          inv.product,
          inv.qty,
          inv.rate,
          inv.subtotal,
          inv.cgst,
          inv.sgst,
          inv.igst,
          inv.total,
          inv.paymentStatus,
          inv.status,
          inv.placeOfSupply,
        ]);
      }

      const filename = `Invoices_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const electronAPI = (window as any).electron;
      if (electronAPI?.saveExportedExcel) {
        const buf = await wb.xlsx.writeBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64Data = btoa(binary);
        const result = await electronAPI.saveExportedExcel(filename, base64Data);
        if (result?.success) {
          toast.success(`Exported to ${result.path}`);
          return;
        }
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Invoices exported');
    } catch (e) {
      toast.error('Export failed');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="text-blue-600" /> Invoices
          </h1>
          <p className="text-slate-500 text-sm">GST-compliant tax invoices auto-generated from your orders.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/invoices/create')}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition font-bold text-sm shadow-sm"
          >
            <Plus size={16} /> Create Invoice
          </button>
          <button
            onClick={handleBackfillInvoices}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg flex items-center gap-2 hover:bg-slate-200 transition font-bold text-sm"
          >
            <FileText size={16} /> Auto-Generate Missing
          </button>
          <button
            onClick={handleBulkExport}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-bold text-sm shadow-sm"
          >
            <FileDown size={16} /> Export to Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            id="invoice-search"
            name="invoice-search"
            aria-label="Search invoices"
            type="text"
            placeholder="Search invoice no, customer, mobile…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Paid">Paid (Delivered)</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        {(searchTerm || statusFilter !== 'All') && (
          <button
            onClick={() => { setSearchTerm(''); setStatusFilter('All'); }}
            className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Clear
          </button>
        )}
        <div className="ml-auto text-sm font-bold text-slate-500">
          Total: {filtered.length} invoices
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-4">Invoice No</th>
                <th className="p-4">Date</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Product</th>
                <th className="p-4">Total</th>
                <th className="p-4">Status</th>
                <th className="p-4">Payment</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td className="p-4 font-bold text-slate-800 font-mono">
                    <button
                      onClick={() => navigate(`/invoices/${inv.invoiceNumber}`)}
                      className="hover:text-blue-600 hover:underline transition"
                    >
                      {inv.invoiceNumber}
                    </button>
                  </td>
                  <td className="p-4 text-slate-600 font-medium">
                    {safeFormat(inv.invoiceDate, 'dd MMM yyyy')}
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-800">{inv.customerName}</div>
                    <div className="text-xs text-slate-500 font-medium">{inv.customerMobile}</div>
                  </td>
                  <td className="p-4 text-slate-700">
                    {inv.product}
                    <div className="text-xs text-slate-400">Qty: {inv.qty}</div>
                  </td>
                  <td className="p-4 font-bold text-blue-600">₹{inv.total.toFixed(2)}</td>
                  <td className="p-4">
                    <FulfillmentBadge status={inv.fulfillmentStatus || 'Pending'} />
                  </td>
                  <td className="p-4">
                    <PaymentBadge status={inv.paymentStatus} cancelled={inv.status === 'Cancelled'} />
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-center gap-1">
                      <ActionBtn icon={Eye} label="Preview" color="text-slate-700 hover:bg-slate-100" onClick={() => setPreviewInvoice(inv)} />
                      <ActionBtn icon={Download} label="PDF" color="text-blue-700 hover:bg-blue-50" onClick={() => downloadInvoicePDF(inv)} />
                      <ActionBtn icon={Printer} label="Print" color="text-emerald-700 hover:bg-emerald-50" onClick={() => printInvoice(inv)} />
                      {inv.status !== 'Cancelled' && (
                        <ActionBtn icon={XCircle} label="Cancel" color="text-red-600 hover:bg-red-50" onClick={async () => {
                          if (window.confirm(`Cancel invoice ${inv.invoiceNumber}?`)) {
                            await cancelInvoice(inv.id!);
                          }
                        }} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500 bg-slate-50/50">
                    <FileText size={32} className="mx-auto text-slate-300 mb-2" />
                    No invoices found. Invoices are auto-generated when you book orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {previewInvoice && (
        <InvoicePreviewModal invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
      )}
    </div>
  );
}

function FulfillmentBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'Pending': 'bg-slate-100 text-slate-600',
    'Shipped': 'bg-blue-100 text-blue-700',
    'In Transit': 'bg-indigo-100 text-indigo-700',
    'Out For Delivery': 'bg-amber-100 text-amber-700',
    'Delivered': 'bg-emerald-100 text-emerald-700',
    'RTO': 'bg-red-100 text-red-700',
    'Cancelled': 'bg-red-100 text-red-700',
    'Returned': 'bg-purple-100 text-purple-700',
  };
  const color = colors[status] || 'bg-slate-100 text-slate-600';
  return <span className={`px-2 py-1 text-xs font-bold rounded ${color}`}>{status}</span>;
}

function PaymentBadge({ status, cancelled }: { status: string; cancelled: boolean }) {
  if (cancelled) {
    return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded">CANCELLED</span>;
  }
  if (status === 'Paid') {
    return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded">PAID</span>;
  }
  if (status === 'Cancelled') {
    return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded">REFUNDED</span>;
  }
  return <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded">PENDING</span>;
}

function ActionBtn({ icon: Icon, label, color, onClick }: any) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-2 rounded-lg transition ${color}`}
    >
      <Icon size={16} />
    </button>
  );
}

function InvoicePreviewModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getCompanyConfig } = await import('../db/settingsEngine');
        const companyCfg = await getCompanyConfig();
        const doc = generateInvoicePDF(invoice, companyCfg);
        const blob = doc.output('blob');
        if (mounted) setPdfUrl(URL.createObjectURL(blob));
      } catch {
        if (mounted) setPdfUrl(null);
      }
    })();
    return () => { mounted = false; };
  }, [invoice]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-slate-100 flex justify-between flex-wrap gap-2 items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Invoice Preview — {invoice.invoiceNumber}</h2>
            <p className="text-xs text-slate-500">{invoice.customerName} • ₹{invoice.total.toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadInvoicePDF(invoice)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 flex items-center gap-1">
              <Download size={14} /> Download
            </button>
            <button onClick={() => printInvoice(invoice)} className="px-3 py-1.5 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 flex items-center gap-1">
              <Printer size={14} /> Print
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
              <XCircle size={20} className="text-slate-500" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-slate-200">
          {pdfUrl ? (
            <iframe src={pdfUrl} className="w-full h-full border-0" title="Invoice Preview"></iframe>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500">Failed to render preview</div>
          )}
        </div>
      </div>
    </div>
  );
}
