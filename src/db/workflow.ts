import { db } from './db';
import { toast } from 'react-hot-toast';
import { autoGenerateInvoice, syncInvoiceWithOrderStatus } from './invoiceEngine';
import { deductStockForOrder, restoreStockForOrder } from './inventoryEngine';

export function playAlertSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.15);
    
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      osc2.connect(gainNode);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.25);
    }, 150);
  } catch (error) {
    console.error('Audio Context blocked or failed', error);
  }
}

export async function convertLeadToOrder(leadId: number, sourceModule: 'lead' | 'followup', agentName: string = 'Admin') {
  try {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new Error('Lead not found');

    const customer = await db.customers.get(lead.customerId);
    if (!customer) throw new Error('Customer not found');

    const existingOrder = await db.orders.where('leadId').equals(leadId).first();
    if (!existingOrder) {
      const orderId = `ORD-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 900 + 100)}`;
      
      const newOrderId = await db.orders.add({
        orderId,
        leadId,
        customerId: lead.customerId,
        product: lead.product,
        qty: 1,
        codAmount: lead.expectedAmount,
        status: 'Order Booked',
        orderDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Update lead status
      await db.leads.update(leadId, {
        status: 'Order Booked',
        updatedAt: new Date().toISOString()
      });

      // Update customer central status
      await db.customers.update(lead.customerId, {
        totalOrders: (customer.totalOrders || 0) + 1,
        lastOrderDate: new Date().toISOString(),
        currentStatus: 'Order Booked',
        updatedAt: new Date().toISOString()
      });

      // Save Timeline Event
      await db.timelineLogs.add({
        customerId: lead.customerId,
        entityType: 'Order',
        entityId: newOrderId,
        action: sourceModule === 'followup' ? 'Follow-up converted to Order' : 'Lead converted to Order Booked',
        notes: `Order ${orderId} auto-booked for product: ${lead.product} (₹${lead.expectedAmount}). Source Module: ${sourceModule}.`,
        agentName,
        createdAt: new Date().toISOString()
      });

      // Auto-generate GST invoice for new order
      try {
        await autoGenerateInvoice(newOrderId, agentName);
      } catch (e) {
        console.error('[Workflow] Invoice auto-generation skipped:', e);
      }

      // Deduct stock for booked order (if product matches inventory)
      try {
        await deductStockForOrder(newOrderId, lead.product, 1);
      } catch (e) {
        console.error('[Workflow] Stock deduction skipped:', e);
      }

      // New order notification
      await db.notifications.add({
        title: 'New Order Booked',
        message: `Order ${orderId} for ${customer?.name || lead.product} — ₹${lead.expectedAmount}`,
        type: 'info', isRead: false, createdAt: new Date().toISOString()
      });

      toast.success(`Order ${orderId} created successfully!`);
    } else {
      toast.error('Order already exists for this lead');
    }
  } catch (error) {
    console.error('Failed to convert lead to order:', error);
    toast.error('Order creation workflow failed');
  }
}

// ===================================================================
// PRODUCTION DEDUP ENGINE
// ===================================================================

/**
 * PRODUCTION-SAFE: Remove duplicate leads for the SAME customerId.
 * Keeps only the MOST RECENT lead (by ID — auto-increment, highest = newest).
 * 
 * RULES:
 * - Multiple leads for same customerId = BUG — remove duplicates
 * - Keep only the latest lead (descending by auto-increment ID)
 * - Update customer.currentStatus to match the kept lead
 * - Log removal to timeline for full audit trail
 * 
 * SAFETY: Will NEVER delete the lead with the given `protectedLeadId` (if provided).
 * This prevents the dedup from deleting the very lead being updated in processLeadStatusUpdate.
 */
export async function removeDuplicateLeads(
  customerId: number,
  protectedLeadId?: number
): Promise<number> {
  try {
    const allLeadsForCustomer = await db.leads
      .where('customerId').equals(customerId)
      .reverse()  // Most recent (highest ID) first
      .toArray();

    if (allLeadsForCustomer.length <= 1) return 0;

    // Keep the first (most recent), remove the rest
    // If a protectedLeadId is specified, ensure THAT lead is kept instead
    let keepLead = allLeadsForCustomer[0];
    
    // If the most recent lead isn't the protected one, check if protected one exists
    if (protectedLeadId && keepLead.id !== protectedLeadId) {
      const protectedLead = allLeadsForCustomer.find(l => l.id === protectedLeadId);
      if (protectedLead) {
        keepLead = protectedLead;
      }
    }

    const duplicates = allLeadsForCustomer.filter(l => l.id !== keepLead.id);
    let removedCount = 0;

    for (const dup of duplicates) {
      if (dup.id && dup.id !== keepLead.id) {
        // Log removal to timeline before deleting
        await db.timelineLogs.add({
          customerId,
          entityType: 'Lead',
          entityId: dup.id,
          action: 'Duplicate Lead Auto-Removed',
          notes: `Duplicate lead #${dup.id} (status: ${dup.status}) auto-removed. Kept lead #${keepLead.id} (status: ${keepLead.status}).`,
          agentName: 'System',
          createdAt: new Date().toISOString()
        });

        await db.leads.delete(dup.id);
        removedCount++;
        console.warn(`[Dedup] Removed duplicate lead #${dup.id} for customer #${customerId}, kept #${keepLead.id}`);
      }
    }

    if (removedCount > 0) {
      // Sync the kept lead's status to the customer
      await db.customers.update(customerId, {
        currentStatus: keepLead.status,
        updatedAt: new Date().toISOString()
      });
    }

    return removedCount;
  } catch (error) {
    console.error('[Dedup] Failed to remove duplicates for customer', customerId, error);
    return 0;
  }
}

/**
 * PRODUCTION-SAFE: Scans ALL leads and removes duplicates across the entire database.
 * Call once on app startup to clean up any pre-existing duplicate records.
 * Also logs a summary to the console for debugging.
 */
export async function cleanupAllDuplicateLeads(): Promise<number> {
  try {
    const allLeads = await db.leads.toArray();
    const customerLeadMap = new Map<number, typeof allLeads>();

    // Group all leads by customerId
    for (const lead of allLeads) {
      const list = customerLeadMap.get(lead.customerId) || [];
      list.push(lead);
      customerLeadMap.set(lead.customerId, list);
    }

    let totalRemoved = 0;
    for (const [customerId, leads] of customerLeadMap) {
      if (leads.length > 1) {
        // No protected lead during startup cleanup — keep the most recent
        const removed = await removeDuplicateLeads(customerId);
        totalRemoved += removed;
      }
    }

    if (totalRemoved > 0) {
      console.warn(`[Dedup] Startup cleanup removed ${totalRemoved} duplicate lead(s) from ${customerLeadMap.size} customer(s)`);
      
      // Also log system notification for admins
      await db.notifications.add({
        title: '🧹 DB Cleanup: Duplicates Removed',
        message: `${totalRemoved} duplicate lead(s) were automatically detected and removed during startup cleanup.`,
        type: 'info',
        isRead: false,
        createdAt: new Date().toISOString()
      });
    }
    return totalRemoved;
  } catch (error) {
    console.error('[Dedup] Startup cleanup failed:', error);
    return 0;
  }
}

// ===================================================================
// MAIN STATUS UPDATE ENGINE
// ===================================================================

export async function processLeadStatusUpdate(
  leadId: number,
  newStatus: string,
  metadata: {
    followupDate?: string;
    followupTime?: string;
    notes?: string;
    reason?: string;
    agentName?: string;
  } = {}
) {
  const agent = metadata.agentName || 'Admin';
  
  try {
    const lead = await db.leads.get(leadId);
    if (!lead) throw new Error('Lead not found');

    const oldStatus = lead.status;

    // ✋ PRODUCTION SAFETY: Skip if status hasn't actually changed
    if (oldStatus === newStatus) {
      console.warn(`[Workflow] Status unchanged: ${oldStatus} === ${newStatus}, skipping update`);
      return;
    }

    if (newStatus === 'Order Booked' || newStatus === 'Order Confirmed') {
      await convertLeadToOrder(leadId, 'lead', agent);
      // ✋ After conversion, ensure no stale duplicate remains for this customer
      await removeDuplicateLeads(lead.customerId, leadId);
      return;
    }

    // =====================
    // STEP 1: Update Lead Status FIRST
    // IMPORTANT: Update happens BEFORE dedup to ensure the lead being updated
    // is always the one that gets its status changed. Dedup after update
    // only cleans up older duplicates, never the updated lead.
    // =====================
    const leadUpdate: any = { 
      status: newStatus, 
      updatedAt: new Date().toISOString() 
    };

    if (metadata.followupDate) leadUpdate.followupDate = metadata.followupDate;
    if (metadata.followupTime) leadUpdate.followupTime = metadata.followupTime;
    if (metadata.notes) leadUpdate.notes = metadata.notes;
    if (metadata.reason) leadUpdate.notes = `Not Interested Reason: ${metadata.reason}. ${leadUpdate.notes || ''}`;

    await db.leads.update(leadId, leadUpdate);

    // =====================
    // STEP 2: DEDUP SAFETY — After update, clean up any stale duplicates.
    // Protected lead ID ensures this update's lead is NEVER deleted.
    // =====================
    await removeDuplicateLeads(lead.customerId, leadId);

    // 3. Synchronize Customer Central Status
    const customer = await db.customers.get(lead.customerId);
    if (customer) {
      const customerUpdates: any = {
        currentStatus: newStatus,
        updatedAt: new Date().toISOString()
      };
      
      if (newStatus === 'Fake Lead') {
        customerUpdates.riskLevel = 'Fake';
        customerUpdates.fakeCount = (customer.fakeCount || 0) + 1;
      }
      
      await db.customers.update(lead.customerId, customerUpdates);
    }

    // 4. Add Timeline Log
    await db.timelineLogs.add({
      customerId: lead.customerId,
      entityType: 'Lead',
      entityId: leadId,
      action: `Lead Status Change`,
      statusFrom: oldStatus,
      statusTo: newStatus,
      notes: metadata.notes || metadata.reason || `Status updated from ${oldStatus} to ${newStatus}`,
      agentName: agent,
      createdAt: new Date().toISOString()
    });

    // 5. Status Action Logic Automations
    if (newStatus === 'Fake Lead') {
      if (customer) {
        await db.notifications.add({
          title: 'Customer Blacklisted',
          message: `${customer.name} marked as FAKE. Permanent warning active.`,
          type: 'alert',
          isRead: false,
          createdAt: new Date().toISOString()
        });
      }
      toast.error('Customer blacklisted as Fake Lead!');
    }

    else if (newStatus === 'Followup' || newStatus === 'Callback' || newStatus === 'Callback Requested' || newStatus === 'Not Reachable' || newStatus === 'Busy') {
      await db.notifications.add({
        title: `Reminder Scheduled: ${newStatus}`,
        message: `Follow-up set for ${metadata.followupDate || 'N/A'} at ${metadata.followupTime || 'N/A'}.`,
        type: 'info',
        isRead: false,
        createdAt: new Date().toISOString()
      });
      toast.success(`Reminder set successfully`);
    }

    else if (newStatus === 'Interested') {
      toast.success('Lead marked as Interested');
    }

    else if (newStatus === 'Not Interested') {
      toast.success('Saved status as Not Interested');
    }

  } catch (error) {
    console.error('Lead workflow error:', error);
    toast.error('Lead status update failed');
  }
}

export async function syncCentralCustomerStatus(customerId: number, newStatus: any) {
  try {
    const customer = await db.customers.get(customerId);
    if (!customer) return;

    // Update customer central status
    await db.customers.update(customerId, {
      currentStatus: newStatus,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to sync central status', error);
  }
}

/**
 * SpaceL Auto-Notification Engine
 * Checks for overdue follow-ups and creates notifications
 */
export async function checkOverdueSpaceLFollowups() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const leads = await db.leads
      .filter(l => (l.status === 'Followup' || l.status === 'Callback') && (l.followupDate || '') < today)
      .toArray();

    for (const lead of leads) {
      const customer = await db.customers.get(lead.customerId);
      if (!customer) continue;

      const daysOverdue = Math.floor(
        (Date.now() - new Date(lead.followupDate || today).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check if we already sent a notification for this overdue lead today
      const existingNotifs = await db.notifications
        .filter(n => n.message.includes(`Overdue follow-up for ${customer.name}`))
        .toArray();
      
      const hasTodayNotif = existingNotifs.some(n => {
        const notifDate = new Date(n.createdAt).toISOString().split('T')[0];
        return notifDate === today;
      });

      if (!hasTodayNotif) {
        await db.notifications.add({
          title: `⚠️ SpaceL Follow-up Overdue!`,
          message: `Overdue follow-up for ${customer.name} — ${lead.product} (₹${lead.expectedAmount}). ${daysOverdue} days overdue!`,
          type: 'warning',
          isRead: false,
          linkTo: '/followups',
          createdAt: new Date().toISOString(),
        });

        // Mark as missed in spacelFollowups
        await db.spacelFollowups.add({
          leadId: lead.id!,
          customerId: lead.customerId,
          action: 'Missed',
          status: 'missed',
          notes: `Follow-up missed — ${daysOverdue} days overdue`,
          agentName: 'System',
          createdAt: new Date().toISOString(),
        });
      }

      // If overdue more than 7 days, escalate priority
      if (daysOverdue >= 7 && lead.priority !== 'High') {
        await db.leads.update(lead.id!, {
          priority: 'High',
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    console.error('[SpaceL] Overdue check failed:', error);
  }
}

/**
 * Production-safe sync engine.
 * Updates only the SPECIFIC lead associated with a given order to prevent multi-lead corruption.
 * Use this when an order's status changes (from Order Pipeline, Logistics, or NDR).
 *
 * FIX: Counter Over-increment Bug (root cause #1)
 *   - Accepts oldStatus to detect actual transitions
 *   - Only increments delivered/rto/cancelled on FIRST transition TO terminal state
 *   - Decrements when moving AWAY FROM a terminal state (e.g. if status is reverted)
 *   - Never increments on repeated calls to the same status
 */
export async function syncOrderToCentralStatus(orderId: number, newStatus: any, oldStatus: string) {
  try {
    const order = await db.orders.get(orderId);
    if (!order) return;

    // Skip if no actual status change
    if (oldStatus === newStatus) {
      return;
    }

    // Update customer central status
    const currentCust = await db.customers.get(order.customerId);
    const custUpdate: any = {
      currentStatus: newStatus,
      updatedAt: new Date().toISOString()
    };

    // ===== IDEMPOTENT COUNTER UPDATES =====
    // Only increment on first transition TO a terminal status.
    // Decrement when moving AWAY FROM a terminal status.
    // This prevents double-counting when status-change buttons are clicked multiple times.

    // Terminal statuses that track counters
    const TERMINAL_DELIVERED = 'Delivered';
    const TERMINAL_RTO = 'RTO';
    const TERMINAL_CANCELLED = 'Cancelled';

    const wasDelivered = oldStatus === TERMINAL_DELIVERED;
    const wasRTO = oldStatus === TERMINAL_RTO;
    const wasCancelled = oldStatus === TERMINAL_CANCELLED;
    const nowDelivered = newStatus === TERMINAL_DELIVERED;
    const nowRTO = newStatus === TERMINAL_RTO;
    const nowCancelled = newStatus === TERMINAL_CANCELLED;

    // TRANSITIONING TO Delivered (first time only)
    if (nowDelivered && !wasDelivered) {
      custUpdate.delivered = (currentCust?.delivered || 0) + 1;
      custUpdate.totalSpend = (currentCust?.totalSpend || 0) + (order.codAmount || 0);
    }
    // TRANSITIONING AWAY FROM Delivered (revert)
    else if (!nowDelivered && wasDelivered) {
      custUpdate.delivered = Math.max(0, (currentCust?.delivered || 0) - 1);
      custUpdate.totalSpend = Math.max(0, (currentCust?.totalSpend || 0) - (order.codAmount || 0));
    }

    // TRANSITIONING TO RTO (first time only)
    if (nowRTO && !wasRTO) {
      custUpdate.rto = (currentCust?.rto || 0) + 1;
    }
    // TRANSITIONING AWAY FROM RTO (revert)
    else if (!nowRTO && wasRTO) {
      custUpdate.rto = Math.max(0, (currentCust?.rto || 0) - 1);
    }

    // TRANSITIONING TO Cancelled (first time only)
    if (nowCancelled && !wasCancelled) {
      custUpdate.cancelled = (currentCust?.cancelled || 0) + 1;
    }
    // TRANSITIONING AWAY FROM Cancelled (revert)
    else if (!nowCancelled && wasCancelled) {
      custUpdate.cancelled = Math.max(0, (currentCust?.cancelled || 0) - 1);
    }

    await db.customers.update(order.customerId, custUpdate);

    // Update ONLY the specific lead tied to this order (if it exists)
    if (order.leadId && ['Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery', 'Delivered', 'Undelivered', 'RTO', 'Cancelled'].includes(newStatus)) {
      await db.leads.update(order.leadId, {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
    }

    // NDR AUTO-CREATION: If status becomes Undelivered, create NDR case
    if (newStatus === 'Undelivered') {
      const ndrExists = await db.ndrCases.where('orderId').equals(orderId).filter(n => n.status !== 'Resolved').first();
      if (!ndrExists) {
        await db.ndrCases.add({
          orderId,
          customerId: order.customerId,
          reason: 'Customer Not Available', // Default reason
          status: 'Pending',
          attemptCount: 1,
          riskLevel: 'Medium',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        
        await db.notifications.add({
          title: 'New NDR Created',
          message: `Shipment marked as Undelivered. Action required in NDR Panel.`,
          type: 'warning',
          isRead: false,
          createdAt: new Date().toISOString()
        });
      }
    }

    // INVOICE WORKFLOW: Sync existing invoice with order status.
    // IMPORTANT: autoGenerateInvoice is NOT called here — invoices are created
    // when the order is first created (in convertLeadToOrder / handleSyncLeadToOrder).
    // Calling autoGenerateInvoice on every status change causes:
    //   - Payment fields being overwritten
    //   - Race condition duplicates
    //   - Timeline log spam
    // If an invoice is missing, use the 'Auto-Generate Missing' button on the Invoices page.
    try {
      await syncInvoiceWithOrderStatus(orderId, newStatus);
    } catch (e) {
      console.error('[Workflow] Invoice sync skipped:', e);
    }

    // INVENTORY WORKFLOW: Restore stock on RTO / Cancelled
    if (['RTO', 'Cancelled'].includes(newStatus)) {
      try {
        const reason = newStatus === 'RTO' ? 'RTO_RESTORE' : 'CANCEL_RESTORE';
        await restoreStockForOrder(orderId, order.product, order.qty || 1, reason);
      } catch (e) {
        console.error('[Workflow] Stock restore skipped:', e);
      }
    }
  } catch (error) {
    console.error('Failed to sync order-level status', error);
  }
}
