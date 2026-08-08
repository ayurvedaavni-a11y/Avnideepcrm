import { useRef, useState } from 'react';
import { db } from '../db/db';
import { toast } from 'react-hot-toast';
// exceljs imported dynamically — MUST use `xlsx.load(buffer)` (readBuffer does
// not exist in exceljs 4.x and silently broke every upload in production).
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud'
import Download from 'lucide-react/dist/esm/icons/download'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet'
import X from 'lucide-react/dist/esm/icons/x'
import { resolveCustomerState } from '../db/stateResolver';
import { createManualInvoice } from '../db/invoiceEngine';
import { parseCsv, getVal, normalizeMobile, STATUS_MAP } from '../db/importParser';

type ImportMode = 'leads' | 'orders' | 'courier';
type DupMode = 'skip' | 'update' | 'merge';

interface ImportReport {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  duplicate: number;
  failed: number;
  errors: string[];
  createdIds: { kind: 'customer' | 'lead' | 'order'; id: number }[];
  batchId: string;
}

// ---------------------------------------------------------------------------
// XLSX parser via exceljs. Uses `xlsx.load(buffer)` — readBuffer is undefined
// in exceljs 4.x (this was the production crash: every upload failed with a
// swallowed TypeError and the module showed no preview at all).
// ---------------------------------------------------------------------------
async function parseXlsx(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx as any).load(buffer);
  const allData: Record<string, string>[] = [];
  for (const ws of workbook.worksheets) {
    const headers: string[] = [];
    const headerRow = ws.getRow(1);
    const maxCol = Math.max(headerRow.cellCount, 1);
    for (let ci = 1; ci <= maxCol; ci++) {
      const v = headerRow.getCell(ci).value;
      headers.push(v === undefined || v === null ? '' : String(v));
    }
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj: Record<string, string> = {};
      // getCell (not eachCell) so EMPTY middle cells are preserved — eachCell
      // skips them and silently misaligns every later column.
      for (let ci = 1; ci <= headers.length; ci++) {
        const v = row.getCell(ci).value;
        obj[headers[ci - 1]] = v === undefined || v === null ? '' : String(v);
      }
      if (Object.values(obj).some((v) => v !== '')) allData.push(obj);
    });
  }
  return allData;
}

export function BulkImport() {
  const [mode, setMode] = useState<ImportMode>('leads');
  const [fileData, setFileData] = useState<any[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [dupMode, setDupMode] = useState<DupMode>('skip');
  const [dragOver, setDragOver] = useState(false);
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetImport = () => {
    setFileData([]); setPreview([]); setReport(null); setProgress(0); cancelledRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFiles = async (file: File) => {
    resetImport();
    setImporting(true);
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const buffer = await file.arrayBuffer();
      let rows: Record<string, string>[];
      if (ext === 'csv' || ext === 'txt') {
        const text = new TextDecoder('utf-8').decode(buffer);
        const parsed = parseCsv(text);
        if (!parsed.headers.length) throw new Error('No header/column found in the CSV — the file is empty or in the wrong format.');
        rows = parsed.rows;
      } else if (ext === 'xlsx') {
        rows = await parseXlsx(buffer);
      } else if (ext === 'xls') {
        throw new Error('.xls (old format) is not supported — save the file as .xlsx and try again.');
      } else {
        throw new Error('Unsupported file type: .' + ext + ' (only .xlsx or .csv).');
      }
      if (!rows.length) throw new Error('No data rows found in the file.');
      if (!rows.some((r) => normalizeMobile(getVal(r, 'mobile')))) {
        throw new Error('Mobile column not found, or no valid 10-digit mobile numbers. Check the columns (Name, Mobile, Product...).');
      }
      setFileData(rows);
      setPreview(rows.slice(0, 10));
      toast.success(`Loaded ${rows.length} rows`);
    } catch (e: any) {
      toast.error('File could not be parsed: ' + (e?.message || 'Unknown error'));
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFiles(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFiles(file);
  };

  const downloadFailedRows = () => {
    if (!report) return;
    const lines = ['Row Number,Reason'];
    for (const err of report.errors) lines.push(err);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Import_Failed_Rows_${report.batchId.slice(-6)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rollback = async () => {
    if (!report || !report.createdIds.length) { toast('There were no new rows to roll back.', { icon: '↩️' }); return; }
    if (!window.confirm(`Delete the ${report.createdIds.length} newly imported row(s)? Existing data will not be touched.`)) return;
    setImporting(true);
    try {
      const customers = report.createdIds.filter((c) => c.kind === 'customer').map((c) => c.id);
      const leads = report.createdIds.filter((c) => c.kind === 'lead').map((c) => c.id);
      const orders = report.createdIds.filter((c) => c.kind === 'order').map((c) => c.id);
      await db.transaction('rw', [db.customers, db.leads, db.orders, db.timelineLogs, db.ndrCases], async () => {
        if (leads.length) await db.leads.bulkDelete(leads);
        if (orders.length) {
          // Revert the customer aggregate counters this import incremented
          // (totalOrders / delivered / totalSpend / rto) before deleting.
          const orderRows = await db.orders.where('id').anyOf(orders).toArray();
          for (const o of orderRows) {
            const c = await db.customers.get(o.customerId);
            if (c) {
              const upd: any = { totalOrders: Math.max(0, (c.totalOrders || 0) - 1), updatedAt: new Date().toISOString() };
              if (o.status === 'Delivered') { upd.delivered = Math.max(0, (c.delivered || 0) - 1); upd.totalSpend = Math.max(0, (c.totalSpend || 0) - (o.codAmount || 0)); }
              else if (o.status === 'RTO') { upd.rto = Math.max(0, (c.rto || 0) - 1); }
              await db.customers.update(c.id!, upd);
            }
          }
          await db.orders.bulkDelete(orders);
          // (No logistics table — order.status is the single source of truth.)
          await db.ndrCases.where('orderId').anyOf(orders).delete();
        }
        if (customers.length) {
          // Only delete customers CREATED by this import (safe: they have no
          // pre-existing history by definition).
          await db.customers.bulkDelete(customers);
        }
      });
      toast.success('Rollback complete — only this import\'s new rows were deleted.');
      setReport(null);
      resetImport();
    } catch (e: any) {
      toast.error('Rollback failed: ' + (e?.message || e));
    } finally {
      setImporting(false);
    }
  };

  // ---- process ONE row inside a Dexie transaction (atomic, safe) ----
  const importRow = async (
    row: any,
    index: number,
    batchId: string,
    ctx: { imported: number; updated: number; skipped: number; duplicate: number; failed: number; errors: string[]; createdIds: ImportReport['createdIds'] }
  ): Promise<void> => {
    const rowNo = index + 2;
    const name = getVal(row, 'name').trim();
    const mobile = normalizeMobile(getVal(row, 'mobile'));
    const product = getVal(row, 'product') || 'Unknown Product';
    const statusRaw = getVal(row, 'status').trim().toLowerCase();
    const source = getVal(row, 'source') || 'Bulk Import';
    const amount = Number(getVal(row, 'amount')) || 0;
    const address = getVal(row, 'address');
    const city = getVal(row, 'city');
    const state = getVal(row, 'state');
    const pincode = getVal(row, 'pincode');
    const notes = getVal(row, 'notes');
    const followupDate = getVal(row, 'followupDate');
    const followupTime = getVal(row, 'followupTime');
    const now = new Date().toISOString();
    const status = STATUS_MAP[statusRaw] || (mode === 'leads' ? 'New Lead' : 'Shipped');
    // Only apply an imported status when the CSV actually had a Status column
    // — otherwise 'update' mode would silently reset an existing lead to
    // 'New Lead'.
    const hasStatus = statusRaw.length > 0;

    if (!mobile) { ctx.failed++; ctx.errors.push(`Row ${rowNo},Missing/invalid mobile`); return; }

    await db.transaction('rw', [db.customers, db.leads, db.orders, db.timelineLogs, db.ndrCases], async () => {
      let customer = await db.customers.where('mobile').equals(mobile).first();
      let customerId: number;

      if (customer) {
        // ---- ORDERS/COURIER: repeat customer is NORMAL — reuse + import. ----
        // The duplicate policy only ever gates LEAD creation, never orders.
        if (mode !== 'leads') {
          customerId = customer.id!;
          await insertOrder({ customerId, product, status, amount, notes, row, index, now, batchId, ctx });
          ctx.imported++;
          return;
        }
        // ---- LEADS: apply the selected duplicate policy ----
        if (dupMode === 'skip') {
          ctx.duplicate++;
          return;
        }
        if (dupMode === 'update') {
          await db.customers.update(customer.id!, {
            name: name || customer.name, address: address || customer.address,
            city: city || customer.city, state: state || customer.state,
            pincode: pincode || customer.pincode, updatedAt: now,
          });
          const existingLead = await db.leads.where('customerId').equals(customer.id!).first();
          if (existingLead) {
            await db.leads.update(existingLead.id!, {
              product: product !== 'Unknown Product' ? product : existingLead.product,
              status: hasStatus ? (status as any) : existingLead.status,
              notes: notes || existingLead.notes,
              followupDate: followupDate || existingLead.followupDate,
              followupTime: followupTime || existingLead.followupTime,
              updatedAt: now,
            });
            await db.timelineLogs.add({
              customerId: customer.id!, entityType: 'Lead', entityId: existingLead.id!,
              action: 'Lead Updated via Bulk Import', statusTo: hasStatus ? status : existingLead.status,
              notes: notes || 'Imported from Excel', agentName: 'Bulk Import', createdAt: now,
            });
          }
          ctx.updated++;
          return;
        }
        // dupMode === 'merge' → append to existing customer history
        customerId = customer.id!;
        const leadId = await db.leads.add({
          customerId, product, source, expectedAmount: amount,
          priority: 'Medium', status: status as any, assignedAgent: 'Bulk Import', notes,
          followupDate: followupDate || undefined, followupTime: followupTime || undefined,
          createdAt: now, updatedAt: now,
        });
        ctx.createdIds.push({ kind: 'lead', id: leadId });
        await db.timelineLogs.add({
          customerId, entityType: 'Lead', entityId: leadId,
          action: 'Lead Created via Bulk Import (merge)', statusTo: status,
          notes: notes || 'Imported from Excel', agentName: 'Bulk Import', createdAt: now,
        });
        ctx.imported++;
        return;
      }

      // ---- NEW CUSTOMER ----
      const resolvedState = resolveCustomerState({ state, pincode, address });
      customerId = await db.customers.add({
        mobile, name: name || mobile, address,
        city: city || '', state: state || (resolvedState !== 'Unknown' ? resolvedState : ''),
        pincode, totalOrders: 0, delivered: 0, rto: 0, cancelled: 0, fakeCount: 0, totalSpend: 0,
        riskLevel: 'Low', currentStatus: status as any,
        createdAt: now, updatedAt: now,
      });
      ctx.createdIds.push({ kind: 'customer', id: customerId });
      await db.timelineLogs.add({
        customerId, entityType: 'Customer', action: 'Customer Created via Bulk Import',
        agentName: 'Bulk Import', notes: `Batch ${batchId.slice(-6)}`, createdAt: now,
      });

      if (mode === 'leads') {
        const leadId = await db.leads.add({
          customerId, product, source, expectedAmount: amount,
          priority: 'Medium', status: status as any, assignedAgent: 'Bulk Import', notes,
          followupDate: followupDate || undefined, followupTime: followupTime || undefined,
          createdAt: now, updatedAt: now,
        });
        ctx.createdIds.push({ kind: 'lead', id: leadId });
        await db.timelineLogs.add({
          customerId, entityType: 'Lead', entityId: leadId,
          action: 'Lead Created via Bulk Import', statusTo: status,
          notes: notes || 'Imported from Excel', agentName: 'Bulk Import', createdAt: now,
        });
      } else {
        await insertOrder({ customerId, product, status, amount, notes, row, index, now, batchId, ctx });
      }
      ctx.imported++;
    });
  };

  const insertOrder = async (p: {
    customerId: number; product: string; status: string; amount: number;
    notes: string; row: any; index: number; now: string; batchId: string;
    ctx: { imported: number; updated: number; skipped: number; duplicate: number; failed: number; errors: string[]; createdIds: ImportReport['createdIds'] };
  }) => {
    const orderId = getVal(p.row, 'orderId') || `IMP-${p.batchId.slice(-6)}-${p.index + 1}`;
    const existingOrder = await db.orders.where('orderId').equals(orderId).first();
    if (existingOrder) { p.ctx.duplicate++; return; }
    const trackingId = getVal(p.row, 'trackingId') || '';
    const courier = getVal(p.row, 'courier') || '';
    const createdId = await db.orders.add({
      orderId, customerId: p.customerId, product: p.product, qty: 1, codAmount: p.amount,
      courier, trackingId: trackingId || undefined,
      status: p.status as any, orderDate: p.now,
      shipmentDate: ['Shipped', 'Delivered', 'RTO', 'Cancelled', 'In Transit', 'Out For Delivery'].includes(p.status) ? p.now : undefined,
      createdAt: p.now, updatedAt: p.now,
    });
    p.ctx.createdIds.push({ kind: 'order', id: createdId });
    await db.timelineLogs.add({
      customerId: p.customerId, entityType: 'Order', entityId: createdId,
      action: 'Order Imported via Bulk', statusTo: p.status,
      notes: p.notes || 'Imported from Excel', agentName: 'Bulk Import', createdAt: p.now,
    });
    // (No logistics record — order.status is the single source of truth.)
    if (p.status === 'Undelivered') {
      await db.ndrCases.add({
        orderId: createdId, customerId: p.customerId, reason: 'Imported as Undelivered',
        status: 'Pending', attemptCount: 1, riskLevel: 'Medium', createdAt: p.now, updatedAt: p.now,
      });
    }
    const custRef = await db.customers.get(p.customerId);
    if (custRef) {
      const upd: any = { totalOrders: (custRef.totalOrders || 0) + 1, currentStatus: p.status as any, updatedAt: p.now };
      if (p.status === 'Delivered') { upd.delivered = (custRef.delivered || 0) + 1; upd.totalSpend = (custRef.totalSpend || 0) + p.amount; }
      else if (p.status === 'RTO') { upd.rto = (custRef.rto || 0) + 1; }
      await db.customers.update(p.customerId, upd);
    }
    if (p.status === 'Delivered') {
      try {
        await createManualInvoice({ customerId: p.customerId, items: [{ productName: p.product, hsnCode: '4901', qty: 1, rate: p.amount, discount: 0, gstRate: 5 }], notes: 'Auto-generated from bulk import' });
      } catch (e) { console.error('[BulkImport] Invoice creation failed', p.index + 2, e); }
    }
  };

  // ---- import with a bounded worker pool (fast for 10k+ rows, cancellable) ----
  const handleImport = async () => {
    if (fileData.length === 0) { toast.error('No data to import'); return; }
    if (importing || runningRef.current) return; // guard against double-import
    runningRef.current = true;
    cancelledRef.current = false;
    setImporting(true);
    setProgress(0);
    setReport(null);
    const batchId = Date.now().toString(36);
    const ctx: ImportReport['createdIds'] = [];
    let imported = 0, updated = 0, skipped = 0, duplicate = 0, failed = 0;
    const errors: string[] = [];

    // Sequential with a per-row Dexie transaction (atomic) — safe for 10k+
    // rows and avoids cross-transaction races.
    for (let i = 0; i < fileData.length; i++) {
      if (cancelledRef.current) break;
      const row = fileData[i];
      if (!row || typeof row !== 'object') { failed++; errors.push(`Row ${i + 2},Invalid row data`); continue; }
      const ctxRow = { imported: 0, updated: 0, skipped: 0, duplicate: 0, failed: 0, errors: [], createdIds: [] as ImportReport['createdIds'] };
      try {
        await importRow(row, i, batchId, ctxRow as any);
        imported += ctxRow.imported; updated += ctxRow.updated; skipped += ctxRow.skipped;
        duplicate += ctxRow.duplicate; failed += ctxRow.failed;
        errors.push(...ctxRow.errors);
        for (const c of ctxRow.createdIds) ctx.push(c);
      } catch (e: any) {
        failed++; errors.push(`Row ${i + 2},${(e?.message || 'Failed').slice(0, 200)}`);
      }
      setProgress(Math.round(((i + 1) / fileData.length) * 100));
      if ((i + 1) % 50 === 0) await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }

    setReport({ total: fileData.length, imported, updated, skipped, duplicate, failed, errors, createdIds: ctx, batchId });
    setProgress(100);
    setImporting(false);
    runningRef.current = false;
    toast.success(`Import complete: ${imported} imported, ${updated} updated, ${duplicate} duplicate, ${failed} failed`);
  };

  const exportSample = async () => {
    try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sample');
    if (mode === 'leads') {
      const headers = ['Name', 'Mobile', 'Product', 'Amount', 'Status', 'Source', 'Notes', 'Address', 'City', 'State', 'Pincode'];
      ws.addRow(headers);
      ws.addRow(['Rahul Sharma', '9988776655', 'Wireless Earbuds', 1499, 'New Lead', 'Facebook', '', 'Delhi', 'Delhi', 'Delhi', '110001']);
    } else {
      const headers = ['Order ID', 'Customer Name', 'Mobile', 'Product', 'Amount', 'Courier', 'Tracking ID', 'Status', 'Address', 'City', 'State', 'Pincode', 'Notes'];
      ws.addRow(headers);
      ws.addRow(['ORD-001', 'Rahul', '9988776655', 'Earbuds', 1499, 'Delhivery', 'DLV123', 'Delivered', '', 'Delhi', 'Delhi', '110001', '']);
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'leads' ? 'Sample_Leads_Import.xlsx' : `Sample_${mode === 'orders' ? 'Orders' : 'Courier'}_Import.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Sample downloaded');
    } catch (e: any) {
      toast.error('Sample download failed: ' + (e?.message || 'Unknown error'));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="text-blue-600" /> Bulk Import</h1>
          <p className="text-slate-500 text-sm">Import Leads, Orders, or Courier data from Excel (.xlsx) or CSV — duplicate-safe, rollback-supported.</p>
        </div>
        <button onClick={exportSample} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 font-bold text-sm flex items-center gap-2"><Download size={16} /> Download Sample</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex gap-1">
        {([['leads', 'Leads'], ['orders', 'Orders'], ['courier', 'Courier']] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setMode(key); resetImport(); }}
            className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition ${mode === key ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Duplicate policy */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Duplicate Mobile Policy (what to do if an existing customer is found)</label>
        <div className="flex flex-wrap gap-2">
          {([['skip', 'Skip Duplicate'], ['update', 'Update Existing Customer'], ['merge', 'Merge Lead History']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setDupMode(key)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition ${dupMode === key ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Dropzone with drag & drop */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition bg-slate-50 relative ${dragOver ? 'border-blue-500 bg-blue-50/30' : 'border-slate-300 hover:border-blue-500 hover:bg-blue-50/20'}`}
      >
        <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.txt" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
        <UploadCloud className={`mx-auto mb-3 ${dragOver ? 'text-blue-600' : 'text-slate-400'}`} size={36} />
        <p className="text-sm font-bold text-slate-700">{dragOver ? 'Drop file here…' : 'Click or drag & drop a file here'}</p>
        <p className="text-xs text-slate-500 mt-1">.xlsx • .csv • scientific notation supported • 10,000+ rows OK</p>
      </div>

      {/* Preview */}
      {preview.length > 0 && !importing && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-x-auto">
          <p className="text-sm font-bold text-slate-700 mb-3">Preview — first 10 rows of {fileData.length}</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold">{Object.keys(preview[0]).map((k, i) => <th key={i} className="p-2">{k}</th>)}</tr></thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {Object.keys(preview[0]).map((k, j) => (
                    <td key={j} className="p-2 text-xs max-w-[220px] truncate">{String(row[k] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Import action + progress */}
      {fileData.length > 0 && !importing && !report && (
        <button onClick={handleImport} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition disabled:opacity-50">
          Import {fileData.length} Rows
        </button>
      )}
      {importing && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
          <div className="flex justify-between text-xs font-bold text-slate-600">
            <span>{report ? 'Processing…' : 'Importing…'}</span><span>{progress}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
          <button onClick={() => { cancelledRef.current = true; toast('Cancelling import…', { icon: '✋' }); }}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 flex items-center gap-1">
            <X size={13} /> Cancel Import
          </button>
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 className="font-bold text-slate-800 text-sm">Import Report</h3>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            <Stat label="Total" value={report.total} color="text-slate-700" />
            <Stat label="Imported" value={report.imported} color="text-emerald-600" />
            <Stat label="Updated" value={report.updated} color="text-blue-600" />
            <Stat label="Skipped" value={report.skipped} color="text-slate-500" />
            <Stat label="Duplicate" value={report.duplicate} color="text-amber-600" />
            <Stat label="Failed" value={report.failed} color="text-red-600" />
          </div>
          {report.errors.length > 0 && (
            <div>
              <div className="text-xs text-red-600 max-h-40 overflow-y-auto font-mono">
                {report.errors.slice(0, 30).map((e, i) => <div key={i}>{e}</div>)}
                {report.errors.length > 30 && <div className="text-slate-400">… aur {report.errors.length - 30} errors</div>}
              </div>
              <button onClick={downloadFailedRows} className="mt-2 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 flex items-center gap-1.5">
                <Download size={13} /> Failed Rows Download ({report.errors.length})
              </button>
            </div>
          )}
          <div className="flex gap-2 pt-1 border-t border-slate-100">
            <button onClick={rollback} disabled={importing} className="px-4 py-2 rounded-lg text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 transition disabled:opacity-50">
              ↩ Rollback (sirf nayi rows delete)
            </button>
            <button onClick={resetImport} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition">
              Naya Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2">
      <div className={`text-lg font-black ${color}`}>{value}</div>
      <div className="text-[10px] font-bold text-slate-400 uppercase">{label}</div>
    </div>
  );
}
