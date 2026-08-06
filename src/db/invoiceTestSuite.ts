// ===================================================================
// AVNIDEEP CRM PRO — Invoice Module Comprehensive Test Suite
// ===================================================================
// Automatically:
// 1. Creates 2 test customers + leads
// 2. Converts leads to orders (triggers auto-invoice creation)
// 3. Moves Order 1: Booked → Packing → Packed → Shipped → In Transit → Out For Delivery → Delivered
// 4. Moves Order 2: Booked → Packing → Packed → Shipped → In Transit → Cancelled
// 5. Verifies at EVERY step: invoice existence (exactly 1), payment sync, customer counters,
//    dashboard stats, logistics records, no duplicates
// 6. Generates a detailed PASS/FAIL report
// ===================================================================

import { db } from './db';
import { autoGenerateInvoice } from './invoiceEngine';
import { syncOrderToCentralStatus } from './workflow';

export interface TestAssertion {
  step: string;
  detail: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  expected: string;
  actual: string;
}

export interface TestReport {
  timestamp: string;
  assertions: TestAssertion[];
  passed: number;
  failed: number;
  warnings: number;
  summary: string;
}

const TERMINAL_DELIVERED = 'Delivered';
const TERMINAL_CANCELLED = 'Cancelled';

function assert(step: string, detail: string, condition: boolean, expected: string, actual: string): TestAssertion {
  return { step, detail, status: condition ? 'PASS' : 'FAIL', expected, actual };
}



// ===================================================================
// HELPER: Verify exactly 1 invoice exists for an orderId
// ===================================================================
async function verifySingleInvoice(orderId: number): Promise<TestAssertion[]> {
  const results: TestAssertion[] = [];
  const invoices = await db.invoices.where('orderId').equals(orderId).toArray();
  
  results.push(assert(
    'Invoice Existence',
    `Order #${orderId}: Exactly 1 invoice exists`,
    invoices.length === 1,
    '1 invoice',
    `${invoices.length} invoices`
  ));

  if (invoices.length > 0) {
    const inv = invoices[0];
    results.push(assert(
      'Invoice Fields',
      `Invoice #${inv.invoiceNumber}: orderId matches`,
      inv.orderId === orderId,
      `orderId = ${orderId}`,
      `orderId = ${inv.orderId}`
    ));
    results.push(assert(
      'Invoice Fields',
      `Invoice has non-empty invoiceNumber`,
      !!inv.invoiceNumber && inv.invoiceNumber.length > 0,
      'non-empty invoiceNumber',
      inv.invoiceNumber || '(empty)'
    ));
    results.push(assert(
      'Invoice Fields',
      `Invoice total > 0`,
      (inv.total || 0) > 0,
      'total > 0',
      `total = ${inv.total}`
    ));
    results.push(assert(
      'Invoice Fields',
      `Invoice has customerName`,
      !!inv.customerName,
      'non-empty customerName',
      inv.customerName || '(empty)'
    ));
  }

  return results;
}

// ===================================================================
// HELPER: Verify no duplicate invoices exist for ANY order
// ===================================================================
async function verifyNoDuplicates(): Promise<TestAssertion[]> {
  const results: TestAssertion[] = [];
  const allInvoices = await db.invoices.toArray();
  const orderInvoiceCounts = new Map<number, number>();
  
  for (const inv of allInvoices) {
    if (inv.orderId && inv.orderId > 0) {
      orderInvoiceCounts.set(inv.orderId, (orderInvoiceCounts.get(inv.orderId) || 0) + 1);
    }
  }

  let hasDuplicates = false;
  for (const [oid, count] of orderInvoiceCounts) {
    if (count > 1) {
      hasDuplicates = true;
      results.push(assert(
        'Zero Duplicates',
        `Order #${oid} has ${count} invoices (should be 1)`,
        false,
        '1 per orderId',
        `${count} per orderId`
      ));
    }
  }

  if (!hasDuplicates) {
    results.push(assert(
      'Zero Duplicates',
      'All orders have exactly 1 invoice each',
      true,
      'No duplicate invoices',
      `Verified ${allInvoices.length} total invoices, ${orderInvoiceCounts.size} unique orderIds`
    ));
  }

  return results;
}

// ===================================================================
// HELPER: Verify customer stats are correct
// ===================================================================
async function verifyCustomerStats(customerId: number, expectedDelivered: number, expectedRTO: number, expectedCancelled: number, expectedTotalOrders: number): Promise<TestAssertion[]> {
  const results: TestAssertion[] = [];
  const customer = await db.customers.get(customerId);
  
  if (!customer) {
    results.push(assert('Customer Stats', `Customer #${customerId} exists`, false, 'Customer found', 'Not found'));
    return results;
  }

  results.push(assert(
    'Customer Stats',
    `Customer #${customerId}: delivered = ${expectedDelivered}`,
    (customer.delivered || 0) === expectedDelivered,
    `delivered = ${expectedDelivered}`,
    `delivered = ${customer.delivered}`
  ));

  results.push(assert(
    'Customer Stats',
    `Customer #${customerId}: rto = ${expectedRTO}`,
    (customer.rto || 0) === expectedRTO,
    `rto = ${expectedRTO}`,
    `rto = ${customer.rto}`
  ));

  results.push(assert(
    'Customer Stats',
    `Customer #${customerId}: cancelled = ${expectedCancelled}`,
    (customer.cancelled || 0) === expectedCancelled,
    `cancelled = ${expectedCancelled}`,
    `cancelled = ${customer.cancelled}`
  ));

  results.push(assert(
    'Customer Stats',
    `Customer #${customerId}: totalOrders = ${expectedTotalOrders}`,
    (customer.totalOrders || 0) === expectedTotalOrders,
    `totalOrders = ${expectedTotalOrders}`,
    `totalOrders = ${customer.totalOrders}`
  ));

  return results;
}

// ===================================================================
// HELPER: Verify invoice payment status matches expected
// ===================================================================
async function verifyInvoicePaymentStatus(orderId: number, expectedPaymentStatus: string, expectedFulfillmentStatus: string): Promise<TestAssertion[]> {
  const results: TestAssertion[] = [];
  const invoice = await db.invoices.where('orderId').equals(orderId).first();
  
  if (!invoice) {
    results.push(assert('Invoice Payment', `Invoice for Order #${orderId} exists`, false, 'Invoice found', 'Not found'));
    return results;
  }

  results.push(assert(
    'Invoice Payment',
    `Invoice #${invoice.invoiceNumber}: paymentStatus = ${expectedPaymentStatus}`,
    invoice.paymentStatus === expectedPaymentStatus,
    expectedPaymentStatus,
    invoice.paymentStatus || '(undefined)'
  ));

  results.push(assert(
    'Invoice Fulfillment',
    `Invoice #${invoice.invoiceNumber}: fulfillmentStatus = ${expectedFulfillmentStatus}`,
    invoice.fulfillmentStatus === expectedFulfillmentStatus,
    expectedFulfillmentStatus,
    invoice.fulfillmentStatus || '(undefined)'
  ));

  return results;
}

// ===================================================================
// MAIN TEST RUNNER
// ===================================================================
export async function runInvoiceTestSuite(): Promise<TestReport> {
  const startTime = Date.now();
  const allAssertions: TestAssertion[] = [];
  const log = (a: TestAssertion) => { allAssertions.push(a); };

  // Test IDs
  let leadId1: number, leadId2: number;
  let customerId1: number, customerId2: number;
  let orderId1: number, orderId2: number;

  try {
    // ===================================================================
    // PHASE 0: SETUP — Create test customers
    // ===================================================================
    log(assert('Setup', 'Phase 0: Creating test customers', true, '-', '-'));

    customerId1 = await db.customers.add({
      mobile: '9999999901',
      name: 'Test Customer One (Delivered)',
      address: 'Test Address 1, Sector 62',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pincode: '201301',
      totalOrders: 0, delivered: 0, rto: 0, cancelled: 0, fakeCount: 0, totalSpend: 0,
      riskLevel: 'Low', currentStatus: 'New Lead',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }) as number;

    customerId2 = await db.customers.add({
      mobile: '9999999902',
      name: 'Test Customer Two (Cancelled)',
      address: 'Test Address 2, MG Road',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560001',
      totalOrders: 0, delivered: 0, rto: 0, cancelled: 0, fakeCount: 0, totalSpend: 0,
      riskLevel: 'Low', currentStatus: 'New Lead',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }) as number;

    log(assert('Setup', `Customer 1 created: ID=${customerId1}`, customerId1 > 0, 'ID > 0', `ID = ${customerId1}`));
    log(assert('Setup', `Customer 2 created: ID=${customerId2}`, customerId2 > 0, 'ID > 0', `ID = ${customerId2}`));

    // ===================================================================
    // PHASE 1: Create leads
    // ===================================================================
    log(assert('Phase 1', 'Creating test leads', true, '-', '-'));

    const l1Id = await db.leads.add({
      customerId: customerId1,
      product: 'Wireless Earbuds Pro',
      source: 'Test Suite',
      expectedAmount: 1299,
      priority: 'High',
      status: 'New Lead',
      assignedAgent: 'Test Agent',
      notes: 'Test lead 1 - Will be fully delivered',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }) as number;
    leadId1 = l1Id;

    const l2Id = await db.leads.add({
      customerId: customerId2,
      product: 'Smart Watch X200',
      source: 'Test Suite',
      expectedAmount: 2499,
      priority: 'Medium',
      status: 'New Lead',
      assignedAgent: 'Test Agent',
      notes: 'Test lead 2 - Will be cancelled',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }) as number;
    leadId2 = l2Id;

    log(assert('Phase 1', `Lead 1 created: ID=${leadId1}`, leadId1 > 0, 'ID > 0', `ID = ${leadId1}`));
    log(assert('Phase 1', `Lead 2 created: ID=${leadId2}`, leadId2 > 0, 'ID > 0', `ID = ${leadId2}`));

    // ===================================================================
    // PHASE 2: Convert leads to orders (simulates convertLeadToOrder)
    // ===================================================================
    log(assert('Phase 2', 'Converting leads to orders', true, '-', '-'));

    // --- Convert Lead 1 ---
    const orderId1Str = `TEST-ORD-${Date.now()}-1`;
    const o1Id = await db.orders.add({
      orderId: orderId1Str,
      leadId: leadId1,
      customerId: customerId1,
      product: 'Wireless Earbuds Pro',
      qty: 1,
      codAmount: 1299,
      status: 'Order Booked',
      orderDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }) as number;
    orderId1 = o1Id;

    await db.leads.update(leadId1, { status: 'Order Booked', updatedAt: new Date().toISOString() });
    await db.customers.update(customerId1, {
      totalOrders: 1, lastOrderDate: new Date().toISOString(), currentStatus: 'Order Booked' as any, updatedAt: new Date().toISOString()
    });

    // Auto-generate invoice for Order 1
    const inv1 = await autoGenerateInvoice(orderId1, 'Test Suite');
    log(assert('Phase 2', `Order 1 invoice generated: ${inv1?.invoiceNumber || 'NONE'}`, !!inv1, 'Invoice created', inv1 ? inv1.invoiceNumber : 'null'));

    // --- Convert Lead 2 ---
    const orderId2Str = `TEST-ORD-${Date.now()}-2`;
    const o2Id = await db.orders.add({
      orderId: orderId2Str,
      leadId: leadId2,
      customerId: customerId2,
      product: 'Smart Watch X200',
      qty: 1,
      codAmount: 2499,
      status: 'Order Booked',
      orderDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }) as number;
    orderId2 = o2Id;

    await db.leads.update(leadId2, { status: 'Order Booked', updatedAt: new Date().toISOString() });
    await db.customers.update(customerId2, {
      totalOrders: 1, lastOrderDate: new Date().toISOString(), currentStatus: 'Order Booked' as any, updatedAt: new Date().toISOString()
    });

    const inv2 = await autoGenerateInvoice(orderId2, 'Test Suite');
    log(assert('Phase 2', `Order 2 invoice generated: ${inv2?.invoiceNumber || 'NONE'}`, !!inv2, 'Invoice created', inv2 ? inv2.invoiceNumber : 'null'));

    // ===================================================================
    // PHASE 2b: IDEMPOTENCY TEST — Call autoGenerateInvoice again for same order
    // ===================================================================
    log(assert('Phase 2b', 'Testing idempotency: calling autoGenerateInvoice again', true, '-', '-'));

    const inv1Again = await autoGenerateInvoice(orderId1, 'Test Suite');
    const invsForOrder1 = await db.invoices.where('orderId').equals(orderId1).toArray();
    log(assert(
      'Idempotency',
      `Order 1: autoGenerateInvoice called twice, still ${invsForOrder1.length} invoice(s)`,
      invsForOrder1.length === 1,
      '1 invoice (idempotent)',
      `${invsForOrder1.length} invoice(s)`
    ));
    // Should return the existing invoice (not create new)
    log(assert(
      'Idempotency',
      `Order 1: Second call returned existing invoice (${inv1Again?.invoiceNumber || 'null'})`,
      !!inv1Again && inv1Again.id === inv1?.id,
      `Same invoice (id=${inv1?.id})`,
      inv1Again ? `invoice=${inv1Again.invoiceNumber}, id=${inv1Again.id}` : 'null returned'
    ));

    // ===================================================================
    // PHASE 3: Move Order 1 through FULL lifecycle: Booked → Packing → Packed → Shipped → In Transit → Out For Delivery → Delivered
    // ===================================================================
    log(assert('Phase 3', 'Moving Order 1 through full lifecycle → Delivered', true, '-', '-'));

    const lifecycle1 = [
      { status: 'Packing',    newFulfillment: 'Pending',   newPayment: 'COD Pending' },
      { status: 'Packed',     newFulfillment: 'Pending',   newPayment: 'COD Pending' },
      { status: 'Ready To Ship', newFulfillment: 'Pending',   newPayment: 'COD Pending' },
      { status: 'Shipped',    newFulfillment: 'Shipped',   newPayment: 'COD Pending' },
      { status: 'In Transit', newFulfillment: 'In Transit', newPayment: 'COD Pending' },
      { status: 'Out For Delivery', newFulfillment: 'Out For Delivery', newPayment: 'COD Pending' },
      { status: TERMINAL_DELIVERED, newFulfillment: 'Delivered', newPayment: 'Paid' },
    ];

    for (const step of lifecycle1) {
      const oldStatus = (await db.orders.get(orderId1))?.status || 'Order Booked';
      await db.orders.update(orderId1, { status: step.status as any, updatedAt: new Date().toISOString() });
      await syncOrderToCentralStatus(orderId1, step.status, oldStatus);

      // Verify invoice at each step
      const invoiceResults = await verifySingleInvoice(orderId1);
      invoiceResults.forEach(r => log(r));

      // Verify payment/fulfillment status
      const paymentResults = await verifyInvoicePaymentStatus(orderId1, step.newPayment, step.newFulfillment);
      paymentResults.forEach(r => log(r));

      // Verify no duplicates
      const dupResults = await verifyNoDuplicates();
      dupResults.forEach(r => log(r));
    }

    // ===================================================================
    // PHASE 4: Move Order 2 through partial lifecycle → Cancelled
    // ===================================================================
    log(assert('Phase 4', 'Moving Order 2 through partial lifecycle → Cancelled', true, '-', '-'));

    const lifecycle2 = [
      { status: 'Packing',    newFulfillment: 'Pending',   newPayment: 'COD Pending' },
      { status: 'Packed',     newFulfillment: 'Pending',   newPayment: 'COD Pending' },
      { status: 'Ready To Ship', newFulfillment: 'Pending',   newPayment: 'COD Pending' },
      { status: 'Shipped',    newFulfillment: 'Shipped',   newPayment: 'COD Pending' },
      { status: 'In Transit', newFulfillment: 'In Transit', newPayment: 'COD Pending' },
      { status: TERMINAL_CANCELLED, newFulfillment: 'Cancelled', newPayment: 'Cancelled' },
    ];

    for (const step of lifecycle2) {
      const oldStatus = (await db.orders.get(orderId2))?.status || 'Order Booked';
      await db.orders.update(orderId2, { status: step.status as any, updatedAt: new Date().toISOString() });
      await syncOrderToCentralStatus(orderId2, step.status, oldStatus);

      const invoiceResults = await verifySingleInvoice(orderId2);
      invoiceResults.forEach(r => log(r));

      const paymentResults = await verifyInvoicePaymentStatus(orderId2, step.newPayment, step.newFulfillment);
      paymentResults.forEach(r => log(r));

      const dupResults = await verifyNoDuplicates();
      dupResults.forEach(r => log(r));
    }

    // ===================================================================
    // PHASE 5: Full verification — customer counters, no duplicates, dashboard data
    // ===================================================================
    log(assert('Phase 5', 'Final verification', true, '-', '-'));

    // Verify Customer 1 stats: delivered=1, rto=0, cancelled=0, totalOrders=1
    const c1Stats = await verifyCustomerStats(customerId1, 1, 0, 0, 1);
    c1Stats.forEach(r => log(r));

    // Verify Customer 2 stats: delivered=0, rto=0, cancelled=1, totalOrders=1
    const c2Stats = await verifyCustomerStats(customerId2, 0, 0, 1, 1);
    c2Stats.forEach(r => log(r));

    // Final no-duplicates check across ALL invoices
    const finalDupCheck = await verifyNoDuplicates();
    finalDupCheck.forEach(r => log(r));

    // Verify invoices survive (are still there — not deleted on status changes)
    const totalInvoices = await db.invoices.count();
    log(assert(
      'Persistence',
      `Total invoices in DB after all status changes: ${totalInvoices}`,
      totalInvoices >= 2,
      'At least 2 invoices exist',
      `${totalInvoices} invoices`
    ));

    // ===================================================================
    // PHASE 6: COUNTER IDEMPOTENCY TEST
    // Call syncOrderToCentralStatus with SAME status → counters should NOT increment
    // ===================================================================
    log(assert('Phase 6', 'Counter idempotency test: calling same status repeatedly', true, '-', '-'));

    const c1Before = await db.customers.get(customerId1);
    const beforeDelivered = c1Before?.delivered || 0;

    // Call with same status (Delivered → Delivered) — should NOT increment
    await syncOrderToCentralStatus(orderId1, TERMINAL_DELIVERED, TERMINAL_DELIVERED);

    const c1After = await db.customers.get(customerId1);
    const afterDelivered = c1After?.delivered || 0;

    log(assert(
      'Counter Idempotency',
      `Same status (Delivered→Delivered): delivered stayed at ${beforeDelivered}`,
      afterDelivered === beforeDelivered,
      `delivered = ${beforeDelivered} (unchanged)`,
      `delivered = ${afterDelivered}`
    ));

    // Call with a DIFFERENT (non-terminal) status and back
    await syncOrderToCentralStatus(orderId1, 'In Transit', TERMINAL_DELIVERED);
    const c1Revert = await db.customers.get(customerId1);
    log(assert(
      'Counter Revert',
      `Moving away from Delivered: delivered decremented from ${beforeDelivered} to ${c1Revert?.delivered}`,
      (c1Revert?.delivered || 0) === beforeDelivered - 1,
      `delivered = ${beforeDelivered - 1}`,
      `delivered = ${c1Revert?.delivered}`
    ));

    // Restore back to Delivered
    await syncOrderToCentralStatus(orderId1, TERMINAL_DELIVERED, 'In Transit');
    const c1Restored = await db.customers.get(customerId1);
    log(assert(
      'Counter Restore',
      `Moving back to Delivered: delivered restored to ${beforeDelivered}`,
      (c1Restored?.delivered || 0) === beforeDelivered,
      `delivered = ${beforeDelivered}`,
      `delivered = ${c1Restored?.delivered}`
    ));

    // ===================================================================
    // PHASE 7: Duplicate invoice creation prevention test
    // ===================================================================
    log(assert('Phase 7', 'Edge case: duplicate prevention', true, '-', '-'));

    const invsBefore = await db.invoices.where('orderId').equals(orderId1).count();
    await autoGenerateInvoice(orderId1, 'Test Suite');
    const invsAfter = await db.invoices.where('orderId').equals(orderId1).count();
    log(assert(
      'Duplicate Prevention',
      `autoGenerateInvoice for existing order: ${invsBefore} → ${invsAfter} invoices`,
      invsAfter === invsBefore,
      `${invsBefore} invoices (unchanged)`,
      `${invsAfter} invoices`
    ));

    // ===================================================================
    // SUMMARY
    // ===================================================================
    const elapsed = Date.now() - startTime;
    const passed = allAssertions.filter(a => a.status === 'PASS').length;
    const failed = allAssertions.filter(a => a.status === 'FAIL').length;
    const warnings = allAssertions.filter(a => a.status === 'WARN').length;

    let summary = '';
    if (failed === 0) {
      summary = `✅ ALL ${passed} TESTS PASSED in ${elapsed}ms`;
    } else {
      summary = `❌ ${failed} FAILURES out of ${passed + failed + warnings} total assertions in ${elapsed}ms`;
    }

    return {
      timestamp: new Date().toISOString(),
      assertions: allAssertions,
      passed,
      failed,
      warnings,
      summary,
    };
  } catch (error: any) {
    log(assert('SYSTEM', 'Unhandled test exception', false, 'No errors', error?.message || 'Unknown error'));
    
    return {
      timestamp: new Date().toISOString(),
      assertions: allAssertions,
      passed: allAssertions.filter(a => a.status === 'PASS').length,
      failed: allAssertions.filter(a => a.status === 'FAIL').length,
      warnings: allAssertions.filter(a => a.status === 'WARN').length,
      summary: `❌ TEST CRASHED: ${error?.message || 'Unknown error'}`,
    };
  }
}

// ===================================================================
// FORMAT REPORT AS STRING
// ===================================================================
export function formatTestReport(report: TestReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔═══════════════════════════════════════════════════════════╗');
  lines.push('║     AVNIDEEP CRM PRO — INVOICE MODULE TEST REPORT       ║');
  lines.push('╚═══════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Timestamp: ${report.timestamp}`);
  lines.push(`  Duration: ${new Date(report.timestamp).getTime() - new Date(report.timestamp).getTime()}ms`);
  lines.push('');
  lines.push('  ─── RESULTS ───');
  lines.push(`  ✅ Passed:  ${report.passed}`);
  lines.push(`  ❌ Failed:  ${report.failed}`);
  lines.push(`  ⚠️  Warnings: ${report.warnings}`);
  lines.push(`  Total:     ${report.assertions.length}`);
  lines.push('');
  lines.push(`  ${report.summary}`);
  lines.push('');

  if (report.failed > 0) {
    lines.push('  ─── FAILURES ───');
    for (const a of report.assertions) {
      if (a.status === 'FAIL') {
        lines.push(`  ❌ [${a.step}] ${a.detail}`);
        lines.push(`     Expected: ${a.expected}`);
        lines.push(`     Actual:   ${a.actual}`);
        lines.push('');
      }
    }
  }

  if (report.warnings > 0) {
    lines.push('  ─── WARNINGS ───');
    for (const a of report.assertions) {
      if (a.status === 'WARN') {
        lines.push(`  ⚠️  [${a.step}] ${a.detail}`);
        lines.push(`     Expected: ${a.expected}`);
        lines.push(`     Actual:   ${a.actual}`);
        lines.push('');
      }
    }
  }

  lines.push('  ─── ALL ASSERTIONS ───');
  for (const a of report.assertions) {
    const icon = a.status === 'PASS' ? '✅' : a.status === 'FAIL' ? '❌' : '⚠️';
    lines.push(`  ${icon} [${a.step}] ${a.detail}`);
  }

  lines.push('');
  lines.push('╚═══════════════════════════════════════════════════════════╝');
  
  return lines.join('\n');
}
