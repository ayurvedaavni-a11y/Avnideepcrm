// src/db/telecallerStats.ts — Per-telecaller performance statistics.
import { db } from './db';
import { listTeamMembers } from './auth';

export const CONVERTED_STATUSES = [
  'Order Booked', 'Order Confirmed', 'Packing', 'Packed', 'Ready To Ship',
  'Shipped', 'In Transit', 'Out For Delivery', 'Delivered',
];

export const CANCELLED_OUTCOMES = [
  'Order Cancelled', 'Cancelled', 'Not Interested', 'Wrong Number',
  'Duplicate Lead', 'Already Purchased', 'Closed',
];

export const FOLLOWUP_STATUSES = [
  'Followup', 'Callback', 'Callback Requested', 'Not Reachable', 'Busy',
];

export function isConverted(status: string): boolean {
  return CONVERTED_STATUSES.includes(status);
}

export function isCancelledOutcome(status: string): boolean {
  return CANCELLED_OUTCOMES.includes(status);
}

export interface TelecallerStats {
  telecallerId: string;
  telecallerName: string;
  mobile?: string;
  assigned: number;
  calls: number;
  confirmed: number;
  cancelled: number;
  conversionPct: number;
  avgResponseHours: number;
  todayCalls: number;
  pendingFollowups: number;
  activeLeads: number;
}

function todayStr(): string {
  return new Date().toDateString();
}

export async function getTelecallerStats(
  telecallerId: string,
  telecallerName?: string
): Promise<TelecallerStats> {
  const [leads, logs] = await Promise.all([db.leads.toArray(), db.callLogs.toArray()]);
  const myLeads = leads.filter(l => String(l.assignedTo || '') === String(telecallerId) || (telecallerName && String(l.assignedAgent || '') === String(telecallerName)));
  const myLogs = logs.filter(l => l.telecallerId === telecallerId);
  const today = todayStr();

  const confirmed = myLeads.filter(l => isConverted(l.status)).length;
  const cancelled = myLeads.filter(l => isCancelledOutcome(l.status)).length;
  const pendingFollowups = myLeads.filter(
    l => FOLLOWUP_STATUSES.includes(l.status) &&
      (!l.followupDate || l.followupDate <= new Date().toISOString().split('T')[0])
  ).length;
  const activeLeads = myLeads.filter(l => l.status === 'Assigned' || l.status === 'Calling' || l.status === 'New Lead').length;

  // Average response time = firstCallAt - assignedAt (hours)
  let totalHours = 0;
  let respCount = 0;
  for (const l of myLeads) {
    if (l.assignedAt && l.firstCallAt) {
      const diff = new Date(l.firstCallAt).getTime() - new Date(l.assignedAt).getTime();
      if (diff > 0) { totalHours += diff / 3600000; respCount++; }
    }
  }

  return {
    telecallerId,
    telecallerName: telecallerName || telecallerId,
    assigned: myLeads.length,
    calls: myLogs.length,
    confirmed,
    cancelled,
    conversionPct: myLeads.length ? Math.round((confirmed / myLeads.length) * 1000) / 10 : 0,
    avgResponseHours: respCount ? Math.round((totalHours / respCount) * 10) / 10 : 0,
    todayCalls: myLogs.filter(l => new Date(l.createdAt).toDateString() === today).length,
    pendingFollowups,
    activeLeads,
  };
}

export async function getAllTelecallerStats(): Promise<TelecallerStats[]> {
  const members = await listTeamMembers();
  const stats: TelecallerStats[] = [];
  for (const m of members) {
    stats.push(await getTelecallerStats(m.id, m.full_name));
  }
  return stats;
}
