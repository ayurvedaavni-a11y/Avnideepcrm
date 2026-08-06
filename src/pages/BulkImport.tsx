import { useState } from 'react';
import { db } from '../db/db';
import { toast } from 'react-hot-toast';
// exceljs imported dynamically in handleFileUpload / exportSample
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud'
import Download from 'lucide-react/dist/esm/icons/download'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet'
import { resolveCustomerState } from '../db/stateResolver';
import { createManualInvoice } from '../db/invoiceEngine';

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'customer name', 'customer', 'customername', 'full name', 'fullname', 'buyer', 'buyer name', 'buyername', 'consignee', 'consignee name'],
  mobile: ['mobile', 'phone', 'phone number', 'contact', 'mob', 'mob no', 'mobile no', 'mobileno', 'phone no', 'phoneno', 'contact no', 'contactno', 'customer mobile', 'customermobile', 'whatsapp', 'whatsapp number', 'consignee mobile', 'consigneemobile'],
  product: ['product', 'product name', 'productname', 'item', 'item name', 'product interested', 'interested product', 'sku', 'item description'],
  status: ['status', 'lead status', 'leadstatus', 'order status', 'shipment status', 'delivery status', 'state', 'current status'],
  source: ['source', 'lead source', 'leadsource', 'source of lead', 'platform', 'channel', 'channel name'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments', 'feedback', 'agent notes', 'delivery notes', 'remark'],
  address: ['address', 'full address', 'fulladdress', 'delivery address', 'customer address', 'billing address', 'consignee address', 'shipping address'],
  city: ['city', 'town', 'destination city'],
  state: ['state', 'province', 'region', 'destination state'],
  pincode: ['pincode', 'pin code', 'pin', 'zipcode', 'zip', 'postal code', 'delivery pincode'],
  amount: ['amount', 'expected amount', 'price', 'value', 'expectedamount', 'lead amount', 'expected price', 'cod amount', 'order amount', 'total amount', 'invoice value', 'collectable value'],
  followupDate: ['followup date', 'followup_date', 'follow up date', 'next call date', 'callback date', 'next followup', 'next call'],
  followupTime: ['followup time', 'followup_time', 'follow up time', 'next call time', 'callback time'],
  orderId: ['order id', 'orderid', 'order_id', 'order number', 'orderno', 'order_no', 'ref no', 'reference number', 'reference no'],
  courier: ['courier', 'courier name', 'couriername', 'courier partner', 'shipping partner', 'carrier', 'logistics partner'],
  trackingId: ['tracking id', 'trackingid', 'tracking_id', 'tracking number', 'trackingno', 'tracking_no', 'awb', 'awb no', 'awb number', 'awb_no', 'airwaybill', 'airwaybill number', 'consignment no'],
};

function findColumn(row: any, field: string): string | null {
  const aliases = COLUMN_ALIASES[field];
  if (!aliases) return null;
  const rowKeys = Object.keys(row);
  for (const alias of aliases) {
    const match = rowKeys.find(k => k.toLowerCase().trim() === alias);
    if (match) return match;
  }
  for (const alias of aliases) {
    const match = rowKeys.find(k => k.toLowerCase().trim().includes(alias));
    if (match) return match;
  }
  return null;
}

function getVal(row: any, field: string): string {
  const col = findColumn(row, field);
  if (!col) return '';
  const val = row[col];
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

function normalizeMobile(value: any): string {
  if (value === undefined || value === null) return '';
  let str = String(value).trim();
  if (str.includes('E') || str.includes('e')) {
    const num = Number(str);
    if (!isNaN(num)) str = String(Math.trunc(num));
  }
  str = str.replace(/[\s\-\(\)\+]/g, '');
  if (str.startsWith('91') && str.length === 12) str = str.slice(2);
  if (str.startsWith('0') && str.length === 11) str = str.slice(1);
  if (/^[6-9]\d{9}$/.test(str)) return str;
  return '';
}

type ImportMode = 'leads' | 'orders' | 'courier';

export function BulkImport() {
  const [mode, setMode] = useState<ImportMode>('leads');
  const [fileData, setFileData] = useState<any[]>([]);
  const [_sheetNames, setSheetNames] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const { default: ExcelJS } = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        await (workbook.xlsx as any).readBuffer(data);
        const names = workbook.worksheets.map(ws => ws.name);
        setSheetNames(names);
        const allData: any[] = [];
        for (const ws of workbook.worksheets) {
          const headers: string[] = [];
          ws.eachRow((row, rowNum) => {
            if (rowNum === 1) {
              row.eachCell(cell => headers.push(cell.value?.toString() || ''));
            } else {
              const obj: Record<string, string> = {};
              let ci = 0;
              row.eachCell(cell => { obj[headers[ci]] = String(cell.value ?? ''); ci++; });
              allData.push(obj);
            }
          });
        }
        setFileData(allData);
        setPreview(allData.slice(0, 10));
        toast.success(`Loaded ${allData.length} rows from ${names.length} sheet(s)`);
      } catch { toast.error('Failed to parse file'); }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (fileData.length === 0) { toast.error('No data to import'); return; }
    setImporting(true);
    let success = 0, skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < fileData.length; i++) {
      const row = fileData[i];
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

      if (!mobile) { skipped++; errors.push(`Row ${i + 2}: Missing/invalid mobile`); continue; }

      const statusMap: Record<string, string> = {
        'new lead': 'New Lead', 'interested': 'Interested', 'callback': 'Callback',
        'followup': 'Followup', 'follow-up': 'Followup', 'follow up': 'Followup',
        'ring': 'Ring', 'calling': 'Ring',
        'order booked': 'Order Booked', 'not interested': 'Not Interested',
        'fake': 'Fake Lead', 'fake lead': 'Fake Lead',
        'delivered': 'Delivered', 'undelivered': 'Undelivered', 'intransit': 'In Transit',
        'in transit': 'In Transit', 'shipped': 'Shipped', 'rto': 'RTO',
        'pending': 'Order Booked', 'out for delivery': 'Out For Delivery',
        'in-transit': 'In Transit', 'delivered successfully': 'Delivered',
        'rto delivered': 'RTO', 'rto initiated': 'RTO', 'cancelled': 'Cancelled',
        'packed': 'Packed',
      };
      const status = statusMap[statusRaw] || (mode === 'leads' ? 'New Lead' : 'Shipped');

      try {
        let customer = await db.customers.where('mobile').equals(mobile).first();
        let customerId: number;
        if (customer) {
          customerId = customer.id!;
        } else {
          const resolvedState = resolveCustomerState({ state, pincode, address });
          customerId = await db.customers.add({
            mobile, name: name || mobile, address,
            city: city || '', state: state || (resolvedState !== 'Unknown' ? resolvedState : ''),
            pincode, totalOrders: 0, delivered: 0, rto: 0, cancelled: 0, fakeCount: 0, totalSpend: 0,
            riskLevel: 'Low', currentStatus: status as any,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
        }

        if (mode === 'leads') {
          await db.leads.add({
            customerId, product, source, expectedAmount: amount,
            priority: 'Medium', status: status as any,
            assignedAgent: 'Bulk Import', notes,
            followupDate: followupDate || undefined, followupTime: followupTime || undefined,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
          await db.timelineLogs.add({
            customerId, entityType: 'Lead', action: 'Lead Created via Bulk Import',
            statusTo: status, notes: notes || 'Imported from Excel',
            agentName: 'Bulk Import', createdAt: new Date().toISOString(),
          });
        } else {
          const orderId = getVal(row, 'orderId') || `IMP-${Date.now().toString().slice(-6)}-${i}`;
          const existingOrder = await db.orders.where('orderId').equals(orderId).first();
          if (existingOrder) { skipped++; continue; }
          const trackingId = getVal(row, 'trackingId') || '';
          const courier = getVal(row, 'courier') || '';
          const createdId = await db.orders.add({
            orderId, customerId, product, qty: 1, codAmount: amount,
            courier, trackingId: trackingId || undefined,
            status: status as any, orderDate: new Date().toISOString(),
            shipmentDate: ['Shipped', 'Delivered', 'RTO', 'Cancelled', 'In Transit', 'Out For Delivery'].includes(status) ? new Date().toISOString() : undefined,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
          await db.timelineLogs.add({
            customerId, entityType: 'Order', entityId: createdId,
            action: 'Order Imported via Bulk', statusTo: status,
            notes: notes || 'Imported from Excel', agentName: 'Bulk Import',
            createdAt: new Date().toISOString(),
          });
          if (['Shipped', 'Delivered', 'RTO', 'Cancelled', 'In Transit', 'Out For Delivery', 'Undelivered'].includes(status)) {
            await db.logistics.add({
              orderId: createdId, status: status as any,
              dispatchDate: new Date().toISOString(), lastUpdate: new Date().toISOString(),
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
          }
          if (status === 'Undelivered') {
            await db.ndrCases.add({
              orderId: createdId, customerId, reason: 'Imported as Undelivered',
              status: 'Pending', attemptCount: 1, riskLevel: 'Medium',
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
          }
          const custRef = await db.customers.get(customerId);
          if (custRef) {
            const upd: any = { totalOrders: (custRef.totalOrders || 0) + 1, currentStatus: status as any, updatedAt: new Date().toISOString() };
            if (status === 'Delivered') { upd.delivered = (custRef.delivered || 0) + 1; upd.totalSpend = (custRef.totalSpend || 0) + amount; }
            else if (status === 'RTO') { upd.rto = (custRef.rto || 0) + 1; }
            await db.customers.update(customerId, upd);
          }
          if (status === 'Delivered') {
            try { await createManualInvoice({ customerId, items: [{ productName: product, hsnCode: '4901', qty: 1, rate: amount, discount: 0, gstRate: 5 }], notes: 'Auto-generated from bulk import' }); } catch (e) { console.error('[BulkImport] Invoice creation failed for row', i + 2, e); }
          }
        }
        success++;
      } catch (err: any) {
        skipped++; errors.push(`Row ${i + 2}: ${err.message || 'Failed'}`);
      }
    }
    setImportResult({ success, skipped, errors });
    setImporting(false);
    toast.success(`Import complete: ${success} imported, ${skipped} skipped`);
  };

  const exportSample = async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sample');
    
    if (mode === 'leads') {
      const headers = ['Name', 'Mobile', 'Product', 'Amount', 'Status', 'Source', 'Notes', 'Address', 'City', 'State', 'Pincode'];
      ws.addRow(headers);
      ws.addRow(['Rahul Sharma', '9988776655', 'Wireless Earbuds', 1499, 'New Lead', 'Facebook', '']);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Sample_Leads_Import.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ['Order ID', 'Customer Name', 'Mobile', 'Product', 'Amount', 'Courier', 'Tracking ID', 'Status', 'Address', 'City', 'State', 'Pincode', 'Notes'];
      ws.addRow(headers);
      ws.addRow(['ORD-001', 'Rahul', '9988776655', 'Earbuds', 1499, 'Delhivery', 'DLV123', 'Delivered', '', 'Delhi', 'Delhi', '110001', '']);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const filename = `Sample_${mode === 'orders' ? 'Orders' : 'Courier'}_Import.xlsx`;
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }
    toast.success('Sample downloaded');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="text-blue-600" /> Bulk Import</h1>
          <p className="text-slate-500 text-sm">Import Leads, Orders, or Courier tracking data from Excel/CSV.</p>
        </div>
        <button onClick={exportSample} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 font-bold text-sm flex items-center gap-2"><Download size={16} /> Download Sample</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex gap-1">
        {([['leads', 'Leads'], ['orders', 'Orders'], ['courier', 'Courier']] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setMode(key); setFileData([]); setImportResult(null); setPreview([]); }}
            className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition ${mode === key ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition bg-slate-50 hover:bg-blue-50/20 relative">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
          <UploadCloud className="mx-auto text-slate-400 mb-3" size={36} />
          <p className="text-sm font-bold text-slate-700">Upload Excel/CSV file</p>
          <p className="text-xs text-slate-500 mt-1">Supports scientific notation, flexible column names</p>
        </div>

        {preview.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold">{Object.keys(preview[0]).map(k => <th key={k} className="p-2">{k}</th>)}</tr></thead>
              <tbody>{preview.map((row, i) => (<tr key={i} className="border-b border-slate-100">{Object.values(row).map((v: any, j) => <td key={j} className="p-2 text-xs">{String(v)}</td>)}</tr>))}</tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">Showing first 10 rows of {fileData.length} total rows</p>
          </div>
        )}

        {fileData.length > 0 && (
          <button onClick={handleImport} disabled={importing} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition disabled:opacity-50">{importing ? 'Importing…' : `Import ${fileData.length} Rows`}</button>
        )}

        {importResult && (
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <div className="flex gap-4 text-sm font-bold">
              <span className="text-emerald-600">✅ {importResult.success} imported</span>
              <span className="text-amber-600">⚠️ {importResult.skipped} skipped</span>
            </div>
            {importResult.errors.length > 0 && (
              <div className="text-xs text-red-600 max-h-40 overflow-y-auto">{importResult.errors.slice(0, 20).map((e, i) => <div key={i}>{e}</div>)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
