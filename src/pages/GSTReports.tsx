import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import FileText from 'lucide-react/dist/esm/icons/file-text'
import Download from 'lucide-react/dist/esm/icons/download'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import { toast } from 'react-hot-toast';
// exceljs imported dynamically in exportToExcel
import { safeMoney } from '../lib/safe';
import { useDateFilter } from '../context/DateFilterContext';

export function GSTReports() {
  const invoices = useLiveQuery(() => db.invoices.toArray()) || [];
  const [reportType, setReportType] = useState<'sales' | 'state' | 'hsn' | 'gstr1' | 'gstr3b'>('sales');

  const { filterByDate } = useDateFilter();

  const filtered = useMemo(() => {
    return filterByDate(invoices, 'invoiceDate');
  }, [invoices, filterByDate]);

  const salesReport = useMemo(() => {
    return filtered.map(inv => ({
      invoiceNo: inv.invoiceNumber,
      date: new Date(inv.invoiceDate).toLocaleDateString('en-IN'),
      customer: inv.customerName,
      mobile: inv.customerMobile,
      state: inv.placeOfSupply,
      gstType: inv.cgst > 0 ? 'CGST+SGST' : 'IGST',
      taxable: safeMoney(inv.subtotal),
      cgst: safeMoney(inv.cgst),
      sgst: safeMoney(inv.sgst),
      igst: safeMoney(inv.igst),
      total: safeMoney(inv.total),
    }));
  }, [filtered]);

  const stateReport = useMemo(() => {
    const map = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number; count: number }>();
    for (const inv of filtered) {
      const state = inv.placeOfSupply || 'Unknown';
      const existing = map.get(state) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, count: 0 };
      map.set(state, {
        taxable: existing.taxable + safeMoney(inv.subtotal),
        cgst: existing.cgst + safeMoney(inv.cgst),
        sgst: existing.sgst + safeMoney(inv.sgst),
        igst: existing.igst + safeMoney(inv.igst),
        count: existing.count + 1,
      });
    }
    return Array.from(map.entries()).map(([state, data]) => ({ state, ...data }));
  }, [filtered]);

  const hsnReport = useMemo(() => {
    const map = new Map<string, { product: string; qty: number; taxable: number; gstRate: number }>();
    for (const inv of filtered) {
      const hsn = inv.hsnCode || 'N/A';
      const existing = map.get(hsn) || { product: inv.product, qty: 0, taxable: 0, gstRate: 0 };
      const totalTax = safeMoney(inv.cgst) + safeMoney(inv.sgst) + safeMoney(inv.igst);
      const rate = safeMoney(inv.subtotal) > 0 ? (totalTax / safeMoney(inv.subtotal)) * 100 : 0;
      map.set(hsn, {
        product: inv.product,
        qty: existing.qty + (inv.qty || 0),
        taxable: existing.taxable + safeMoney(inv.subtotal),
        gstRate: Math.round(rate),
      });
    }
    return Array.from(map.entries()).map(([hsn, data]) => ({ hsn, ...data }));
  }, [filtered]);

  const totals = useMemo(() => {
    return {
      taxable: salesReport.reduce((s, r) => s + r.taxable, 0),
      cgst: salesReport.reduce((s, r) => s + r.cgst, 0),
      sgst: salesReport.reduce((s, r) => s + r.sgst, 0),
      igst: salesReport.reduce((s, r) => s + r.igst, 0),
      total: salesReport.reduce((s, r) => s + r.total, 0),
    };
  }, [salesReport]);

  const exportToExcel = async () => {
    if (reportType === 'sales' && salesReport.length === 0) { toast.error('No data to export'); return; }
    if (reportType === 'state' && stateReport.length === 0) { toast.error('No data to export'); return; }
    if (reportType === 'hsn' && hsnReport.length === 0) { toast.error('No data to export'); return; }

    let filename = '';
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');

    if (reportType === 'sales') {
      filename = `Sales_GST_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const headers = Object.keys(salesReport[0]);
      ws.addRow(headers);
      salesReport.forEach((r: Record<string, any>) => ws.addRow(headers.map(h => r[h])));
    } else if (reportType === 'state') {
      filename = `State_Wise_GST_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const headers = Object.keys(stateReport[0]);
      ws.addRow(headers);
      stateReport.forEach((r: Record<string, any>) => ws.addRow(headers.map(h => r[h])));
    } else if (reportType === 'hsn') {
      filename = `HSN_Summary_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const headers = Object.keys(hsnReport[0]);
      ws.addRow(headers);
      hsnReport.forEach((r: Record<string, any>) => ws.addRow(headers.map(h => r[h])));
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  const exportGSTR1JSON = () => {
    const b2b = new Map<string, any>();
    for (const inv of filtered) {
      const gstin = 'UNREGISTERED';
      if (!b2b.has(gstin)) {
        b2b.set(gstin, { ctin: gstin, inv: [] });
      }
      const invData = b2b.get(gstin)!;
      invData.inv.push({
        inum: inv.invoiceNumber,
        idt: new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        val: safeMoney(inv.total),
        itms: [{
          num: 1,
          itm_det: {
            txval: safeMoney(inv.subtotal),
            camt: safeMoney(inv.cgst),
            samt: safeMoney(inv.sgst),
            iamt: safeMoney(inv.igst),
          },
        }],
      });
    }

    const gstr1 = {
      gstin: 'UNREGISTERED',
      fp: new Date().toISOString().slice(0, 7).replace('-', ''),
      b2b: Array.from(b2b.values()),
    };

    const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${new Date().toISOString().slice(0, 7)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('GSTR1 JSON exported');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FileText className="text-blue-600" /> GST Reports</h1>
          <p className="text-slate-500 text-sm">GST-compliant sales, state-wise, and HSN summary reports with GSTR exports.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={async () => {
              const t = toast.loading('Syncing with Cloud...');
              const res = await (await import('../db/onlineSync')).syncNow();
              toast.dismiss(t);
              if (res.online) {
                toast.success(res.pending === 0 ? 'Database up to date' : `${res.pending} items pending sync`);
              } else {
                toast.error('Sync failed: ' + (res.error || 'offline'));
              }
            }}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-900 flex items-center gap-2"
          >
            <RefreshCw size={16} /> Sync Online Leads
          </button>
          <button onClick={exportToExcel} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center gap-2"><Download size={16} /> Export Excel</button>
          <button onClick={exportGSTR1JSON} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 flex items-center gap-2"><FileSpreadsheet size={16} /> Export GSTR1 JSON</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg ml-auto">
          {(['sales', 'state', 'hsn'] as const).map(rt => (
            <button key={rt} onClick={() => setReportType(rt)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${reportType === rt ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {rt === 'sales' ? 'Sales GST' : rt === 'state' ? 'State-Wise' : 'HSN Summary'}
            </button>
          ))}
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                {reportType === 'sales' && <>
                  <th className="p-3">Invoice No</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">State</th>
                  <th className="p-3">GST Type</th>
                  <th className="p-3 text-right">Taxable</th>
                  <th className="p-3 text-right">CGST</th>
                  <th className="p-3 text-right">SGST</th>
                  <th className="p-3 text-right">IGST</th>
                  <th className="p-3 text-right">Total</th>
                </>}
                {reportType === 'state' && <>
                  <th className="p-3">State</th>
                  <th className="p-3 text-right">Invoices</th>
                  <th className="p-3 text-right">Taxable</th>
                  <th className="p-3 text-right">CGST</th>
                  <th className="p-3 text-right">SGST</th>
                  <th className="p-3 text-right">IGST</th>
                  <th className="p-3 text-right">Total GST</th>
                </>}
                {reportType === 'hsn' && <>
                  <th className="p-3">HSN</th>
                  <th className="p-3">Product</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Taxable</th>
                  <th className="p-3 text-right">GST %</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {reportType === 'sales' && salesReport.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-mono text-xs">{r.invoiceNo}</td>
                  <td className="p-3">{r.date}</td>
                  <td className="p-3">{r.customer}</td>
                  <td className="p-3">{r.state}</td>
                  <td className="p-3 text-xs">{r.gstType}</td>
                  <td className="p-3 text-right">₹{r.taxable.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{r.cgst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{r.sgst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{r.igst.toFixed(2)}</td>
                  <td className="p-3 text-right font-bold">₹{r.total.toFixed(2)}</td>
                </tr>
              ))}
              {reportType === 'state' && stateReport.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-bold">{r.state}</td>
                  <td className="p-3 text-right">{r.count}</td>
                  <td className="p-3 text-right">₹{r.taxable.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{r.cgst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{r.sgst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{r.igst.toFixed(2)}</td>
                  <td className="p-3 text-right font-bold">₹{(r.cgst + r.sgst + r.igst).toFixed(2)}</td>
                </tr>
              ))}
              {reportType === 'hsn' && hsnReport.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-mono">{r.hsn}</td>
                  <td className="p-3">{r.product}</td>
                  <td className="p-3 text-right">{r.qty}</td>
                  <td className="p-3 text-right">₹{r.taxable.toFixed(2)}</td>
                  <td className="p-3 text-right">{r.gstRate}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {reportType === 'sales' && (
                <tr className="bg-slate-100 font-bold text-sm">
                  <td className="p-3" colSpan={5}>Totals</td>
                  <td className="p-3 text-right">₹{totals.taxable.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{totals.cgst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{totals.sgst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{totals.igst.toFixed(2)}</td>
                  <td className="p-3 text-right">₹{totals.total.toFixed(2)}</td>
                </tr>
              )}
            </tfoot>
          </table></div>
        </div>
      </div>
    </div>
  );
}
