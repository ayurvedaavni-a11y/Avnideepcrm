// AVNIDEEP CRM PRO — Database Health Check & Integrity Audit Panel
// This page runs a DIRECT IndexedDB audit (not relying on UI state)
// and shows actual duplicate lead records in the database.

import { useState, useCallback } from 'react';
import { AuditReport, CleanupResult, auditLeadsTable, cleanupAndVerify, formatCleanupReport } from '../db/dbIntegrityAudit';
import Shield from 'lucide-react/dist/esm/icons/shield'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import Database from 'lucide-react/dist/esm/icons/database'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Copy from 'lucide-react/dist/esm/icons/copy'
import Download from 'lucide-react/dist/esm/icons/download'
import X from 'lucide-react/dist/esm/icons/x'
import { toast } from 'react-hot-toast';

export function DBHealthCheck() {
  const [auditResult, setAuditResult] = useState<AuditReport | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [loading, setLoading] = useState<'idle' | 'auditing' | 'cleaning'>('idle');
  const [reportText, setReportText] = useState('');

  const handleAudit = useCallback(async () => {
    setLoading('auditing');
    setCleanupResult(null);
    try {
      const report = await auditLeadsTable();
      setAuditResult(report);
      toast.success(`Audit complete: ${report.totalLeads} leads, ${report.duplicateGroups.length} duplicate groups`);
    } catch (e: any) {
      toast.error('Audit failed: ' + e.message);
    } finally {
      setLoading('idle');
    }
  }, []);

  const handleCleanup = useCallback(async () => {
    setLoading('cleaning');
    try {
      const result = await cleanupAndVerify();
      setCleanupResult(result);
      setAuditResult(result.after);
      
      const report = formatCleanupReport(result);
      setReportText(report);
      
      if (result.cleanupSuccess) {
        toast.success(`Cleanup complete! ${result.removedCount} duplicate(s) removed.`);
      } else {
        toast.error('Cleanup completed but duplicates remain. Check report.');
      }
    } catch (e: any) {
      toast.error('Cleanup failed: ' + e.message);
    } finally {
      setLoading('idle');
    }
  }, []);

  const handleCopyReport = () => {
    if (reportText) {
      navigator.clipboard.writeText(reportText);
      toast.success('Report copied to clipboard!');
    }
  };

  const handleDownloadReport = () => {
    if (reportText) {
      const blob = new Blob([reportText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `db-audit-${new Date().toISOString().split('T')[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded!');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-lg">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">DB Health Check</h1>
            <p className="text-slate-500 text-sm">Database integrity audit & duplicate lead verification</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAudit}
            disabled={loading !== 'idle'}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition disabled:opacity-50 font-bold shadow-sm"
          >
            {loading === 'auditing' ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Database size={18} />
            )}
            {loading === 'auditing' ? 'Auditing...' : 'Run Audit'}
          </button>
          <button
            onClick={handleCleanup}
            disabled={loading !== 'idle'}
            className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition disabled:opacity-50 font-bold shadow-sm"
          >
            {loading === 'cleaning' ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Trash2 size={18} />
            )}
            {loading === 'cleaning' ? 'Cleaning...' : 'Audit & Clean'}
          </button>
        </div>
      </div>

      {/* Status Cards */}
      {auditResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className={`p-5 rounded-xl border shadow-sm ${auditResult.verificationStatus === 'CLEAN' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              {auditResult.verificationStatus === 'CLEAN' 
                ? <CheckCircle size={20} className="text-emerald-600" />
                : <AlertTriangle size={20} className="text-red-600" />
              }
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Status</span>
            </div>
            <p className={`text-lg font-black ${auditResult.verificationStatus === 'CLEAN' ? 'text-emerald-700' : 'text-red-700'}`}>
              {auditResult.verificationStatus === 'CLEAN' ? 'CLEAN ✅' : 'DUPLICATES ❌'}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Total Leads</p>
            <p className="text-2xl font-black text-slate-900">{auditResult.totalLeads}</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Duplicate Groups</p>
            <p className={`text-2xl font-black ${auditResult.duplicateCustomerCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {auditResult.duplicateCustomerCount}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Duplicate Records</p>
            <p className={`text-2xl font-black ${auditResult.duplicateLeadCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {auditResult.duplicateLeadCount}
            </p>
          </div>
        </div>
      )}

      {/* Cleanup Result */}
      {cleanupResult && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Trash2 size={20} className="text-amber-600" />
              <h2 className="font-bold text-slate-800">Cleanup Results</h2>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleCopyReport} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Copy report">
                <Copy size={16} />
              </button>
              <button onClick={handleDownloadReport} className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition" title="Download report">
                <Download size={16} />
              </button>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Before */}
            <div className="bg-red-50 rounded-xl p-5 border border-red-200">
              <h3 className="font-bold text-red-700 text-sm mb-3">Before Cleanup</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Total leads:</span>
                  <span className="font-bold">{cleanupResult.before.totalLeads}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Duplicates:</span>
                  <span className="font-bold text-red-600">{cleanupResult.before.duplicateLeadCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Affected customers:</span>
                  <span className="font-bold">{cleanupResult.before.duplicateCustomerCount}</span>
                </div>
              </div>
            </div>

            {/* Action */}
            <div className="bg-amber-50 rounded-xl p-5 border border-amber-200 flex flex-col items-center justify-center">
              <Trash2 size={32} className="text-amber-600 mb-2" />
              <p className="text-2xl font-black text-amber-700">{cleanupResult.removedCount}</p>
              <p className="text-sm font-bold text-amber-600">Records Removed</p>
            </div>

            {/* After */}
            <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-200">
              <h3 className="font-bold text-emerald-700 text-sm mb-3">After Cleanup</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Total leads:</span>
                  <span className="font-bold">{cleanupResult.after.totalLeads}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Duplicates:</span>
                  <span className={`font-bold ${cleanupResult.after.duplicateLeadCount === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {cleanupResult.after.duplicateLeadCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Status:</span>
                  <span className={`font-bold ${cleanupResult.cleanupSuccess ? 'text-emerald-600' : 'text-red-600'}`}>
                    {cleanupResult.cleanupSuccess ? 'CLEAN ✅' : 'FAILED ❌'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Duplicate details before cleanup */}
          {cleanupResult.before.duplicateGroups.length > 0 && (
            <div className="px-6 pb-6">
              <h3 className="font-bold text-slate-700 text-sm mb-3">Duplicate Details (before cleanup):</h3>
              <div className="space-y-2">
                {cleanupResult.before.duplicateGroups.map((group, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs font-mono">
                    <span className="text-slate-500">Customer #{group.customerId}</span>
                    {' → '}
                    <span className="text-red-600">IDs: [{group.leadIds.join(', ')}]</span>
                    {' '}
                    <span className="text-slate-600">Statuses: [{group.statuses.join(', ')}]</span>
                    {' '}
                    <span className="text-emerald-600">→ Kept ID: {group.keptLeadId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit not run yet */}
      {!auditResult && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <Database size={48} className="mx-auto mb-4 text-slate-300" />
          <h2 className="text-lg font-bold text-slate-700 mb-2">No Audit Data Yet</h2>
          <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
            Click <strong>"Run Audit"</strong> to scan the leads table directly via IndexedDB 
            and detect any duplicate records. Or click <strong>"Audit & Clean"</strong> to 
            automatically remove duplicates and verify the database is clean.
          </p>
          <div className="flex items-center justify-center gap-6 text-xs text-slate-400">
            <div className="flex items-center gap-1"><Database size={14} /> Direct IndexedDB query</div>
            <div className="flex items-center gap-1"><Trash2 size={14} /> DB-level removal</div>
            <div className="flex items-center gap-1"><CheckCircle size={14} /> Post-cleanup verification</div>
          </div>
        </div>
      )}

      {/* Report text area */}
      {reportText && (
        <div className="bg-slate-900 rounded-xl p-5">
          <div className="flex justify-between flex-wrap gap-2 items-center mb-3">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Raw Report</h3>
            <button onClick={() => setReportText('')} className="text-slate-500 hover:text-white transition">
              <X size={16} />
            </button>
          </div>
          <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap leading-relaxed">
            {reportText}
          </pre>
        </div>
      )}
    </div>
  );
}
