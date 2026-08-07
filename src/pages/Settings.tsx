import Database from 'lucide-react/dist/esm/icons/database'
import Download from 'lucide-react/dist/esm/icons/download'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Shield from 'lucide-react/dist/esm/icons/shield'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import { db } from '../db/db';
import { toast } from 'react-hot-toast';
// exceljs imported dynamically in handleExportData
import { triggerSQLiteBackup, restoreSQLiteFromDialog } from '../db/sqliteSync';
import { repairAllCustomers } from '../db/addressRepairEngine';
import LogOut from 'lucide-react/dist/esm/icons/log-out'
import UserSquare2 from 'lucide-react/dist/esm/icons/user-square-2'
import Wallet from 'lucide-react/dist/esm/icons/wallet'
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { InvoiceSettings } from './InvoiceSettings';
import { WhatsApp } from './WhatsApp';
import { changePin } from '../db/auth';
import { api } from '../db/apiClient';

function SettingsContent() {
  const { profile, isAdmin, logout } = useAuth();
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  const [pinOk, setPinOk] = useState(false);
  const [commissionRate, setCommissionRate] = useState('');
  const [commissionSaving, setCommissionSaving] = useState(false);

  // Load current commission rate once (admin-only editor).
  useEffect(() => {
    let cancelled = false;
    if (!isAdmin) return;
    api.getSettings()
      .then(r => { if (!cancelled && r?.settings?.commission_rate != null) setCommissionRate(String(r.settings.commission_rate)); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleSaveCommission = async () => {
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error('Commission rate 0-100% hona chahiye');
      return;
    }
    setCommissionSaving(true);
    try {
      await api.setSetting('commission_rate', String(rate));
      toast.success('Commission rate save ho gaya: ' + rate + '%');
    } catch (e: any) {
      toast.error(e?.message || 'Commission rate save nahi hua');
    } finally {
      setCommissionSaving(false);
    }
  };

  const handleChangePin = async () => {
    setPinMsg(''); setPinOk(false);
    if (!/^\d{6,8}$/.test(newPin.trim())) {
      setPinMsg('Naya PIN 6-8 digits ka hona chahiye.');
      return;
    }
    const res = await changePin(curPin, newPin);
    if (!res.ok) { setPinMsg(res.error || 'PIN change fail hua'); return; }
    setPinMsg('PIN successfully change ho gaya!'); setPinOk(true);
    setCurPin(''); setNewPin('');
  };
  const handleBackup = async () => {
    try {
      const electronAPI = (window as any).electron;

      // Prefer native SQLite backup if available
      if (electronAPI?.sqlite) {
        const result = await triggerSQLiteBackup();
        if (result?.ok) {
          toast.success(`SQLite snapshot saved:\n${result.path}`);
          return;
        }
      }

      // Fallback: JSON backup
      const tables = ['customers', 'leads', 'orders', 'logistics', 'ndrCases', 'timelineLogs', 'notifications'];
      const data: any = {};
      for (const table of tables) {
        data[table] = await (db as any)[table].toArray();
      }
      const dataString = JSON.stringify(data);

      if (electronAPI) {
        const result = await electronAPI.saveBackup(dataString);
        if (result.success) {
          toast.success(`Backup saved:\n${result.path}`);
        } else {
          toast.error(`Local backup failed: ${result.error}`);
        }
      } else {
        const blob = new Blob([dataString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AvnideepCRM_Backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Database backup downloaded successfully!');
      }
    } catch (error) {
      toast.error('Backup failed');
    }
  };

  const handleRestore = async () => {
    const electronAPI = (window as any).electron;
    if (!electronAPI) {
      toast.error('Backup Restore is only supported inside the Desktop application wrapper.');
      return;
    }

    if (!window.confirm('WIPE existing database and restore selected backup? This cannot be undone.')) return;

    try {
      // Prefer native SQLite restore
      if (electronAPI?.sqlite) {
        const result = await restoreSQLiteFromDialog();
        if (result?.ok) {
          toast.success('SQLite database restored. Reloading…');
          setTimeout(() => window.location.reload(), 1500);
          return;
        }
        if (result?.error && result.error !== 'Cancelled') {
          toast.error(`Restore failed: ${result.error}`);
          return;
        }
      }

      // Fallback: legacy JSON restore
      const result = await electronAPI.restoreBackupDialog();
      if (!result.success) {
        if (result.error !== 'Cancelled') {
          toast.error(`Failed to load backup: ${result.error}`);
        }
        return;
      }

      const backupObj = JSON.parse(result.data);

      await db.transaction('rw', [db.customers, db.leads, db.orders, db.ndrCases, db.timelineLogs, db.notifications, db.invoices], async () => {
        await db.customers.clear();
        await db.leads.clear();
        await db.orders.clear();
        await db.ndrCases.clear();
        await db.timelineLogs.clear();
        await db.notifications.clear();
        await db.invoices.clear();

        if (backupObj.customers) await db.customers.bulkAdd(backupObj.customers);
        if (backupObj.leads) await db.leads.bulkAdd(backupObj.leads);
        if (backupObj.orders) await db.orders.bulkAdd(backupObj.orders);
        if (backupObj.ndrCases) await db.ndrCases.bulkAdd(backupObj.ndrCases);
        if (backupObj.timelineLogs) await db.timelineLogs.bulkAdd(backupObj.timelineLogs);
        if (backupObj.notifications) await db.notifications.bulkAdd(backupObj.notifications);
        if (backupObj.invoices) await db.invoices.bulkAdd(backupObj.invoices);
      });

      toast.success('Database restored. Reloading…');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error('Restore failed. Malformed backup file.');
    }
  };

  const handleExportData = async (type: 'leads' | 'orders') => {
    try {
      const data = type === 'leads' ? await db.leads.toArray() : await db.orders.toArray();
      if (data.length === 0) {
        toast.error(`No ${type} data available to export.`);
        return;
      }

      const headers = data.length > 0 ? Object.keys(data[0]) : [];
      const filename = `${type === 'leads' ? 'Leads' : 'Orders'}_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(type === 'leads' ? 'Leads' : 'Orders');
      ws.addRow(headers);
      for (const row of data) {
        ws.addRow(headers.map(h => {
          const val = (row as any)[h];
          return typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
        }));
      }

      const electronWindow = (window as any).electron;
      if (electronWindow) {
        const buf = await wb.xlsx.writeBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64Data = btoa(binary);
        
        const result = await electronWindow.saveExportedExcel(filename, base64Data);
        if (result.success) {
          toast.success(`Export saved successfully to Exports folder:\n${result.path}`);
        } else {
          toast.error(`Failed to export file: ${result.error}`);
        }
      } else {
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Data exported successfully!');
      }
    } catch (e) {
      toast.error('Failed to export data');
    }
  };

  const handleReset = async () => {
    if (window.confirm('Are you ABSOLUTELY sure? This will delete ALL data. Type "YES" to confirm.') === false) return;
    try {
      await db.delete();
      await db.open();
      toast.success('Database reset successfully. Please reload.');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast.error('Reset failed');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
      <h1 className="text-2xl font-bold text-slate-900 font-sans">System Settings</h1>

      {/* Commission rate (admin) — drives the Telecaller Performance commission */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <Wallet className="text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">Commission Settings</h2>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-4">
            Telecallers ko commission sirf <span className="font-bold">Delivered Orders</span> par milega.
            Example: ek din me ₹10,000 ka delivered business, 10% rate par = ₹1,000 commission.
            Ye rate <span className="font-bold">Telecaller Performance</span> page par live calculate hota hai.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Commission Rate (%)</label>
              <input
                type="number" min={0} max={100} inputMode="decimal"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="10"
                className="w-40 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <button
              onClick={handleSaveCommission}
              disabled={commissionSaving}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg font-bold flex items-center gap-2 transition shadow-sm"
            >
              <Wallet size={16} /> {commissionSaving ? 'Saving…' : 'Save Commission Rate'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <Database className="text-blue-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">Database Management & Backup</h2>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="flex justify-between items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-800">Manual Backup</h3>
              <p className="text-sm text-slate-500">Download or write JSON database backup to backups folder.</p>
            </div>
            <button 
              onClick={handleBackup}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-medium shadow-sm"
            >
              <Download size={18} /> Download Backup
            </button>
          </div>

          <div className="flex justify-between items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-800">Restore Backup</h3>
              <p className="text-sm text-slate-500">Select and overwrite local database using previous json backups.</p>
            </div>
            <button 
              onClick={handleRestore}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg flex items-center gap-2 hover:bg-slate-900 transition font-medium shadow-sm"
            >
              <RefreshCw size={18} /> Select & Restore Backup
            </button>
          </div>

          <div className="flex justify-between items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-800">Auto Backup System</h3>
              <p className="text-sm text-slate-500">Currently configured to backup every 6 hours (Active in Background).</p>
            </div>
            <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full flex items-center gap-1">
              <Shield size={14} /> Active
            </span>
          </div>

          <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div>
              <h3 className="font-bold text-blue-800">Repair Customer Data</h3>
              <p className="text-sm text-blue-700">Scan all customers, fill missing city/state/pincode from pincode DB or address parsing, and normalize state names.</p>
            </div>
            <button
              onClick={async () => {
                try {
                  const result = await repairAllCustomers();
                  toast.success(`Scanned ${result.scanned} customers, repaired ${result.repaired}.`);
                } catch (e) {
                  toast.error('Customer repair failed');
                }
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-medium shadow-sm"
            >
              <RefreshCw size={18} /> Repair Customer Data
            </button>
          </div>
          
          <div className="flex justify-between items-center p-4 bg-red-50 rounded-lg border border-red-200">
            <div>
              <h3 className="font-bold text-red-800">Danger Zone: Factory Reset</h3>
              <p className="text-sm text-red-600">Wipe all data, customers, and orders permanently.</p>
            </div>
            <button 
              onClick={handleReset}
              className="px-4 py-2 bg-red-600 text-white rounded-lg flex items-center gap-2 hover:bg-red-700 transition font-medium shadow-sm"
            >
              <RotateCcw size={18} /> Reset Database
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <FileText className="text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">Spreadsheet Exports</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-800">Export Leads to Excel</h3>
              <p className="text-sm text-slate-500">Generates a complete spreadsheet of your current leads pipeline.</p>
            </div>
            <button 
              onClick={() => handleExportData('leads')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium shadow-sm"
            >
              <Download size={18} /> Export Leads
            </button>
          </div>

          <div className="flex justify-between items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-800">Export Orders to Excel</h3>
              <p className="text-sm text-slate-500">Generates a complete spreadsheet of shipped and delivered orders.</p>
            </div>
            <button 
              onClick={() => handleExportData('orders')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium shadow-sm"
            >
              <Download size={18} /> Export Orders
            </button>
          </div>
        </div>
      </div>


      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <UserSquare2 className="text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">My Account</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <h3 className="font-bold text-slate-800">{profile?.full_name || '—'}</h3>
              <p className="text-sm text-slate-500">{isAdmin ? 'Admin' : 'Telecaller'}{profile?.mobile ? ' • ' + profile.mobile : ''}</p>
            </div>
            <button onClick={logout} className="px-4 py-2 bg-red-600 text-white rounded-lg flex items-center gap-2 hover:bg-red-700 transition font-medium shadow-sm">
              <LogOut size={18} /> Logout
            </button>
          </div>
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h3 className="font-bold text-slate-800 mb-2">Change Login PIN</h3>
            <div className="flex flex-wrap gap-2">
              <input type="password" inputMode="numeric" maxLength={6} value={curPin} onChange={(e) => setCurPin(e.target.value)} placeholder="Current PIN"
                className="w-36 border border-slate-300 rounded-lg px-3 py-2 text-sm tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              <input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="New PIN"
                className="w-36 border border-slate-300 rounded-lg px-3 py-2 text-sm tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              <button onClick={handleChangePin} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition">Update PIN</button>
            </div>
            {pinMsg && <p className={"text-sm mt-2 " + (pinOk ? 'text-green-600' : 'text-red-600')}>{pinMsg}</p>}
          </div>
        </div>
      </div>

    </div>
  );
}

// =====================================================================
// Tabbed wrapper: Settings (general) + Invoice Settings + WhatsApp Auto.
// =====================================================================
export function Settings() {
  const [view, setView] = useState<'general' | 'invoice' | 'whatsapp'>('general');
  const TABS = [
    { key: 'general' as const, label: 'General' },
    { key: 'invoice' as const, label: 'Invoice' },
    { key: 'whatsapp' as const, label: 'WhatsApp Auto' },
  ];
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition ${view === t.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === 'invoice' ? <InvoiceSettings /> : view === 'whatsapp' ? <WhatsApp /> : <SettingsContent />}
    </div>
  );
}
