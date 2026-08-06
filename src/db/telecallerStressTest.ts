// telecallerStressTest.ts — Stress test for the Telecaller CRM.
// Verifies at 10 telecallers × 100/500/1000 leads:
//   - No duplicate assignments
//   - No missing leads (every lead assigned exactly once)
//   - No status conflicts
//   - No permission leaks (isolation filter per telecaller)
import { db } from './db';
import { bulkAssignLeads } from './assignmentEngine';

export interface StressScaleResult {
  scale: number;
  telecallers: number;
  leads: number;
  assigned: number;
  duplicateAssignments: number;
  missingLeads: number;
  statusConflicts: number;
  permissionLeaks: number;
  passed: boolean;
}

export async function runTelecallerStressTest(onLog: (line: string) => void): Promise<StressScaleResult[]> {
  const results: StressScaleResult[] = [];
  const tcs = Array.from({ length: 10 }, (_, i) => ({
    id: 'stress-tc-' + (i + 1),
    full_name: 'Stress TC ' + (i + 1),
    mobile: '900000000' + (i + 1),
    role: 'telecaller',
  }));

  for (const scale of [100, 500, 1000]) {
    onLog('');
    onLog('===== SCALE: ' + scale + ' LEADS / 10 TELECALLERS =====');
    const createdCustomers: number[] = [];
    const createdLeads: number[] = [];
    try {
      // 1) Create leads
      for (let i = 0; i < scale; i++) {
        const iso = new Date().toISOString();
        const mobile = String(9000000000 + scale * 10000 + i);
        const cid = await db.customers.add({
          mobile,
          name: 'Stress Customer ' + i,
          totalOrders: 0, delivered: 0, rto: 0, cancelled: 0, fakeCount: 0, totalSpend: 0,
          riskLevel: 'Low', currentStatus: 'New Lead', createdAt: iso, updatedAt: iso,
        });
        createdCustomers.push(cid);
        const lid = await db.leads.add({
          customerId: cid, product: 'Stress Product', source: 'StressTest', expectedAmount: 999,
          priority: 'Medium', status: 'New Lead', assignedAgent: '', notes: '',
          createdAt: iso, updatedAt: iso,
        });
        createdLeads.push(lid);
      }
      onLog('  Created ' + createdLeads.length + ' leads + customers');

      // 2) Bulk assign round-robin in batches of 100
      const batch = 100;
      for (let b = 0; b < scale; b += batch) {
        const chunk = createdLeads.slice(b, b + batch);
        const tc = tcs[(b / batch) % tcs.length];
        await bulkAssignLeads(chunk, tc);
      }
      onLog('  Bulk-assigned in batches of 100 (round-robin across 10 telecallers)');

      // 3) Verify: no missing, no status conflicts, distribution
      const after = await db.leads.bulkGet(createdLeads);
      let missing = 0, conflicts = 0;
      const perTc = new Map<string, number>();
      for (const l of after) {
        if (!l || !l.assignedTo) { missing++; continue; }
        if (l.status !== 'Assigned') conflicts++;
        perTc.set(l.assignedTo, (perTc.get(l.assignedTo) || 0) + 1);
      }
      onLog('  Distribution: ' + Array.from(perTc.entries()).map(([k, v]) => k + '=' + v).join(', '));

      // 4) Duplicate-assignment check: re-run bulk assign without reassign → must skip all
      const re = await bulkAssignLeads(createdLeads.slice(0, 50), tcs[0]);
      onLog('  Re-assign attempt (no reassign flag): assigned=' + re.assigned + ', skipped=' + re.skipped + ' (expect assigned=0)');

      // 5) Permission leak test: isolation filter per telecaller
      let leaks = 0;
      for (const tc of tcs) {
        const visible = after.filter(l => l && (l.assignedTo === tc.id || l.assignedAgent === tc.full_name));
        const foreign = visible.filter(l => l?.assignedTo !== tc.id);
        if (foreign.length > 0) leaks += foreign.length;
      }
      onLog('  Permission leaks: ' + leaks + ' (expect 0)');

      const passed = missing === 0 && re.assigned === 0 && conflicts === 0 && leaks === 0;
      results.push({
        scale, telecallers: 10, leads: scale,
        assigned: scale - missing,
        duplicateAssignments: re.assigned,
        missingLeads: missing,
        statusConflicts: conflicts,
        permissionLeaks: leaks,
        passed,
      });
      onLog('  RESULT: ' + (passed ? '✅ PASS' : '❌ FAIL') + '  (missing=' + missing + ', dupAssign=' + re.assigned + ', conflicts=' + conflicts + ', leaks=' + leaks + ')');
    } catch (e: any) {
      onLog('  ❌ ERROR: ' + (e?.message || 'Unknown'));
      results.push({ scale, telecallers: 10, leads: scale, assigned: 0, duplicateAssignments: 0, missingLeads: scale, statusConflicts: 0, permissionLeaks: 0, passed: false });
    } finally {
      // Cleanup test data
      await db.leads.bulkDelete(createdLeads);
      await db.customers.bulkDelete(createdCustomers);
      await db.timelineLogs.filter(l => (l.agentName || '').startsWith('Stress TC')).delete();
      onLog('  Cleanup done');
    }
  }
  return results;
}
