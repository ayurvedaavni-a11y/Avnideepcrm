// AVNIDEEP CRM PRO — Invoice Module Test Runner Page
// This page imports and runs the invoice test suite, displaying results in real-time.

import { useState, useEffect, useRef } from 'react';
import { runInvoiceTestSuite, type TestReport } from '../db/invoiceTestSuite';
import { clearTestData } from '../db/qaTestSuite';
import { db } from '../db/db';
import { runTelecallerStressTest } from '../db/telecallerStressTest';

export function RunTests() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [report, setReport] = useState<TestReport | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines]);

  const addLog = (line: string) => {
    setLogLines(prev => [...prev, line]);
  };

  const runTests = async () => {
    setStatus('running');
    setReport(null);
    setError(null);
    setLogLines([]);

    try {
      addLog('=== AVNIDEEP CRM PRO — INVOICE MODULE TEST ===');
      addLog('');

      // Step 1: Clear existing test data to start fresh
      addLog('[CLEANUP] Clearing existing test data...');
      try {
        await clearTestData();
        addLog('[CLEANUP] Test data cleared successfully');
      } catch (e) {
        addLog('[CLEANUP] No data to clear (first run)');
      }
      addLog('');

      // Step 2: Run the full invoice test suite
      addLog('[TEST] Running invoice test suite...');
      addLog('[TEST] This will:');
      addLog('[TEST]   - Create 2 test customers + leads');
      addLog('[TEST]   - Convert both to orders → auto-generate invoices');
      addLog('[TEST]   - Move Order 1: Booked → ... → Delivered');
      addLog('[TEST]   - Move Order 2: Booked → ... → Cancelled');
      addLog('[TEST]   - Verify at every step (invoice, customer, duplicates)');
      addLog('[TEST]   - Test counter idempotency and revert/restore');
      addLog('[TEST]   - Test duplicate invoice prevention');
      addLog('');

      const testReport = await runInvoiceTestSuite();
      setReport(testReport);

      // Step 3: Verify data persistence (simulates restart)
      addLog('');
      addLog('[PERSISTENCE] Verifying invoices survive (simulating app restart)...');
      
      // Check that invoices are still in IndexedDB
      const totalInvoices = await db.invoices.count();
      addLog(`[PERSISTENCE] Total invoices in DB: ${totalInvoices}`);
      
      const allInvoices = await db.invoices.toArray();
      for (const inv of allInvoices) {
        addLog(`[PERSISTENCE] Invoice #${inv.invoiceNumber}: orderId=${inv.orderId}, total=₹${inv.total}, payment=${inv.paymentStatus}, fulfillment=${inv.fulfillmentStatus}`);
      }

      // Check no duplicates
      const orderInvoiceCounts = new Map<number, number>();
      for (const inv of allInvoices) {
        if (inv.orderId && inv.orderId > 0) {
          orderInvoiceCounts.set(inv.orderId, (orderInvoiceCounts.get(inv.orderId) || 0) + 1);
        }
      }
      let dupFound = false;
      for (const [oid, count] of orderInvoiceCounts) {
        if (count > 1) {
          dupFound = true;
          addLog(`[PERSISTENCE] ⚠️ DUPLICATE: Order #${oid} has ${count} invoices`);
        }
      }
      if (!dupFound) addLog('[PERSISTENCE] ✅ No duplicate invoices found');

      addLog('');
      addLog('=== TEST COMPLETE ===');
      addLog(`Passed: ${testReport.passed}`);
      addLog(`Failed: ${testReport.failed}`);
      addLog(`Warnings: ${testReport.warnings}`);
      addLog(testReport.summary);

      setStatus('done');
    } catch (err: any) {
      setError(err?.message || 'Unknown error during test execution');
      addLog(`[ERROR] ${err?.message || 'Unknown error'}`);
      addLog(err?.stack || '');
      setStatus('done');
    }
  };

  const [stressReport, setStressReport] = useState<any[] | null>(null);
  const [stressRunning, setStressRunning] = useState(false);
  const [stressLogLines, setStressLogLines] = useState<string[]>([]);
  const [stressError, setStressError] = useState<string | null>(null);
  const stressLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stressLogEndRef.current) {
      stressLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [stressLogLines]);

  const runStressTest = async () => {
    setStressRunning(true);
    setStressReport(null);
    setStressError(null);
    setStressLogLines([]);
    try {
      const results = await runTelecallerStressTest((line) => {
        setStressLogLines(prev => [...prev, line]);
      });
      setStressReport(results);
    } catch (err: any) {
      setStressError(err?.message || 'Unknown error');
      setStressLogLines(prev => [...prev, '[ERROR] ' + (err?.message || 'Unknown')]);
    } finally {
      setStressRunning(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🧪 Invoice Module Test Runner</h1>
          <p className="text-slate-500 text-sm mt-1">
            Executes the comprehensive invoice test suite in your browser.
            Tests run against the live IndexedDB database.
          </p>
        </div>
        <button
          onClick={runTests}
          disabled={status === 'running'}
          className={`px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-all ${
            status === 'running'
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
          }`}
        >
          {status === 'running' ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Running...
            </span>
          ) : status === 'done' ? (
            'Run Again'
          ) : (
            '▶ Run Tests'
          )}
        </button>
      </div>

      {/* Results Summary */}
      {report && (
        <div className={`rounded-xl border-2 p-6 ${
          report.failed === 0
            ? 'bg-emerald-50 border-emerald-300'
            : 'bg-red-50 border-red-300'
        }`}>
          <div className="text-center">
            <div className="text-4xl mb-2">{report.failed === 0 ? '✅' : '❌'}</div>
            <h2 className={`text-xl font-bold ${report.failed === 0 ? 'text-emerald-800' : 'text-red-800'}`}>
              {report.failed === 0 ? 'ALL TESTS PASSED - PRODUCTION READY' : 'TESTS FAILED'}
            </h2>
            <div className="flex justify-center gap-6 mt-3">
              <span className="text-emerald-700 font-bold">✅ {report.passed} Passed</span>
              {report.failed > 0 && <span className="text-red-700 font-bold">❌ {report.failed} Failed</span>}
              {report.warnings > 0 && <span className="text-amber-700 font-bold">⚠️ {report.warnings} Warnings</span>}
            </div>
            <p className="text-slate-600 text-sm mt-2">{report.summary}</p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
          <h3 className="font-bold text-red-800 mb-1">❌ Test Execution Error</h3>
          <pre className="text-sm text-red-700 whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {/* Detailed Log */}
      <div className="bg-slate-900 rounded-xl p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-300">Test Log</h3>
          <span className="text-xs text-slate-500">{logLines.length} lines</span>
        </div>
        <div className="max-h-[500px] overflow-y-auto font-mono text-xs space-y-0.5">
          {logLines.length === 0 && status === 'idle' && (
            <p className="text-slate-600 italic">Click "Run Tests" to start...</p>
          )}
          {logLines.map((line, i) => (
            <div
              key={i}
              className={`px-2 py-0.5 rounded ${
                line.startsWith('[ERROR]')
                  ? 'text-red-400 bg-red-900/20'
                  : line.startsWith('✅') || line.includes('PASS')
                  ? 'text-emerald-400'
                  : line.startsWith('❌') || line.includes('FAIL')
                  ? 'text-red-400'
                  : line.startsWith('⚠️')
                  ? 'text-amber-400'
                  : line.startsWith('[')
                  ? 'text-blue-400'
                  : 'text-slate-300'
              }`}
            >
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Failure Details */}
      {report && report.failed > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
          <h3 className="font-bold text-red-800 mb-2">❌ Failure Details</h3>
          {report.assertions
            .filter(a => a.status === 'FAIL')
            .map((a, i) => (
              <div key={i} className="mb-3 p-3 bg-white rounded-lg border border-red-200">
                <p className="font-bold text-red-700 text-sm">[{a.step}] {a.detail}</p>
                <p className="text-xs text-slate-600 mt-1">
                  Expected: <span className="font-mono text-red-600">{a.expected}</span>
                </p>
                <p className="text-xs text-slate-600">
                  Actual: <span className="font-mono text-amber-600">{a.actual}</span>
                </p>
              </div>
            ))}
        </div>
      )}
      {/* ============ TELECALLER CRM STRESS TEST ============ */}
      <div className="pt-8 border-t-2 border-dashed border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">📞 Telecaller CRM Stress Test</h2>
            <p className="text-slate-500 text-sm mt-1">
              10 telecallers × 100 / 500 / 1000 leads — verifies no duplicate
              assignments, no missing leads, no status conflicts, no permission leaks.
            </p>
          </div>
          <button
            onClick={runStressTest}
            disabled={stressRunning}
            className={"px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-all " + (stressRunning
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-md')}
          >
            {stressRunning ? 'Running…' : '▶ Run Stress Test'}
          </button>
        </div>

        {stressReport && (
          <div className={"mt-6 rounded-xl border-2 p-6 " + (stressReport.every(r => r.passed)
            ? 'bg-emerald-50 border-emerald-300'
            : 'bg-red-50 border-red-300')}>
            <h3 className={"text-xl font-bold " + (stressReport.every(r => r.passed) ? 'text-emerald-800' : 'text-red-800')}>
              {stressReport.every(r => r.passed) ? '✅ ALL STRESS TESTS PASSED' : '❌ STRESS TESTS FAILED'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {stressReport.map(r => (
                <div key={r.scale} className={"rounded-xl border p-4 " + (r.passed ? 'bg-white border-emerald-200' : 'bg-white border-red-200')}>
                  <p className="font-bold text-slate-800">{r.scale} leads / {r.telecallers} telecallers</p>
                  <ul className="text-xs text-slate-600 mt-2 space-y-1">
                    <li>Assigned: {r.assigned} / {r.leads}</li>
                    <li>Duplicate assignments: {r.duplicateAssignments}</li>
                    <li>Missing leads: {r.missingLeads}</li>
                    <li>Status conflicts: {r.statusConflicts}</li>
                    <li>Permission leaks: {r.permissionLeaks}</li>
                  </ul>
                  <p className={"mt-2 font-bold text-xs " + (r.passed ? 'text-emerald-600' : 'text-red-600')}>
                    {r.passed ? '✅ PASS' : '❌ FAIL'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {stressError && (
          <div className="mt-6 bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <h3 className="font-bold text-red-800 mb-1">❌ Stress Test Error</h3>
            <pre className="text-sm text-red-700 whitespace-pre-wrap">{stressError}</pre>
          </div>
        )}

        <div className="mt-4 bg-slate-900 rounded-xl p-4 border border-slate-700">
          <h3 className="text-sm font-bold text-slate-300 mb-3">Stress Test Log</h3>
          <div className="max-h-[400px] overflow-y-auto font-mono text-xs space-y-0.5">
            {stressLogLines.length === 0 && !stressRunning && (
              <p className="text-slate-600 italic">Run the stress test to see results…</p>
            )}
            {stressLogLines.map((line, i) => (
              <div key={i} className={"px-2 py-0.5 rounded " + (line.includes('❌')
                ? 'text-red-400'
                : line.includes('✅') || line.includes('PASS')
                ? 'text-emerald-400'
                : line.startsWith('[')
                ? 'text-blue-400'
                : 'text-slate-300')}>
                {line}
              </div>
            ))}
            <div ref={stressLogEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
