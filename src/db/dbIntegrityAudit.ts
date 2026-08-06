// ===================================================================
// AVNIDEEP CRM PRO — Database Integrity Audit Engine
// 
// This module performs a DIRECT database-level audit of the leads table.
// It does NOT rely on UI state, memoized values, or live queries.
// Every function queries IndexedDB directly and reports actual row counts.
//
// Use cases:
// 1. Run on demand to verify no duplicate lead records exist
// 2. Run after status changes to confirm only 1 record per customer
// 3. Generate comprehensive audit reports for admin review
// ===================================================================

import { db } from './db';
import { cleanupAllDuplicateLeads } from './workflow';

export interface DuplicateGroup {
  customerId: number;
  leadIds: number[];
  statuses: string[];
  createdAt: string[];
  keptLeadId: number;
}

export interface AuditReport {
  timestamp: string;
  totalLeads: number;
  totalCustomers: number;
  duplicateGroups: DuplicateGroup[];
  duplicateLeadCount: number;
  duplicateCustomerCount: number;
  activeLeadCounts: Record<string, number>;
  verificationStatus: 'CLEAN' | 'DUPLICATES_FOUND' | 'ERROR';
  message: string;
}

export interface CleanupResult {
  before: AuditReport;
  after: AuditReport;
  removedCount: number;
  cleanupSuccess: boolean;
}

/**
 * DIRECT DB AUDIT: Queries the leads table directly via IndexedDB.
 * Reports every lead record grouped by customerId.
 * This is the TRUTH SOURCE — not filtered through any UI state.
 */
export async function auditLeadsTable(): Promise<AuditReport> {
  try {
    // Direct query — no caching, no UI interference
    const allLeads = await db.leads.toArray();
    const allCustomers = await db.customers.toArray();

    // Group leads by customerId
    const customerGroups = new Map<number, typeof allLeads>();
    for (const lead of allLeads) {
      const list = customerGroups.get(lead.customerId) || [];
      list.push(lead);
      customerGroups.set(lead.customerId, list);
    }

    // Find duplicate groups (customerId with more than 1 lead)
    const duplicateGroups: DuplicateGroup[] = [];
    let duplicateLeadCount = 0;

    for (const [customerId, leads] of customerGroups) {
      if (leads.length > 1) {
        // Sort by ID descending to find which would be kept
        const sorted = [...leads].sort((a, b) => (b.id || 0) - (a.id || 0));
        duplicateGroups.push({
          customerId,
          leadIds: leads.map(l => l.id!).sort((a, b) => a - b),
          statuses: leads.map(l => l.status),
          createdAt: leads.map(l => l.createdAt),
          keptLeadId: sorted[0].id || 0,
        });
        duplicateLeadCount += leads.length - 1;
      }
    }

    // Count active pipeline statuses
    const activePipelineStatuses = ['New Lead', 'Interested', 'Ring', 'Callback', 'Followup'];
    const activeLeadCounts: Record<string, number> = {};
    for (const status of activePipelineStatuses) {
      activeLeadCounts[status] = allLeads.filter(l => l.status === status).length;
    }
    // Also count terminal statuses
    activeLeadCounts['Order Booked'] = allLeads.filter(l => l.status === 'Order Booked').length;
    activeLeadCounts['Not Interested'] = allLeads.filter(l => l.status === 'Not Interested').length;
    activeLeadCounts['Fake Lead'] = allLeads.filter(l => l.status === 'Fake Lead').length;

    const verificationStatus = duplicateGroups.length === 0 ? 'CLEAN' : 'DUPLICATES_FOUND';

    return {
      timestamp: new Date().toISOString(),
      totalLeads: allLeads.length,
      totalCustomers: allCustomers.length,
      duplicateGroups,
      duplicateLeadCount,
      duplicateCustomerCount: duplicateGroups.length,
      activeLeadCounts,
      verificationStatus,
      message: verificationStatus === 'CLEAN'
        ? `✅ DATABASE INTEGRITY VERIFIED: ${allLeads.length} leads, ${duplicateGroups.length} duplicate groups. All clean.`
        : `❌ DUPLICATES DETECTED: ${duplicateLeadCount} duplicate lead(s) across ${duplicateGroups.length} customer(s). Run cleanup to fix.`,
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      totalLeads: 0,
      totalCustomers: 0,
      duplicateGroups: [],
      duplicateLeadCount: 0,
      duplicateCustomerCount: 0,
      activeLeadCounts: {},
      verificationStatus: 'ERROR',
      message: `Audit failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * PRODUCTION-SAFE: Runs a full cleanup + verification cycle.
 * 1. Takes a BEFORE snapshot (including all duplicate details)
 * 2. Removes ALL duplicate leads at the DB level
 * 3. Takes an AFTER snapshot
 * 4. Returns both reports for comparison
 * 
 * This guarantees the database itself has zero duplicates.
 * UI dedup (dedupedLeads in LeadCenter) is ONLY a defensive fallback.
 */
export async function cleanupAndVerify(): Promise<CleanupResult> {
  const beforeReport = await auditLeadsTable();

  if (beforeReport.verificationStatus === 'CLEAN') {
    return {
      before: beforeReport,
      after: beforeReport,
      removedCount: 0,
      cleanupSuccess: true,
    };
  }

  // Run the production dedup engine — removes duplicates at DB level
  const removedCount = await cleanupAllDuplicateLeads();

  // Take the AFTER snapshot
  const afterReport = await auditLeadsTable();

  return {
    before: beforeReport,
    after: afterReport,
    removedCount,
    cleanupSuccess: afterReport.verificationStatus === 'CLEAN',
  };
}

/**
 * Forms a human-readable report string from cleanup results.
 */
export function formatCleanupReport(result: CleanupResult): string {
  const lines: string[] = [];
  lines.push('========================================');
  lines.push('  DATABASE INTEGRITY AUDIT REPORT');
  lines.push('========================================');
  lines.push('');
  lines.push(`  Before Cleanup:`);
  lines.push(`    Total leads:        ${result.before.totalLeads}`);
  lines.push(`    Duplicate customers: ${result.before.duplicateCustomerCount}`);
  lines.push(`    Duplicate records:   ${result.before.duplicateLeadCount}`);
  
  if (result.before.duplicateGroups.length > 0) {
    lines.push('');
    lines.push('  Duplicate Details (before):');
    for (const group of result.before.duplicateGroups) {
      const customer = result.before.totalCustomers > 0 ? 'CID#' + group.customerId : 'Unknown';
      lines.push(`    - ${customer}: IDs [${group.leadIds.join(', ')}], Statuses [${group.statuses.join(', ')}]`);
    }
  }
  
  lines.push('');
  lines.push(`  Cleanup:`);
  lines.push(`    Records removed:    ${result.removedCount}`);
  lines.push(`    Success:            ${result.cleanupSuccess ? 'YES ✅' : 'NO ❌'}`);
  lines.push('');
  lines.push(`  After Cleanup:`);
  lines.push(`    Total leads:        ${result.after.totalLeads}`);
  lines.push(`    Duplicate customers: ${result.after.duplicateCustomerCount}`);
  lines.push(`    Duplicate records:   ${result.after.duplicateLeadCount}`);
  lines.push('');
  lines.push(`  Active Pipeline Status Breakdown:`);
  for (const [status, count] of Object.entries(result.after.activeLeadCounts)) {
    lines.push(`    ${status}: ${count}`);
  }
  lines.push('');
  lines.push(`  Verification: ${result.after.verificationStatus === 'CLEAN' ? '✅ PASS - No duplicates in database' : '❌ FAIL - Duplicates remain'}`);
  lines.push('========================================');
  
  return lines.join('\n');
}
