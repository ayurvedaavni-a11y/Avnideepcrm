// AVNIDEEP CRM PRO — Centralized Lifecycle & Workflow Status Engine
// All CRM modules use this single source of truth for status classification.

export type PipelineStage = 'lead' | 'order' | 'logistics' | 'ndr' | 'terminal';

export interface StatusMeta {
  label: string;
  stage: PipelineStage;
  isActive: boolean;
  isDelivered: boolean;
  isFake: boolean;
  isCancelled: boolean;
  isRTO: boolean;
  isRevenueEligible: boolean;
  isLeadShown: boolean;
  color: 'blue' | 'emerald' | 'amber' | 'red' | 'indigo' | 'slate' | 'orange' | 'purple';
  badgeBg: string;
  badgeText: string;
}

// ===== Master Status Registry =====
// IMPORTANT: isLeadShown controls visibility in Lead Center's "All Pipeline" view.
// Only active pipeline stages should have isLeadShown = true.
// Order Booked, Not Interested, Fake Lead = TERMINAL = isLeadShown = false (never show in All Pipeline)
const STATUS_REGISTRY: Record<string, StatusMeta> = {
  // ---- LEAD STAGE (isLeadShown = true — visible in All Pipeline) ----
  'New Lead': { label: 'New Lead', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'blue', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700' },
  'Interested': { label: 'Interested', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'emerald', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-700' },
  'Callback': { label: 'Callback', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'amber', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700' },
  'Followup': { label: 'Follow-up', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'amber', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700' },
  'Ring': { label: 'Ring', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'purple', badgeBg: 'bg-purple-50', badgeText: 'text-purple-700' },
  'Assigned': { label: 'Assigned', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'blue', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700' },
  'Calling': { label: 'Calling', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'indigo', badgeBg: 'bg-indigo-50', badgeText: 'text-indigo-700' },
  'Callback Requested': { label: 'Callback Requested', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'amber', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700' },
  'Not Reachable': { label: 'Not Reachable', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'orange', badgeBg: 'bg-orange-50', badgeText: 'text-orange-700' },
  'Busy': { label: 'Busy', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: true, color: 'orange', badgeBg: 'bg-orange-50', badgeText: 'text-orange-700' },

  // ---- LEAD STAGE (isLeadShown = false — TERMINAL, NOT shown in All Pipeline) ----
  'Order Booked': { label: 'Order Booked', stage: 'lead', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'indigo', badgeBg: 'bg-indigo-50', badgeText: 'text-indigo-700' },

  // ---- ORDER STAGE ----
  'Packing': { label: 'Packing', stage: 'order', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'amber', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700' },
  'Packed': { label: 'Packed', stage: 'order', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'indigo', badgeBg: 'bg-indigo-50', badgeText: 'text-indigo-700' },
  'Ready To Ship': { label: 'Ready To Ship', stage: 'order', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'blue', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700' },
  'Shipped': { label: 'Shipped', stage: 'order', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'blue', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700' },

  // ---- LOGISTICS STAGE ----
  'In Transit': { label: 'In Transit', stage: 'logistics', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'blue', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700' },
  'Out For Delivery': { label: 'Out For Delivery', stage: 'logistics', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'blue', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700' },

  // ---- TERMINAL: SUCCESS ----
  'Delivered': { label: 'Delivered', stage: 'terminal', isActive: false, isDelivered: true, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: true, isLeadShown: false, color: 'emerald', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700' },

  // ---- TERMINAL: FAILURE ----
  'Undelivered': { label: 'Undelivered', stage: 'ndr', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'orange', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700' },
  'RTO': { label: 'RTO', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: true, isRevenueEligible: false, isLeadShown: false, color: 'red', badgeBg: 'bg-red-100', badgeText: 'text-red-700' },
  'Cancelled': { label: 'Cancelled', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: true, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },

  // ---- TERMINAL: FAKE ----
  'Fake Lead': { label: 'Fake Lead', stage: 'terminal', isActive: false, isDelivered: false, isFake: true, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'red', badgeBg: 'bg-red-100', badgeText: 'text-red-700' },
  'Fake Customer': { label: 'Fake Customer', stage: 'terminal', isActive: false, isDelivered: false, isFake: true, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'red', badgeBg: 'bg-red-100', badgeText: 'text-red-700' },

  // ---- NDR ----
  'NDR Pending': { label: 'NDR Pending', stage: 'ndr', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'orange', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700' },
  'Not Interested': { label: 'Not Interested', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },
  'Order Confirmed': { label: 'Order Confirmed', stage: 'order', isActive: true, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'indigo', badgeBg: 'bg-indigo-50', badgeText: 'text-indigo-700' },
  'Order Cancelled': { label: 'Order Cancelled', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: true, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },
  'Wrong Number': { label: 'Wrong Number', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },
  'Duplicate Lead': { label: 'Duplicate Lead', stage: 'terminal', isActive: false, isDelivered: false, isFake: true, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'red', badgeBg: 'bg-red-100', badgeText: 'text-red-700' },
  'Already Purchased': { label: 'Already Purchased', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },
  'Closed': { label: 'Closed', stage: 'terminal', isActive: false, isDelivered: false, isFake: false, isCancelled: false, isRTO: false, isRevenueEligible: false, isLeadShown: false, color: 'slate', badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },
};

// ===== Status Helper Functions =====

/** Get metadata for a status */
export function getStatusMeta(status: string): StatusMeta {
  return STATUS_REGISTRY[status] || {
    label: status,
    stage: 'terminal',
    isActive: false,
    isDelivered: false,
    isFake: false,
    isCancelled: false,
    isRTO: false,
    isRevenueEligible: false,
    isLeadShown: false,
    color: 'slate',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-600',
  };
}

/** Get all known statuses from the registry */
export function getAllRegisteredStatuses(): string[] {
  return Object.keys(STATUS_REGISTRY);
}

/**
 * Verify that the registry has correct isLeadShown values.
 * Returns array of statuses that have unexpected isLeadShown values.
 * Call this during development/testing to catch configuration errors.
 */
export function verifyStatusRegistry(): { leadStatuses: string[]; nonLeadStatuses: string[] } {
  const activeLeadStatuses = ['New Lead', 'Interested', 'Ring', 'Callback', 'Followup'];
  const terminalLeadStatuses = ['Order Booked', 'Not Interested', 'Fake Lead'];
  
  const errors: string[] = [];

  // Verify active lead statuses have isLeadShown = true
  for (const status of activeLeadStatuses) {
    const meta = STATUS_REGISTRY[status];
    if (!meta) {
      errors.push(`MISSING from registry: ${status}`);
    } else if (meta.isLeadShown !== true) {
      errors.push(`isLeadShown should be true for ${status}, but got ${meta.isLeadShown}`);
    }
  }

  // Verify terminal lead statuses have isLeadShown = false
  for (const status of terminalLeadStatuses) {
    const meta = STATUS_REGISTRY[status];
    if (!meta) {
      errors.push(`MISSING from registry: ${status}`);
    } else if (meta.isLeadShown !== false) {
      errors.push(`isLeadShown should be false for ${status}, but got ${meta.isLeadShown}`);
    }
  }

  if (errors.length > 0) {
    console.error('[Lifecycle] Status Registry validation errors:', errors);
  }

  return {
    leadStatuses: activeLeadStatuses,
    nonLeadStatuses: terminalLeadStatuses,
  };
}

/** Check if a status should be excluded from revenue */
export function isRevenueEligible(status: string): boolean {
  return getStatusMeta(status).isRevenueEligible;
}

/** Check if a status is active in the sales pipeline */
export function isPipelineActive(status: string): boolean {
  return getStatusMeta(status).isActive;
}

/** Check if a status represents a fake customer */
export function isFakeStatus(status: string): boolean {
  return getStatusMeta(status).isFake;
}

/** Check if a status represents a delivered order */
export function isDeliveredStatus(status: string): boolean {
  return getStatusMeta(status).isDelivered;
}

/** Check if a status represents a cancelled order */
export function isCancelledStatus(status: string): boolean {
  return getStatusMeta(status).isCancelled;
}

/** Check if status is RTO */
export function isRTOStatus(status: string): boolean {
  return getStatusMeta(status).isRTO;
}

/** Check if status should be shown in Lead Center (active pipeline) */
export function isLeadShown(status: string): boolean {
  return getStatusMeta(status).isLeadShown;
}

/** Get consolidated lifecycle stage */
export function getLifecycleStage(status: string): PipelineStage {
  return getStatusMeta(status).stage;
}

/** Get CSS classes for status badge */
export function getBadgeClasses(status: string): string {
  const m = getStatusMeta(status);
  return `${m.badgeBg} ${m.badgeText}`;
}

// ===== Lead Status Permissions =====
// TELECALLER_STATUSES = the ONLY statuses a telecaller may set (UI + API).
// Product spec: New Lead, Calling, Ring, Busy, Interested, Follow-up,
// Not Interested, Order Booked. 'Followup' is the canonical stored value
// (used across workflow/types/importParser); the DISPLAYED label is
// 'Follow-up' via statusLabel(). Everything else (Fake Lead, Duplicate,
// NDR, fulfilment statuses, …) is admin-only.
export const TELECALLER_STATUSES: readonly string[] = [
  'New Lead', 'Calling', 'Ring', 'Busy', 'Interested', 'Followup',
  'Not Interested', 'Order Booked',
];

/** Display labels for telecaller statuses (stored value stays canonical). */
export const TELECALLER_STATUS_LABELS: Record<string, string> = {
  Followup: 'Follow-up',
};

/** User-facing label for a status (falls back to the raw value). */
export function statusLabel(status: string): string {
  return TELECALLER_STATUS_LABELS[status] || status;
}

/** Admin status list — the full lead workflow, unaffected by telecaller restrictions. */
export const ADMIN_STATUSES: readonly string[] = [
  'New Lead', 'Assigned', 'Calling', 'Interested', 'Followup', 'Callback Requested',
  'Not Reachable', 'Busy', 'Order Confirmed', 'Order Cancelled', 'Wrong Number',
  'Duplicate Lead', 'Already Purchased', 'Delivered', 'RTO', 'Closed',
  'Order Booked', 'Not Interested', 'Fake Lead', 'Ring',
];
