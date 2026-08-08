// AVNIDEEP CRM PRO — Professional Backup & Restore Center
// Exports ALL CRM tables into a single multi-sheet Excel workbook

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { toast } from 'react-hot-toast';
// exceljs imported dynamically in handleFullExport / handleImport
import Download from 'lucide-react/dist/esm/icons/download'
import Upload from 'lucide-react/dist/esm/icons/upload'
import Shield from 'lucide-react/dist/esm/icons/shield'
import Database from 'lucide-react/dist/esm/icons/database'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import HardDrive from 'lucide-react/dist/esm/icons/hard-drive'
import Clock from 'lucide-react/dist/esm/icons/clock'
import Archive from 'lucide-react/dist/esm/icons/archive'

// ===== Table export order (logical) =====
const EXPORT_TABLES = [
  { key: 'customers',    label: 'Customers',     icon: '👤' },
  { key: 'leads',        label: 'Leads',         icon: '📋' },
  { key: 'orders',       label: 'Orders',        icon: '📦' },
  { key: 'logistics',    label: 'Logistics',     icon: '🚚' },
  { key: 'ndrCases',     label: 'NDR Cases',     icon: '⚠️' },
  { key: 'invoices',     label: 'Invoices',      icon: '🧾' },
  { key: 'payments',     label: 'Payments',      icon: '💰' },
  { key: 'products',     label: 'Products',      icon: '📊' },
  { key: 'inventoryLogs',label: 'Inventory Logs',icon: '📈' },
  { key: 'invoiceItems', label: 'Invoice Items', icon: '📑' },
  { key: 'notifications',label: 'Notifications', icon: '🔔' },
  { key: 'timelineLogs', label: 'Timeline Logs', icon: '📜' },
  { key: 'invoiceSettings',label: 'Settings',    icon: '⚙️' },
  { key: 'spacelFollowups',label: 'SpaceL Follow-ups',icon: '📞' },
];

export function BackupCenter() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [exportResults, setExportResults] = useState<{ table: string; count: number }[]>([]);

  // Live counts
  const counts = {
    customers: useLiveQuery(() => db.customers.count(), []) || 0,
    leads: useLiveQuery(() => db.leads.count(), []) || 0,
    orders: useLiveQuery(() => db.orders.count(), []) || 0,
    ndrCases: useLiveQuery(() => db.ndrCases.count(), []) || 0,
    invoices: useLiveQuery(() => db.invoices.count(), []) || 0,
    payments: useLiveQuery(() => db.payments.count(), []) || 0,
    products: useLiveQuery(() => db.products.count(), []) || 0,
    inventoryLogs: useLiveQuery(() => db.inventoryLogs.count(), []) || 0,
    invoiceItems: useLiveQuery(() => db.invoiceItems.count(), []) || 0,
    notifications: useLiveQuery(() => db.notifications.count(), []) || 0,
    timelineLogs: useLiveQuery(() => db.timelineLogs.count(), []) || 0,
    invoiceSettings: useLiveQuery(() => db.invoiceSettings.count(), []) || 0,
  };

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);

  // ===== Export Full CRM Backup =====
  const handleFullExport = async () => {
    setExporting(true);
    setExportResults([]);
    
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const results: { table: string; count: number }[] = [];

      for (const table of EXPORT_TABLES) {
        const dbTable = (db as any)[table.key];
        if (!dbTable) continue;
        
        const data = await dbTable.toArray();
        const count = data.length;
        results.push({ table: table.label, count });

        if (count > 0) {
          // Convert to plain JSON (remove Dexie prototype)
          const rows = data.map((row: any) => {
            const plain: Record<string, any> = {};
            for (const key of Object.keys(row)) {
              if (key === 'id') continue; // Skip internal ID for cleanliness
              const val = row[key];
              plain[key] = typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
            }
            return plain;
          });
          
          // Create worksheet with exceljs
          const sheetName = table.label.substring(0, 31);
          const ws = wb.addWorksheet(sheetName);
          
          if (rows.length > 0) {
            const headers = Object.keys(rows[0]);
            // Header row
            ws.addRow(headers);
            
            // Auto-size column widths
            headers.forEach((h, idx) => {
              const maxLen = Math.max(
                h.length,
                ...rows.map((r: Record<string, any>) => String(r[h] || '').length)
              );
              ws.getColumn(idx + 1).width = Math.min(Math.max(maxLen + 2, 12), 42);
            });
            
            // Data rows
            rows.forEach((row: Record<string, any>) => ws.addRow(headers.map(h => row[h])));
          }
        }
      }

      // Add Metadata sheet
      const metaWs = wb.addWorksheet('Metadata');
      metaWs.addRow(['Field', 'Value']);
      metaWs.addRow(['Backup Date', new Date().toISOString()]);
      metaWs.addRow(['App Version', '1.0.0']);
      metaWs.addRow(['Total Tables', results.length]);
      metaWs.addRow(['Total Records', totalRecords]);
      metaWs.addRow(['App', 'AVNIDEEP CRM PRO']);
      metaWs.getColumn(1).width = 18;
      metaWs.getColumn(2).width = 40;

      setExportResults(results);

      // Determine filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `AVNIDEEP_CRM_Full_Backup_${timestamp}.xlsx`;

      // Try Electron save dialog first
      const electronAPI = (window as any).electron;
      if (electronAPI?.saveExportedExcel) {
        const buf = await wb.xlsx.writeBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64Data = btoa(binary);
        const result = await electronAPI.saveExportedExcel(filename, base64Data);
        if (result?.success) {
          setLastExport(result.path);
          toast.success(`Backup saved: ${result.path}`);
          setExporting(false);
          return;
        }
      }

      // Fallback: browser download
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setLastExport(filename);
      toast.success(`Full CRM backup exported: ${filename}`);
    } catch (e: any) {
      toast.error('Export failed: ' + e.message);
    }
    
    setExporting(false);
  };

  // ===== Import / Restore =====
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('⚠️ RESTORE will REPLACE ALL existing data with the backup. This cannot be undone. Are you sure?')) {
      e.target.value = '';
      return;
    }

    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await (workbook.xlsx as any).readBuffer(data);

      let totalImported = 0;
      
      // Clear all tables first
      for (const table of EXPORT_TABLES) {
        const dbTable = (db as any)[table.key];
        if (dbTable) await dbTable.clear();
      }

      // Import each sheet
      for (const table of EXPORT_TABLES) {
        // Skip metadata sheet
        if (table.label === 'Metadata') continue;

        const sheetName = table.label.substring(0, 31);
        const ws = workbook.getWorksheet(sheetName);
        if (!ws) continue;

        const rows: any[] = [];
        const headers: string[] = [];
        let rowNum = 0;
        ws.eachRow((row, rowNumber) => {
          if (rowNumber === 1) {
            row.eachCell(cell => headers.push(cell.value?.toString() || ''));
          } else {
            const obj: Record<string, any> = {};
            let colIdx = 0;
            row.eachCell(cell => {
              obj[headers[colIdx]] = cell.value;
              colIdx++;
            });
            rows.push(obj);
            rowNum++;
          }
        });
        
        if (rows.length === 0) continue;

        const dbTable = (db as any)[table.key];
        if (!dbTable) continue;

        // Bulk insert
        await dbTable.bulkAdd(rows);
        totalImported += rows.length;
      }

      toast.success(`Restore complete! ${totalImported} records imported across ${EXPORT_TABLES.length} tables.`);
      // Reload to refresh all live queries
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error('Restore failed: ' + e.message);
    }
    
    setImporting(false);
    e.target.value = '';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="text-emerald-600" size={26} /> Backup Center
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Export full CRM data or restore from previous backup
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-lg">
          <Database size={16} className="text-slate-500" />
          <span className="text-sm font-bold text-slate-700">{totalRecords.toLocaleString()} total records</span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 text-emerald-600 mb-2">
            <HardDrive size={20} />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Tables</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{EXPORT_TABLES.length}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 text-blue-600 mb-2">
            <Database size={20} />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Customers</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{counts.customers.toLocaleString()}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 text-amber-600 mb-2">
            <Database size={20} />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Orders</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{counts.orders.toLocaleString()}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 text-purple-600 mb-2">
            <Database size={20} />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Invoices</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{counts.invoices.toLocaleString()}</p>
        </div>
      </div>

      {/* Main Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Download className="text-emerald-600" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Export Full Backup</h2>
              <p className="text-sm text-slate-500">Download complete CRM data as Excel workbook</p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Included Tables</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EXPORT_TABLES.map(t => {
                  const count = (counts as any)[t.key] || 0;
                  return (
                    <div key={t.key} className="flex items-center gap-2 text-sm">
                      <span>{t.icon}</span>
                      <span className="text-slate-700 font-medium">{t.label}</span>
                      <span className="text-xs text-slate-400 ml-auto">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            onClick={handleFullExport}
            disabled={exporting || totalRecords === 0}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm text-sm"
          >
            {exporting ? (
              <><RefreshCw size={18} className="animate-spin" /> Exporting...</>
            ) : (
              <><Download size={18} /> Export Full CRM Backup</>
            )}
          </button>

          {lastExport && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 p-2 rounded-lg">
              <CheckCircle2 size={14} />
              Last export: {lastExport}
            </div>
          )}

          {exportResults.length > 0 && (
            <div className="mt-4 bg-slate-50 rounded-lg p-3 max-h-32 overflow-y-auto">
              {exportResults.map((r: { table: string; count: number }) => (
                <div key={r.table} className="flex justify-between text-xs text-slate-600 py-0.5">
                  <span>{r.table}</span>
                  <span className="font-bold">{r.count.toLocaleString()} rows</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Import/Restore Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
              <Upload className="text-amber-600" size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Restore from Backup</h2>
              <p className="text-sm text-slate-500">Import previously exported backup file</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-800">⚠️ Warning</p>
                <p className="text-xs text-amber-700 mt-1">
                  Restoring will REPLACE all existing data with the backup contents.
                  This action cannot be undone. Take a current backup first.
                </p>
              </div>
            </div>
          </div>

          <div className="border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-xl p-8 text-center cursor-pointer transition bg-slate-50 hover:bg-amber-50/20 relative">
            <input
              id="backup-restore-file"
              name="backup-restore-file"
              aria-label="Restore backup file"
              type="file"
              accept=".xlsx"
              onChange={handleImport}
              disabled={importing}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {importing ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw size={32} className="text-amber-500 animate-spin" />
                <p className="text-sm font-bold text-slate-700">Restoring...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Archive size={32} className="text-slate-400" />
                <p className="text-sm font-bold text-slate-700">Click to select backup file</p>
                <p className="text-xs text-slate-500">.xlsx files from Backup Center exports</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <Clock size={12} />
            Backup format: Multi-sheet Excel workbook (.xlsx)
          </div>
        </div>
      </div>

      {/* Table Details */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-slate-800 text-sm">Database Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-500 text-xs uppercase font-bold border-b border-slate-200">
                <th className="p-4">Table</th>
                <th className="p-4 text-right">Records</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {EXPORT_TABLES.map(t => {
                const count = (counts as any)[t.key] || 0;
                return (
                  <tr key={t.key} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="p-4">
                      <span className="font-medium text-slate-800">{t.icon} {t.label}</span>
                    </td>
                    <td className="p-4 text-right font-bold text-slate-700">{count.toLocaleString()}</td>
                    <td className="p-4">
                      {count > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">
                          <CheckCircle2 size={10} /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded">
                          Empty
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
