// src/db/assignmentEngine.ts — Lead assignment + call logging for telecallers.
// Assignment rules:
//  - assignLead / bulkAssignLeads: never assign a lead twice (no duplicates).
//  - reassignLead: moves a lead to another telecaller.
//  - removeAssignment: returns the lead to the unassigned pool.
//  - logCall: appends to callLogs (full call history, never overwritten) and
//    appends notes to lead.notes so previous notes are always preserved.
import { db } from './db';
import { processLeadStatusUpdate } from './workflow';

export interface Assignee {
  id: string;
  full_name: string;
  mobile?: string;
  role?: string;
}

export interface CallLogInput {
  leadId: number;
  telecallerId?: string;
  telecallerName: string;
  status: string;
  notes?: string;
  followupDate?: string;
  followupTime?: string;
  reminderDate?: string;
  reminderTime?: string;
  reminderReason?: string;
}

export interface CallLogResult {
  id?: number;
  leadId: number;
  customerId?: number;
  telecallerId?: string;
  telecallerName: string;
  status: string;
  notes: string;
  followupDate?: string;
  followupTime?: string;
  reminderDate?: string;
  reminderTime?: string;
  reminderReason?: string;
  createdAt: string;
}

/** Assign (or move) a single lead to a telecaller. New Leads auto-promote to 'Assigned'. */
export async function assignLead(leadId: number, assignee: Assignee): Promise<void> {
  const lead = await db.leads.get(leadId);
  if (!lead) throw new Error('Lead not found');
  if (!assignee || !assignee.id) throw new Error('Invalid telecaller');
  const now = new Date().toISOString();
  const wasAssigned = !!lead.assignedTo;

  const updates: Record<string, any> = {
    assignedTo: assignee.id,
    assignedAgent: assignee.full_name,
    updatedAt: now,
  };
  if (!lead.assignedAt) updates.assignedAt = now;
  if (lead.status === 'New Lead') updates.status = 'Assigned';

  await db.leads.update(leadId, updates);

  // Keep customer central status in sync
  const customer = await db.customers.get(lead.customerId);
  if (customer) {
    await db.customers.update(lead.customerId, {
      currentStatus: (updates.status || lead.status) as any,
      updatedAt: now,
    });
  }

  await db.timelineLogs.add({
    customerId: lead.customerId,
    entityType: 'Lead',
    entityId: leadId,
    action: wasAssigned ? 'Lead Reassigned' : 'Lead Assigned',
    notes: wasAssigned
      ? `Reassigned from ${lead.assignedAgent || 'unassigned'} to ${assignee.full_name}.`
      : `Lead assigned to ${assignee.full_name}.`,
    agentName: assignee.full_name,
    createdAt: now,
  });
}

/** Bulk-assign many leads. Leads already assigned are skipped unless reassign=true. */
export async function bulkAssignLeads(
  leadIds: number[],
  assignee: Assignee,
  opts?: { reassign?: boolean }
): Promise<{ assigned: number; skipped: number }> {
  let assigned = 0;
  let skipped = 0;
  for (const id of leadIds) {
    try {
      const lead = await db.leads.get(id);
      if (!lead) { skipped++; continue; }
      if (lead.assignedTo && !opts?.reassign) { skipped++; continue; }
      await assignLead(id, assignee);
      assigned++;
    } catch {
      skipped++;
    }
  }
  return { assigned, skipped };
}

/** Reassign a lead to a different telecaller. */
export async function reassignLead(leadId: number, assignee: Assignee): Promise<void> {
  return assignLead(leadId, assignee);
}

/** Remove assignment — lead returns to the unassigned pool. */
export async function removeAssignment(leadId: number): Promise<void> {
  const lead = await db.leads.get(leadId);
  if (!lead) throw new Error('Lead not found');
  const now = new Date().toISOString();
  const nextStatus: any = lead.status === 'Assigned' ? 'New Lead' : lead.status;

  await db.leads.update(leadId, {
    assignedTo: '',
    assignedAgent: '',
    status: nextStatus,
    updatedAt: now,
  });

  const customer = await db.customers.get(lead.customerId);
  if (customer) {
    await db.customers.update(lead.customerId, { currentStatus: nextStatus, updatedAt: now });
  }

  await db.timelineLogs.add({
    customerId: lead.customerId,
    entityType: 'Lead',
    entityId: leadId,
    action: 'Assignment Removed',
    notes: `Removed from ${lead.assignedAgent || 'unassigned'}. Lead is back in the pool.`,
    agentName: 'Admin',
    createdAt: now,
  });
}

/**
 * Log a telecaller call: records status + notes + follow-up + reminder,
 * appends to call history (never overwrites), updates lead counters and
 * keeps notes history by appending.
 */
export async function logCall(input: CallLogInput): Promise<CallLogResult> {
  const lead = await db.leads.get(input.leadId);
  if (!lead) throw new Error('Lead not found');
  const now = new Date().toISOString();
  const note = (input.notes || '').trim();
  const statusChanged = !!input.status && input.status !== lead.status;
  let finalStatus: string = lead.status;

  if (statusChanged) {
    await processLeadStatusUpdate(input.leadId, input.status, {
      followupDate: input.followupDate || lead.followupDate,
      followupTime: input.followupTime || lead.followupTime,
      notes: note || `Status changed to ${input.status}`,
      agentName: input.telecallerName,
    });
    const updated = await db.leads.get(input.leadId);
    finalStatus = updated?.status || input.status;
  }

  // Append to notes — NEVER overwrite previous notes
  const noteLine = `[${now}] ${input.telecallerName}: ${note || `Status → ${finalStatus}`}`;
  const appendedNotes = lead.notes ? `${lead.notes}\n${noteLine}` : noteLine;

  const leadUpdate: Record<string, any> = {
    callCount: (lead.callCount || 0) + 1,
    lastCallAt: now,
    firstCallAt: lead.firstCallAt || now,
    notes: appendedNotes,
    updatedAt: now,
  };
  if (input.followupDate) {
    leadUpdate.followupDate = input.followupDate;
    leadUpdate.followupTime = input.followupTime || '';
  }
  if (input.reminderDate) {
    leadUpdate.reminderDate = input.reminderDate;
    leadUpdate.reminderTime = input.reminderTime || '';
    leadUpdate.reminderReason = input.reminderReason || '';
  }
  await db.leads.update(input.leadId, leadUpdate);

  const entry: CallLogResult = {
    leadId: input.leadId,
    customerId: lead.customerId,
    telecallerId: input.telecallerId,
    telecallerName: input.telecallerName,
    status: input.status || finalStatus,
    notes: note || `Status → ${finalStatus}`,
    followupDate: input.followupDate,
    followupTime: input.followupTime,
    reminderDate: input.reminderDate,
    reminderTime: input.reminderTime,
    reminderReason: input.reminderReason,
    createdAt: now,
  };
  entry.id = await db.callLogs.add(entry);

  await db.timelineLogs.add({
    customerId: lead.customerId,
    entityType: 'Lead',
    entityId: input.leadId,
    action: 'Call Logged',
    notes: `${input.telecallerName} called. Status: ${finalStatus}. ${note}`,
    agentName: input.telecallerName,
    createdAt: now,
  });

  return entry;
}
