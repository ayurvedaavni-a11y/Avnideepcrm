import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { processLeadStatusUpdate } from '../db/workflow';
import { toast } from 'react-hot-toast';
import Plus from 'lucide-react/dist/esm/icons/plus'
import Eye from 'lucide-react/dist/esm/icons/eye'
import X from 'lucide-react/dist/esm/icons/x'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Copy from 'lucide-react/dist/esm/icons/copy'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import Search from 'lucide-react/dist/esm/icons/search'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import { PincodeInput } from '../components/PincodeInput';
import { VirtualTable, type VirtualTableColumn } from '../components/VirtualTable';
import { useDuplicateCustomerCheck } from '../components/DuplicateCustomerAlert';
import { safeFormat } from '../lib/safeFormat';
import { Customer360Profile } from '../components/Customer360Profile';
import { BookOrderModal } from '../components/BookOrderModal';
import { useDateFilter } from '../context/DateFilterContext';
import { useAuth } from '../context/AuthContext';
import { TELECALLER_STATUSES, ADMIN_STATUSES, statusLabel, isLeadShown } from '../db/lifecycle';
import { assignLead, bulkAssignLeads, removeAssignment } from '../db/assignmentEngine';
import { listTeamMembers } from '../db/auth';
import type { TeamProfile } from '../db/auth';
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import Phone from 'lucide-react/dist/esm/icons/phone'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check'
import { CallLogModal } from '../components/CallLogModal';
import { api } from '../db/apiClient';
import { ModalPortal } from '../components/ModalPortal';

// ===================================================================
// All tab shows EVERY lead (all statuses) so Lead Center totals always
// match Customers / Dashboard / Team counters.

// ===== Pagination Constants =====
const PAGE_SIZE = 50;

// ===== Tab config for cleaner rendering =====
const TABS = [
  { key: 'All' as const, label: 'All Leads' },
  { key: 'New Lead' as const, label: 'New Leads' },
  { key: 'Assigned' as const, label: 'Assigned' },
  { key: 'Calling' as const, label: 'Calling' },
  { key: 'Interested' as const, label: 'Interested' },
  { key: 'Ring' as const, label: 'Ring' },
  { key: 'Followup' as const, label: 'Follow-up / Callback', matchStatuses: ['Followup', 'Callback', 'Callback Requested', 'Not Reachable', 'Busy'] as string[] },
  { key: 'Order Booked' as const, label: 'Order Booked' },
  { key: 'Not Interested' as const, label: 'Not Interested' },
  { key: 'Fake Lead' as const, label: 'Fake Leads' },
  { key: 'Closed' as const, label: 'Closed / Lost', matchStatuses: ['Order Cancelled', 'Wrong Number', 'Duplicate Lead', 'Already Purchased', 'Closed'] as string[] },
] as const;

type TabKey = typeof TABS[number]['key'];

export function LeadCenter() {
  const { profile: authProfile, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const leads = useLiveQuery(() => db.leads.reverse().toArray()) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray()) || [];
  const allOrders = useLiveQuery(() => db.orders.toArray()) || [];
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  // Push notification click → ?openLead=<leadId> deep-link: open the lead's
  // customer 360 profile directly. Consumed once, then the param is removed.
  useEffect(() => {
    const openLead = searchParams.get('openLead');
    if (!openLead) return;
    const leadId = Number(openLead);
    if (!leadId) return;
    (async () => {
      const lead = await db.leads.get(leadId);
      if (lead?.customerId) setSelectedCustomerId(lead.customerId);
    })();
    const next = new URLSearchParams(searchParams);
    next.delete('openLead');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mobileSearch, setMobileSearch] = useState('');
  const [callLogLead, setCallLogLead] = useState<{ lead: any; customer: any } | null>(null);
  const [bulkAssignLead, setBulkAssignLead] = useState<{ leadIds: number[] } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [telecallers, setTelecallers] = useState<TeamProfile[]>([]);
  const [filterTelecaller, setFilterTelecaller] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProduct, setFilterProduct] = useState('');

  useEffect(() => {
    // TASK 6: dropdown (assign / bulk-assign / filter) shows ONLY active
    // telecallers — deleted, inactive/blocked users and admins never appear.
    if (isAdmin) {
      listTeamMembers()
        .then(list => setTelecallers(list.filter(t => t.is_active && t.role === 'telecaller')))
        .catch(() => {});
    }
  }, [isAdmin]);

  // TELECALLER ISOLATION: non-admin users see ONLY their own ACTIVE pipeline
  // leads. isLeadShown=false statuses (Order Booked, Delivered, RTO,
  // Cancelled, Not Interested, Fake Lead, ...) automatically leave Lead Center
  // — their history stays in My Orders + Performance. Counts stay consistent
  // because every tab/count derives from this same dataset.
  const visibleLeads = useMemo(() => {
    if (isAdmin || !authProfile?.id) return leads;
    // Type-safe: assignedTo comes from cloud as string (e.g. "26") while
    // authProfile.id is a number (26) - strict === used to hide leads.
    const myId = String(authProfile.id);
    const myName = authProfile.full_name || '';
    return leads.filter(l =>
      (String(l.assignedTo || '') === myId || String(l.assignedAgent || '') === myName) &&
      isLeadShown(l.status)
    );
  }, [leads, isAdmin, authProfile]);

  // Filters & Pagination state
  const [activeTab, setActiveTab] = useState<TabKey>('All');
  const [page, setPage] = useState(0);

  // Modals state
  const [followupModalLead, setFollowupModalLead] = useState<any>(null);
  const [notInterestedModalLead, setNotInterestedModalLead] = useState<any>(null);
  const [bookOrderLead, setBookOrderLead] = useState<any>(null);

  const handleStatusChange = useCallback(async (lead: any, customerId: number, newStatus: any) => {
    try {
      if (newStatus === 'Followup' || newStatus === 'Callback' || newStatus === 'Callback Requested' || newStatus === 'Not Reachable' || newStatus === 'Busy') {
        setFollowupModalLead({ ...lead, newStatus, customerId });
        return;
      }
      if (newStatus === 'Not Interested') {
        setNotInterestedModalLead({ ...lead, newStatus, customerId });
        return;
      }
      if (newStatus === 'Order Booked') {
        setBookOrderLead({ ...lead, customerId });
        return;
      }
      await processLeadStatusUpdate(lead.id, newStatus);
    } catch (error) {
      toast.error('Failed to change status');
    }
  }, []);

  // ===================================================================
  // OPTIMIZATION: Pre-build customerMap ONCE instead of per-row useLiveQuery
  // ===================================================================
  const customerMap = useMemo(() => {
    const map = new Map<number, typeof allCustomers[0]>();
    allCustomers.forEach(c => { if (c.id) map.set(c.id, c); });
    return map;
  }, [allCustomers]);

  // ===================================================================
  // OPTIMIZATION: Deduplicated leads Map
  // ===================================================================
  const dedupedLeads = useMemo(() => {
    const leadMap = new Map<number, typeof leads[0]>();
    for (const lead of visibleLeads) {
      const existing = leadMap.get(lead.id!);
      if (!existing || (lead.id! > existing.id!)) {
        leadMap.set(lead.id!, lead);
      }
    }
    return Array.from(leadMap.values());
  }, [visibleLeads]);

  // Resolve LOCAL lead ids -> CLOUD ids before any server-side delete.
  // Local Dexie ids and D1 ids can diverge (offline creates, bulk imports,
  // resets) — deleting with the wrong id would wipe a DIFFERENT lead's row.
  const resolveCloudIds = async (localIds: number[]): Promise<number[]> => {
    const out: number[] = [];
    for (const id of localIds) {
      const m = await db.syncMap.where('[localTable+localId]').equals(['leads', id]).first();
      if (m?.cloudId) out.push(m.cloudId);
    }
    return out;
  };

  // Build mobile count map for duplicate detection
  const mobileCountMap = useMemo(() => {
    const countMap = new Map<string, number>();
    dedupedLeads.forEach(lead => {
      const customer = customerMap.get(lead.customerId);
      if (customer?.mobile) {
        countMap.set(customer.mobile, (countMap.get(customer.mobile) || 0) + 1);
      }
    });
    return countMap;
  }, [dedupedLeads, customerMap]);

  const { filterByDate } = useDateFilter();

  // Date-filtered deduped leads
  const dateFilteredDeduped = useMemo(() => {
    return filterByDate(dedupedLeads, 'createdAt');
  }, [dedupedLeads, filterByDate]);

  // OPTIMIZATION: Pre-compute tab counts ONCE from date-filtered data
  const tabCounts = useMemo(() => {
    // 'All' counts EVERY lead — totals must match Customers / Dashboard / Team.
    const counts: Record<string, number> = { 'All': dateFilteredDeduped.length };
    for (const tab of TABS) {
      if (tab.key === 'All') continue;
      const statuses = (tab as any)?.matchStatuses || [tab.key as string];
      counts[tab.key] = dateFilteredDeduped.filter(l => statuses.includes(l.status)).length;
    }
    return counts as Record<TabKey, number>;
  }, [dateFilteredDeduped]);

  // Reset to page 0 when tab or search changes
  const resetPagination = useCallback(() => setPage(0), []);

  // Filtered leads for display
  const filteredLeads = useMemo(() => {
    let filtered = dateFilteredDeduped;

    if (activeTab !== 'All') {
      const tab = TABS.find(t => t.key === activeTab);
      const statuses = (tab as any)?.matchStatuses || [activeTab as string];
      filtered = filtered.filter(lead => statuses.includes(lead.status));
    }

    // Search: customer name / mobile / lead id / order id
    const term = mobileSearch.trim().toLowerCase();
    if (term) {
      const orderLeadIds = term.includes('ord')
        ? new Set(allOrders.filter(o => (o.orderId || '').toLowerCase().includes(term)).map(o => o.leadId).filter(Boolean))
        : new Set<number>();
      filtered = filtered.filter(lead => {
        const customer = customerMap.get(lead.customerId);
        if (customer?.name?.toLowerCase().includes(term)) return true;
        if (customer?.mobile?.includes(term)) return true;
        if (String(lead.id).includes(term)) return true;
        if (orderLeadIds.has(lead.id!)) return true;
        return false;
      });
    }

    // Extra filters: telecaller / state / status / product
    if (filterTelecaller) {
      filtered = filtered.filter(lead => String(lead.assignedTo || '') === String(filterTelecaller) || String(lead.assignedAgent || '') === String(filterTelecaller));
    }
    if (filterState) {
      filtered = filtered.filter(lead => {
        const c = customerMap.get(lead.customerId);
        return c?.state === filterState;
      });
    }
    if (filterStatus) {
      filtered = filtered.filter(lead => lead.status === filterStatus);
    }
    if (filterProduct) {
      filtered = filtered.filter(lead => (lead.product || '').toLowerCase().includes(filterProduct.toLowerCase()));
    }

    return filtered;
  }, [dateFilteredDeduped, activeTab, mobileSearch, customerMap, allOrders, filterTelecaller, filterState, filterStatus, filterProduct]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedLeads = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filteredLeads.slice(start, start + PAGE_SIZE);
  }, [filteredLeads, safePage]);

  // ---------- Bulk selection (page-scoped Select All + cross-page Set) ----------
  // The Set persists across pages (multi-page bulk selection supported), but the
  // header checkbox is ALWAYS computed from the CURRENT page's visible leads — so
  // navigating pages never incorrectly shows "all selected".
  const pageLeadIds = useMemo(
    () => paginatedLeads.map(l => l.id).filter((id): id is number => typeof id === 'number'),
    [paginatedLeads]
  );
  const selectedOnPage = pageLeadIds.filter(id => selectedIds.has(id)).length;
  const allPageSelected = pageLeadIds.length > 0 && selectedOnPage === pageLeadIds.length;
  const somePageSelected = selectedOnPage > 0 && !allPageSelected;
  const toggleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of pageLeadIds) {
        if (checked) next.add(id); else next.delete(id);
      }
      return next;
    });
  }, [pageLeadIds]);
  // Bulk status / delete confirmation state (modal-driven, never window.confirm)
  const [bulkStatusLead, setBulkStatusLead] = useState<{ leadIds: number[] } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ leadIds: number[] } | null>(null);

  // Statuses that can be bulk-applied DIRECTLY — anything requiring a followup
  // modal (Followup/Callback/Busy/…), a reason (Not Interested) or order
  // conversion (Order Booked/Confirmed) is excluded to avoid data loss.
  const bulkStatuses = useMemo(() => {
    const excluded = new Set(['Followup', 'Callback', 'Callback Requested', 'Not Reachable', 'Busy', 'Not Interested', 'Order Booked', 'Order Confirmed']);
    return (isAdmin ? ADMIN_STATUSES : TELECALLER_STATUSES).filter(s => !excluded.has(s));
  }, [isAdmin]);

  // ---------- shared row handlers (desktop columns + mobile cards) ----------
  // Single source of truth so desktop and mobile behavior can never diverge.
  const handlePriorityChange = useCallback(async (lead: any, newPriority: string) => {
    await db.leads.update(lead.id!, { priority: newPriority as any, updatedAt: new Date().toISOString() });
    await db.timelineLogs.add({
      customerId: lead.customerId, entityType: 'Lead', entityId: lead.id,
      action: 'Priority updated to ' + newPriority,
      notes: 'Priority changed from ' + (lead.priority || 'None') + ' to ' + newPriority,
      agentName: 'Admin', createdAt: new Date().toISOString(),
    });
    toast.success('Priority updated to ' + newPriority);
  }, []);

  const handleAssign = useCallback(async (lead: any, val: string) => {
    try {
      if (!val) {
        await removeAssignment(lead.id);
        toast.success('Assignment removed - lead back to the pool');
      } else {
        const tc = telecallers.find(t => t.id === val);
        if (tc) {
          await assignLead(lead.id, tc);
          toast.success('Assigned to ' + tc.full_name);
        }
      }
    } catch (err: any) {
      toast.error('Assignment failed: ' + (err?.message || 'Unknown error'));
    }
  }, [telecallers]);

  // Single delete → opens the shared confirmation modal (never window.confirm)
  const handleDeleteLead = useCallback((lead: any) => {
    setDeleteConfirm({ leadIds: [lead.id] });
  }, []);

  // Runs after the confirm modal — single OR bulk delete (admin-only UI + the
  // worker enforces admin-only server-side, see /api/sync/delete-bulk 403).
  const handleConfirmedDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.leadIds;
    setDeleteConfirm(null);
    try {
      const cloudIds = await resolveCloudIds(ids);
      const r = cloudIds.length ? await api.deleteBulk('leads', cloudIds) : { deleted: 0 };
      for (const id of ids) await db.leads.delete(id);
      toast.success((r?.deleted ?? ids.length) + ' lead(s) deleted');
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch (err: any) {
      toast.error('Delete failed: ' + (err?.message || 'Unknown error'));
    }
  }, [deleteConfirm]);

  // Bulk status change — applies a direct-safe status to every selected lead.
  const handleBulkStatus = useCallback(async (newStatus: string) => {
    const ids = Array.from(selectedIds);
    setBulkStatusLead(null);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await processLeadStatusUpdate(id, newStatus, { agentName: authProfile?.full_name || 'Admin' });
        ok++;
      } catch { fail++; }
    }
    toast.success(`${ok} lead(s) → ${statusLabel(newStatus)}` + (fail ? `, ${fail} failed` : ''));
    setSelectedIds(new Set());
  }, [selectedIds, authProfile]);

  // VirtualTable column definitions
  const leadColumns: VirtualTableColumn<any>[] = useMemo(() => {
    return [
      {
        key: 'select',
        header: (
          <SelectAllCheckbox
            checked={allPageSelected}
            indeterminate={somePageSelected}
            onChange={toggleSelectAll}
          />
        ),
        width: '44px',
        align: 'center',
        render: (lead: any) => (
          <input
            type="checkbox"
            checked={selectedIds.has(lead.id)}
            onChange={(e) => {
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (e.target.checked) next.add(lead.id); else next.delete(lead.id);
                return next;
              });
            }}
            aria-label={`Select lead ${lead.id}`}
            className="w-4 h-4 accent-blue-600"
          />
        )
      },
      {
        key: 'customer',
        header: 'Customer',
        width: '180px',
        render: (lead: any) => {
          const customer = customerMap.get(lead.customerId);
          if (!customer) return <span className="text-slate-400">Unknown</span>;
          return (
            <div>
              <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(lead.customerId)}>{customer.name}</div>
              <div className="text-sm text-slate-500 font-medium">{customer.mobile}</div>
              {customer.riskLevel === 'Fake' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                  <AlertTriangle size={10} /> WARNING: Customer marked fake before
                </span>
              )}
            </div>
          );
        }
      },
      {
        key: 'product',
        header: 'Product',
        width: '120px',
        render: (lead: any) => <span className="text-slate-700 font-medium">{lead.product}</span>
      },
      {
        key: 'priority',
        header: 'Priority',
        width: '130px',
        render: (lead: any) => (
          <select
            value={lead.priority || 'Medium'}
            onChange={(e) => handlePriorityChange(lead, e.target.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold outline-none border border-slate-200 cursor-pointer shadow-sm
              ${lead.priority === 'High' ? 'bg-red-50 text-red-700 border-red-200' : ''}
              ${lead.priority === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
              ${lead.priority === 'Low' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}
              ${!lead.priority ? 'bg-slate-50 text-slate-600 border-slate-300' : ''}
            `}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        )
      },
      {
        key: 'status',
        header: 'CRM Workflow Status',
        width: '170px',
        render: (lead: any) => (
          <select
            value={lead.status}
            onChange={(e) => handleStatusChange(lead, lead.customerId, e.target.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold outline-none border border-slate-200 cursor-pointer shadow-sm
              ${lead.status === 'New Lead' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}
              ${lead.status === 'Interested' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
              ${lead.status === 'Ring' ? 'bg-purple-50 text-purple-700 border-purple-200' : ''}
              ${lead.status === 'Followup' || lead.status === 'Callback' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
              ${lead.status === 'Order Booked' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : ''}
              ${lead.status === 'Not Interested' ? 'bg-slate-100 text-slate-600 border-slate-300' : ''}
              ${lead.status === 'Fake Lead' ? 'bg-red-50 text-red-700 border-red-200' : ''}
            `}
          >
            {(isAdmin ? ADMIN_STATUSES : TELECALLER_STATUSES).map(st => (
              <option key={st} value={st}>{statusLabel(st)}</option>
            ))}
          </select>
        )
      },
      {
        key: 'assignedTo',
        header: 'Assigned To',
        width: '170px',
        render: (lead: any) => {
          if (!isAdmin) {
            return <span className="text-xs font-bold text-slate-600">{lead.assignedAgent || '—'}</span>;
          }
          return (
            <select
              value={lead.assignedTo || ''}
              onChange={(e) => handleAssign(lead, e.target.value)}
              className="px-2 py-1.5 rounded-lg text-xs font-bold outline-none border border-slate-200 cursor-pointer shadow-sm bg-slate-50 text-slate-700 w-full"
            >
              <option value="">— Unassigned —</option>
              {telecallers.map(t => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
          );
        }
      },
      {
        key: 'quickActions',
        header: 'Quick Actions',
        width: '200px',
        align: 'center',
        render: (lead: any) => {
          const customer = customerMap.get(lead.customerId);
          const mobile = customer?.mobile;
          if (!mobile) return <span className="text-slate-300 text-xs">-</span>;
          return (
            <div className="flex items-center justify-center gap-1.5">
              <a href={`tel:${mobile}`} title="Direct Call"
                className="p-2 rounded-lg text-white bg-green-600 hover:bg-green-700 shadow-sm transition"
                onClick={(e) => e.stopPropagation()}>
                <Phone size={15} />
              </a>
              <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" title="WhatsApp"
                className="p-2 rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition"
                onClick={(e) => e.stopPropagation()}>
                <MessageCircle size={15} />
              </a>
              <a href={`sms:+91${mobile}`} title="SMS"
                className="p-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition"
                onClick={(e) => e.stopPropagation()}>
                <MessageSquare size={15} />
              </a>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await navigator.clipboard.writeText(mobile);
                    toast.success('Number copied: ' + mobile);
                  } catch {
                    toast.error('Copy failed');
                  }
                }}
                title="Copy Number"
                className="p-2 rounded-lg text-slate-600 bg-slate-200 hover:bg-slate-300 shadow-sm transition"
              >
                <Copy size={15} />
              </button>
              {isAdmin && (
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDeleteLead(lead); }}
                  title="Delete Lead (admin)"
                  className="p-2 rounded-lg text-white bg-red-600 hover:bg-red-700 shadow-sm transition"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          );
        }
      },
      {
        key: 'callLog',
        header: 'Call Log',
        width: '110px',
        align: 'center',
        render: (lead: any) => (
          <button
            onClick={() => setCallLogLead({ lead, customer: customerMap.get(lead.customerId) })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
            title="Log a call"
          >
            <PhoneCall size={14} /> Log Call
          </button>
        )
      },
      {
        key: 'amount',
        header: 'COD Amount',
        width: '100px',
        render: (lead: any) => <span className="font-bold text-slate-800">₹{lead.expectedAmount}</span>
      },
      {
        key: 'nextContact',
        header: 'Next Contact',
        width: '110px',
        render: (lead: any) => (
          (lead.status === 'Followup' || lead.status === 'Callback') ? (
            <div>
              <span className="font-bold text-amber-600">{lead.followupDate ? safeFormat(lead.followupDate, 'dd MMM') : 'Pending'}</span>
              <div className="text-xs text-slate-400">{lead.followupTime || ''}</div>
            </div>
          ) : <span className="text-slate-400">-</span>
        )
      },
      {
        key: 'duplicate',
        header: 'Duplicate',
        width: '80px',
        align: 'center',
        render: (lead: any) => {
          const customer = customerMap.get(lead.customerId);
          if (!customer) return <span className="text-slate-300 text-xs">-</span>;
          const count = customer.mobile ? (mobileCountMap.get(customer.mobile) || 0) : 0;
          return count > 1 ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold" title={`${count} leads share this mobile number`}>
              <Copy size={12} /> {count}x
            </span>
          ) : <span className="text-slate-300 text-xs">-</span>;
        }
      },
      {
        key: 'timeline',
        header: 'Timeline',
        width: '80px',
        align: 'center',
        render: (lead: any) => (
          <button
            onClick={() => setSelectedCustomerId(lead.customerId)}
            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
            title="View Timeline"
          >
            <Eye size={18} className="mx-auto" />
          </button>
        )
      },
    ];
  }, [customerMap, mobileCountMap, handleStatusChange, isAdmin, telecallers, selectedIds, handlePriorityChange, handleAssign, handleDeleteLead, allPageSelected, somePageSelected, toggleSelectAll]);

  return (
    <div className="space-y-3 sm:space-y-4 animate-in fade-in duration-300">
      {/* Compact page header — title stacks above the action button on mobile */}
      <div className="flex justify-between flex-wrap gap-2 items-center">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Lead Center</h1>
          <p className="text-slate-500 text-xs sm:text-sm hidden sm:block">Manage, filter and convert pipeline opportunities.</p>
        </div>
        <button 
          onClick={() => setIsFormOpen(true)}
          className="bg-blue-600 text-white px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl flex items-center gap-2 hover:bg-blue-700 transition shadow-sm font-semibold text-sm sm:text-base"
        >
          <Plus size={18} /> Add New Lead
        </button>
      </div>

      {/* Tabs Filter Bar — horizontal scroll on mobile, wraps on desktop */}
      <div className="bg-white p-1.5 sm:p-2 rounded-xl border border-slate-200 shadow-sm flex gap-1.5 overflow-x-auto av-scroll-none md:flex-wrap md:overflow-visible">
        {TABS.map(tab => (
          <TabButtonWrapper
            key={tab.key}
            tab={tab}
            count={tabCounts[tab.key]}
            active={activeTab === tab.key}
            onTabChange={setActiveTab}
            onResetPagination={resetPagination}
          />
        ))}
      </div>

      {/* Search + Pagination Controls — stacks on mobile, search full width */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="relative flex-1 sm:max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            id="lead-search"
            name="lead-search"
            type="text"
            aria-label="Search leads"
            autoComplete="search"
            placeholder="Search name, mobile or order ID..."
            value={mobileSearch}
            onChange={(e) => { setMobileSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 text-sm text-slate-500">
          <span className="text-xs sm:text-sm whitespace-nowrap">
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
            {mobileSearch && <span className="text-blue-600 hidden sm:inline"> matching "{mobileSearch}"</span>}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 font-medium text-xs">
                Page {safePage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="p-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filters + Bulk Assign — 2-col grid on mobile, inline flex on desktop */}
      <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-sm grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
        {isAdmin && (
          <select id="lead-filter-telecaller" name="lead-filter-telecaller" aria-label="Filter by telecaller" value={filterTelecaller} onChange={(e) => { setFilterTelecaller(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none w-full sm:w-auto">
            <option value="">All Telecallers</option>
            {telecallers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        )}
        <select id="lead-filter-state" name="lead-filter-state" aria-label="Filter by state" value={filterState} onChange={(e) => { setFilterState(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none w-full sm:w-auto">
          <option value="">All States</option>
          {Array.from(new Set(allCustomers.map(c => c.state).filter(Boolean))).sort().map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <select id="lead-filter-status" name="lead-filter-status" aria-label="Filter by status" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none w-full sm:w-auto">
          <option value="">All Statuses</option>
          {(isAdmin ? ADMIN_STATUSES : TELECALLER_STATUSES).map(st => <option key={st} value={st}>{statusLabel(st)}</option>)}
        </select>
        <input id="lead-filter-product" name="lead-filter-product" aria-label="Filter by product" value={filterProduct} onChange={(e) => { setFilterProduct(e.target.value); setPage(0); }}
          placeholder="Filter by product..." className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none w-full sm:w-44 col-span-2 sm:col-span-1" />
      </div>

      {/* ===== Bulk Selection Action Bar — appears when leads are selected ===== */}
      {selectedIds.size > 0 && (
        <div className="bg-slate-900 text-white rounded-xl px-3.5 py-2.5 shadow-lg flex flex-wrap items-center gap-2 av-fade-in">
          <span className="font-bold text-sm mr-1">
            {selectedIds.size} selected
            {selectedOnPage < selectedIds.size && (
              <span className="text-slate-400 font-medium text-xs ml-1">({selectedOnPage} on this page)</span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            {isAdmin && (
              <button onClick={() => setBulkAssignLead({ leadIds: Array.from(selectedIds) })}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 transition">
                <UserPlus size={14} /> Assign
              </button>
            )}
            <button onClick={() => setBulkStatusLead({ leadIds: Array.from(selectedIds) })}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 transition">
              <BadgeCheck size={14} /> Status
            </button>
            {isAdmin && (
              <button onClick={() => setDeleteConfirm({ leadIds: Array.from(selectedIds) })}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-500 transition">
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-700 transition">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ===== DESKTOP: full-featured virtual table (hidden on mobile) ===== */}
      <div className="hidden md:block">
        <VirtualTable
          data={paginatedLeads}
          height={'max(320px, calc(100dvh - 340px))'}
          estimateSize={72}
          emptyState={
            <div className="flex items-center justify-center py-12 text-slate-500">
              No leads match this filter.
            </div>
          }
          rowClassName={() => 'border-b border-slate-100 hover:bg-slate-50 transition-colors'}
          columns={leadColumns}
        />
      </div>

      {/* ===== MOBILE: thumb-friendly lead cards (desktop table is hidden) ===== */}
      <div className="md:hidden space-y-2.5">
        {paginatedLeads.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm px-3.5 py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <SelectAllCheckbox
                checked={allPageSelected}
                indeterminate={somePageSelected}
                onChange={toggleSelectAll}
              />
              Select all on this page
            </label>
            {selectedIds.size > 0 && (
              <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-blue-600 hover:text-blue-700">
                Clear ({selectedIds.size})
              </button>
            )}
          </div>
        )}
        {paginatedLeads.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-500 bg-white rounded-xl border border-slate-200">
            No leads match this filter.
          </div>
        )}
        {paginatedLeads.map((lead: any) => {
          const customer = customerMap.get(lead.customerId);
          const duplicateCount = customer?.mobile ? (mobileCountMap.get(customer.mobile) || 0) : 0;
          return (
            <MobileLeadCard
              key={lead.id}
              lead={lead}
              customer={customer}
              duplicateCount={duplicateCount}
              isAdmin={isAdmin}
              selected={selectedIds.has(lead.id)}
              telecallers={telecallers}
              onToggleSelect={(checked: boolean) => {
                setSelectedIds(prev => {
                  const next = new Set(prev);
                  if (checked) next.add(lead.id); else next.delete(lead.id);
                  return next;
                });
              }}
              onStatusChange={(s: any) => handleStatusChange(lead, lead.customerId, s)}
              onPriorityChange={(p: string) => handlePriorityChange(lead, p)}
              onAssign={(tcId: string) => handleAssign(lead, tcId)}
              onCallLog={() => setCallLogLead({ lead, customer })}
              onDetails={() => setSelectedCustomerId(lead.customerId)}
              onDelete={() => handleDeleteLead(lead)}
            />
          );
        })}
      </div>

      {/* Pagination bottom bar */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {safePage + 1} of {totalPages} ({filteredLeads.length} total)
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
            disabled={safePage >= totalPages - 1}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {bulkStatusLead && (
        <BulkStatusModal
          count={bulkStatusLead.leadIds.length}
          statuses={bulkStatuses}
          onClose={() => setBulkStatusLead(null)}
          onSave={handleBulkStatus}
        />
      )}

      {deleteConfirm && (
        <ConfirmDeleteModal
          count={deleteConfirm.leadIds.length}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={handleConfirmedDelete}
        />
      )}

      {bulkAssignLead && (
        <BulkAssignModal
          count={bulkAssignLead.leadIds.length}
          telecallers={telecallers}
          onClose={() => setBulkAssignLead(null)}
          onAssign={async (tc: TeamProfile, reassign: boolean) => {
            // Online: assign server-side (creates the assignment notification,
            // survives multi-device, scales to 100k+ leads) + mirror locally.
            // Offline / failure: fall back to the local Dexie assignment engine.
            let res: { assigned: number; skipped: number };
            let usedServer = false;
            if (navigator.onLine) {
              try {
                const r = await api.assignLeads(bulkAssignLead.leadIds, tc.id, tc.full_name, reassign);
                const now = new Date().toISOString();
                // Mirror locally, but match the server's skip rule: without
                // reassign, rows already owned by someone stay untouched so the
                // local DB can never overwrite the server's intended owner.
                for (const id of bulkAssignLead.leadIds) {
                  const l = await db.leads.get(id);
                  const unassigned = !l || !l.assignedTo || l.assignedTo === '' || l.assignedTo === '0';
                  if (!reassign && !unassigned) continue;
                  // Mirror the server's status promotion ('New Lead' → 'Assigned')
                  // so the Assigned tab (status filter) shows it immediately.
                  const nextStatus = (!l || !l.status || l.status === 'New Lead') ? 'Assigned' : l.status;
                  await db.leads.update(id, { assignedTo: tc.id, assignedAgent: tc.full_name, status: nextStatus, updatedAt: now });
                }
                res = { assigned: r.assigned, skipped: bulkAssignLead.leadIds.length - r.assigned };
                usedServer = true;
              } catch {
                res = await bulkAssignLeads(bulkAssignLead.leadIds, tc, { reassign });
              }
            } else {
              res = await bulkAssignLeads(bulkAssignLead.leadIds, tc, { reassign });
            }
            const msg = 'Assigned ' + res.assigned + ' lead(s) to ' + tc.full_name + (res.skipped ? ' (' + res.skipped + ' already assigned)' : '') + (usedServer ? ' • cloud sync' : '');
            toast.success(msg);
            setSelectedIds(new Set());
            setBulkAssignLead(null);
          }}
        />
      )}

      {callLogLead && (
        <CallLogModal lead={callLogLead.lead} customer={callLogLead.customer} onClose={() => setCallLogLead(null)} />
      )}

      {isFormOpen && <LeadForm onClose={() => setIsFormOpen(false)} />}
      
      {selectedCustomerId && (
        <Customer360Profile 
          customerId={selectedCustomerId} 
          isOpen={true} 
          onClose={() => setSelectedCustomerId(null)} 
        />
      )}

      {followupModalLead && (
        <FollowupModal 
          lead={followupModalLead} 
          onClose={() => setFollowupModalLead(null)}
          onSave={async (data: any) => {
            await processLeadStatusUpdate(followupModalLead.id, followupModalLead.newStatus, data);
            setFollowupModalLead(null);
          }}
        />
      )}

      {notInterestedModalLead && (
        <NotInterestedModal 
          lead={notInterestedModalLead} 
          onClose={() => setNotInterestedModalLead(null)}
          onSave={async (reason: string) => {
            await processLeadStatusUpdate(notInterestedModalLead.id, 'Not Interested', { reason });
            setNotInterestedModalLead(null);
          }}
        />
      )}

      {bookOrderLead && (
        <BookOrderModal 
          leadId={bookOrderLead.id} 
          onClose={() => setBookOrderLead(null)} 
        />
      )}
    </div>
  );
}

// ===== Select All checkbox (header + mobile) with indeterminate support =====
function SelectAllCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate; }}
      onChange={(e) => onChange(e.target.checked)}
      aria-label="Select all leads on this page"
      className="w-4 h-4 accent-blue-600"
    />
  );
}

// ===== TabButton (memoized) =====
const TabButton = React.memo(function TabButton({ label, count, active, onClick }: { label: string, count: number, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-bold text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 shrink-0 whitespace-nowrap ${
        active 
          ? 'bg-slate-900 text-white shadow-md' 
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span>{label}</span>
      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${active ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
        {count}
      </span>
    </button>
  );
});

// ===== TabButtonWrapper — useCallback bridges stable props to memo(TabButton) =====
const TabButtonWrapper = React.memo(function TabButtonWrapper({ tab, count, active, onTabChange, onResetPagination }: { 
  tab: { key: string; label: string };
  count: number;
  active: boolean;
  onTabChange: (key: TabKey) => void;
  onResetPagination: () => void;
}) {
  const onClick = React.useCallback(() => {
    onTabChange(tab.key as TabKey);
    onResetPagination();
  }, [tab.key, onTabChange, onResetPagination]);
  
  return <TabButton label={tab.label} count={count} active={active} onClick={onClick} />;
});

// =====================================================================
// MobileLeadCard — thumb-friendly lead card (rendered ONLY on < md screens;
// desktop uses the full VirtualTable). Mirrors MobileOrderCard aesthetics.
// =====================================================================
function MobileLeadCard({ lead, customer, duplicateCount, isAdmin, selected, telecallers, onToggleSelect, onStatusChange, onPriorityChange, onAssign, onCallLog, onDetails, onDelete }: {
  lead: any;
  customer: any;
  duplicateCount: number;
  isAdmin: boolean;
  selected: boolean;
  telecallers: TeamProfile[];
  onToggleSelect: (checked: boolean) => void;
  onStatusChange: (status: any) => void;
  onPriorityChange: (priority: string) => void;
  onAssign: (tcId: string) => Promise<void>;
  onCallLog: () => void;
  onDetails: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const mobile = customer?.mobile;
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden av-fade-in">
      {/* Top: name + mobile + selection (admin) */}
      <div className="px-3.5 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onToggleSelect(e.target.checked)}
              className="w-4 h-4 accent-blue-600 mt-0.5 shrink-0"
              aria-label="Select lead"
            />
            <div className="min-w-0">
              <h4 className="font-bold text-slate-900 text-[15px] leading-tight truncate cursor-pointer hover:text-blue-600" onClick={onDetails}>
                {customer?.name || 'Unknown'}
              </h4>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{customer?.mobile || '—'}</p>
              {customer?.riskLevel === 'Fake' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                  <AlertTriangle size={10} /> Fake
                </span>
              )}
              {duplicateCount > 1 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold">
                  <Copy size={10} /> {duplicateCount}x duplicate
                </span>
              )}
            </div>
          </div>
          {/* Status select — colored like desktop table */}
          <select
            value={lead.status || ''}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label="Change lead status"
            className={`px-2 py-1.5 rounded-lg text-[11px] font-bold outline-none border border-slate-200 cursor-pointer shadow-sm shrink-0 max-w-[130px] ${
              lead.status === 'New Lead' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''
            } ${lead.status === 'Interested' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
              ${lead.status === 'Ring' ? 'bg-purple-50 text-purple-700 border-purple-200' : ''}
              ${lead.status === 'Followup' || lead.status === 'Callback' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
              ${lead.status === 'Order Booked' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : ''}
              ${lead.status === 'Not Interested' ? 'bg-slate-100 text-slate-600 border-slate-300' : ''}
              ${lead.status === 'Fake Lead' ? 'bg-red-50 text-red-700 border-red-200' : ''}`}
          >
            {(isAdmin ? ADMIN_STATUSES : TELECALLER_STATUSES).map(st => (
              <option key={st} value={st}>{statusLabel(st)}</option>
            ))}
          </select>
        </div>

        {/* Product + amount */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <p className="text-[13px] text-slate-600 truncate min-w-0">{lead.product || '—'}</p>
          <span className="font-black text-slate-900 text-sm shrink-0">₹{lead.expectedAmount || 0}</span>
        </div>

        {/* Assigned + priority (admin editable) */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-2">
          {isAdmin ? (
            <select
              value={lead.assignedTo || ''}
              onChange={(e) => onAssign(e.target.value)}
              aria-label="Assign telecaller"
              className="px-2 py-1 rounded-lg text-[10px] font-bold outline-none border border-slate-200 cursor-pointer shadow-sm bg-slate-50 text-slate-700"
            >
              <option value="">— Unassigned —</option>
              {telecallers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
              <UserPlus size={10} /> {lead.assignedAgent || 'Unassigned'}
            </span>
          )}
          <select
            value={lead.priority || 'Medium'}
            onChange={(e) => onPriorityChange(e.target.value)}
            aria-label="Change priority"
            className={`px-2 py-1 rounded-lg text-[10px] font-bold outline-none border border-slate-200 cursor-pointer shadow-sm ${
              lead.priority === 'High' ? 'bg-red-50 text-red-700 border-red-200' : ''
            } ${lead.priority === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
              ${lead.priority === 'Low' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}`}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
          {(lead.status === 'Followup' || lead.status === 'Callback') && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-bold">
              {lead.followupDate ? safeFormat(lead.followupDate, 'dd MMM') : 'Pending'}
              {lead.followupTime ? ` · ${lead.followupTime}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Thumb-friendly action row — Call / WhatsApp / Log Call / Details */}
      <div className="px-3 pb-3 grid grid-cols-4 gap-2">
        <a href={`tel:${mobile}`} aria-disabled={!mobile}
          className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 active:scale-95 transition-transform ${!mobile ? 'pointer-events-none opacity-40' : ''}`}>
          <Phone size={18} />
          <span className="text-[10px] font-bold">Call</span>
        </a>
        <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer"
          className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 active:scale-95 transition-transform ${!mobile ? 'pointer-events-none opacity-40' : ''}`}>
          <MessageCircle size={18} />
          <span className="text-[10px] font-bold">WhatsApp</span>
        </a>
        <button onClick={onCallLog} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 active:scale-95 transition-transform">
          <PhoneCall size={18} />
          <span className="text-[10px] font-bold">Log Call</span>
        </button>
        <button onClick={onDetails} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 active:scale-95 transition-transform">
          <Eye size={18} />
          <span className="text-[10px] font-bold">Details</span>
        </button>
      </div>

      {/* Admin: delete (small, below actions) */}
      {isAdmin && (
        <div className="px-3 pb-2.5 -mt-1 flex justify-end">
          <button onClick={onDelete} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 active:scale-95 transition-transform">
            <Trash2 size={11} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// LeadRow removed — now handled inline in VirtualTable columns

function FollowupModal({ lead, onClose, onSave }: any) {
  const [date, setDate] = useState(lead.followupDate || '');
  const [time, setTime] = useState(lead.followupTime || '');
  const [notes, setNotes] = useState(lead.notes || '');

  const handleSave = () => {
    if (!date) return toast.error('Date is required');
    onSave({ followupDate: date, followupTime: time, notes });
  };

  // Implicit labels (input inside label) — keeps DOM ids unique even though
  // this body is rendered twice (desktop modal + mobile bottom sheet).
  const body = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Date *</span>
          <input type="date" required value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Time *</span>
          <input type="time" required value={time} onChange={e => setTime(e.target.value)} className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
      </div>
      <label className="block text-xs md:text-sm font-medium text-slate-700">
        <span>Agent Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Customer requested to call after 5 PM..." rows={3} className="mt-1 w-full p-3 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
      </label>
    </div>
  );

  return (
        <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
      {/* ===== DESKTOP MODAL ===== */}
      <div className="hidden md:flex bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex-col shadow-2xl av-zoom-in overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Schedule {lead.newStatus}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto av-scroll-thin p-5">{body}</div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-sm text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 rounded-lg font-medium text-sm text-white bg-amber-600 hover:bg-amber-700 transition">Confirm Schedule</button>
        </div>
      </div>

      {/* ===== MOBILE BOTTOM SHEET ===== */}
      <div className="md:hidden bg-white w-full max-h-[85vh] rounded-t-2xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="px-4 pb-3 flex justify-between items-center shrink-0">
          <h2 className="text-base font-bold text-slate-800">Schedule {lead.newStatus}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={18} className="text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto av-scroll-thin px-4 pb-4">{body}</div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-amber-600 hover:bg-amber-700 transition">Confirm Schedule</button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function NotInterestedModal({ onClose, onSave }: any) {
  const [reason, setReason] = useState('');

  const handleSave = () => {
    if (!reason.trim()) return toast.error('Reason is required');
    onSave(reason);
  };

  // Implicit label (control inside label) — keeps DOM ids unique even though
  // this body is rendered twice (desktop modal + mobile bottom sheet).
  const body = (
    <div>
      <label className="block text-xs md:text-sm font-medium text-slate-700">
        <span>Select / Type Reason *</span>
        <select
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        >
          <option value="">-- Choose Preset Reason --</option>
          <option value="Too Expensive">Too Expensive</option>
          <option value="Quality Concern">Quality Concern</option>
          <option value="Bought Elsewhere">Bought Elsewhere</option>
          <option value="No Requirement">No Requirement</option>
          <option value="Other">Other</option>
        </select>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Or type custom reason..."
          rows={2}
          className="w-full p-3 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
    </div>
  );

  return (
        <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
      {/* ===== DESKTOP MODAL ===== */}
      <div className="hidden md:flex bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex-col shadow-2xl av-zoom-in overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Not Interested Reason</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto av-scroll-thin p-5">{body}</div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-sm text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 rounded-lg font-medium text-sm text-white bg-slate-900 hover:bg-slate-800 transition">Save Reason</button>
        </div>
      </div>

      {/* ===== MOBILE BOTTOM SHEET ===== */}
      <div className="md:hidden bg-white w-full max-h-[85vh] rounded-t-2xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="px-4 pb-3 flex justify-between items-center shrink-0">
          <h2 className="text-base font-bold text-slate-800">Not Interested Reason</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={18} className="text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto av-scroll-thin px-4 pb-4">{body}</div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-slate-900 hover:bg-slate-800 transition">Save Reason</button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function BulkAssignModal({ count, telecallers, onClose, onAssign }: {
  count: number;
  telecallers: TeamProfile[];
  onClose: () => void;
  onAssign: (tc: TeamProfile, reassign: boolean) => Promise<void>;
}) {
  const [tcId, setTcId] = useState('');
  const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (!tcId || busy) return;
    const tc = telecallers.find(t => t.id === tcId);
    if (!tc) return;
    setBusy(true);
    try { await onAssign(tc, reassign); } finally { setBusy(false); }
  };
  // Implicit labels (control inside label) — keeps DOM ids unique even though
  // this body is rendered twice (desktop modal + mobile bottom sheet).
  const body = (
    <div className="space-y-4">
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
        <span>Telecaller</span>
        <select value={tcId} onChange={(e) => setTcId(e.target.value)}
          className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          <option value="">Select telecaller…</option>
          {telecallers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
        <input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} className="w-4 h-4 accent-blue-600" />
        <span>Also move already-assigned leads (reassign)</span>
      </label>
    </div>
  );

  return (
        <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
      {/* ===== DESKTOP MODAL ===== */}
      <div className="hidden md:flex bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex-col shadow-2xl av-zoom-in overflow-hidden">
        <div className="p-5 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Bulk Assign {count} Lead{count > 1 ? 's' : ''}</h2>
        </div>
        <div className="flex-1 overflow-y-auto av-scroll-thin p-5">{body}</div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-sm text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handle} disabled={busy || !tcId}
            className="px-5 py-2 rounded-lg font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-60">
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>

      {/* ===== MOBILE BOTTOM SHEET ===== */}
      <div className="md:hidden bg-white w-full max-h-[85vh] rounded-t-2xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="px-4 pb-3 shrink-0">
          <h2 className="text-base font-bold text-slate-800">Bulk Assign {count} Lead{count > 1 ? 's' : ''}</h2>
        </div>
        <div className="flex-1 overflow-y-auto av-scroll-thin px-4 pb-4">{body}</div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition">Cancel</button>
          <button onClick={handle} disabled={busy || !tcId}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-60">
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

// ===== Bulk Status Change modal (direct-safe statuses only, role-filtered) =====
function BulkStatusModal({ count, statuses, onClose, onSave }: {
  count: number;
  statuses: string[];
  onClose: () => void;
  onSave: (status: string) => Promise<void>;
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (!status || busy) return;
    setBusy(true);
    try { await onSave(status); } finally { setBusy(false); }
  };
  const body = (
    <div className="space-y-4">
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
        <span>New Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="mt-1.5 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          <option value="">Select status…</option>
          {statuses.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-400">
        Applied to all {count} selected lead(s). Statuses that need extra info (Follow-up, Not Interested, Order Booked) are excluded from bulk change.
      </p>
    </div>
  );

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
        {/* ===== DESKTOP MODAL ===== */}
        <div className="hidden md:flex bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex-col shadow-2xl av-zoom-in overflow-hidden">
          <div className="p-5 border-b border-slate-100 shrink-0">
            <h2 className="text-lg font-bold text-slate-800">Bulk Status — {count} Lead{count > 1 ? 's' : ''}</h2>
          </div>
          <div className="flex-1 overflow-y-auto av-scroll-thin p-5">{body}</div>
          <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
            <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-sm text-slate-600 hover:bg-slate-200 transition">Cancel</button>
            <button onClick={handle} disabled={busy || !status}
              className="px-5 py-2 rounded-lg font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-60">
              {busy ? 'Updating…' : 'Update Status'}
            </button>
          </div>
        </div>

        {/* ===== MOBILE BOTTOM SHEET ===== */}
        <div className="md:hidden bg-white w-full max-h-[85vh] rounded-t-2xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
          <div className="pt-2.5 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>
          <div className="px-4 pb-3 shrink-0">
            <h2 className="text-base font-bold text-slate-800">Bulk Status — {count} Lead{count > 1 ? 's' : ''}</h2>
          </div>
          <div className="flex-1 overflow-y-auto av-scroll-thin px-4 pb-4">{body}</div>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition">Cancel</button>
            <button onClick={handle} disabled={busy || !status}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-60">
              {busy ? 'Updating…' : 'Update Status'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ===== Delete Confirmation modal — single AND bulk (admin-only actions) =====
function ConfirmDeleteModal({ count, onClose, onConfirm }: {
  count: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  const body = (
    <div className="flex items-start gap-3">
      <div className="p-2.5 rounded-full bg-red-100 text-red-600 shrink-0"><Trash2 size={20} /></div>
      <div>
        <p className="text-sm font-bold text-slate-800">Permanently delete {count} lead{count > 1 ? 's' : ''}?</p>
        <p className="text-xs text-slate-500 mt-1">
          This permanently deletes {count > 1 ? 'these leads' : 'this lead'} from the cloud D1 database too — timeline history, call logs and assignments are removed. This cannot be undone.
        </p>
      </div>
    </div>
  );

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
        {/* ===== DESKTOP MODAL ===== */}
        <div className="hidden md:flex bg-white rounded-2xl w-full max-w-md flex-col shadow-2xl av-zoom-in overflow-hidden">
          <div className="p-5 border-b border-slate-100 shrink-0">
            <h2 className="text-lg font-bold text-slate-800">Confirm Delete</h2>
          </div>
          <div className="flex-1 overflow-y-auto av-scroll-thin p-5">{body}</div>
          <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
            <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-sm text-slate-600 hover:bg-slate-200 transition">Cancel</button>
            <button onClick={handle} disabled={busy}
              className="px-5 py-2 rounded-lg font-bold text-sm text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-60">
              {busy ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>

        {/* ===== MOBILE BOTTOM SHEET ===== */}
        <div className="md:hidden bg-white w-full max-h-[85vh] rounded-t-2xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
          <div className="pt-2.5 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>
          <div className="px-4 pb-3 shrink-0">
            <h2 className="text-base font-bold text-slate-800">Confirm Delete</h2>
          </div>
          <div className="flex-1 overflow-y-auto av-scroll-thin px-4 pb-4">{body}</div>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition">Cancel</button>
            <button onClick={handle} disabled={busy}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-60">
              {busy ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function LeadForm({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useAuth();
  const { profile: authProfile } = useAuth();
  const [formData, setFormData] = useState({
    mobile: '', name: '', alternateNumber: '', address: '', pincode: '', city: '', state: '',
    product: '', source: 'Facebook', expectedAmount: '', priority: 'Medium', status: 'New Lead',
    assignedAgent: authProfile?.full_name || 'Admin', notes: '', followupDate: '', followupTime: ''
  });
  const [isFakeWarning, setIsFakeWarning] = useState(false);
  const { checkForDuplicate, duplicateModal } = useDuplicateCustomerCheck();

  const checkExistingCustomer = async (mobile: string) => {
    if (mobile.length === 10) {
      const existing = await db.customers.where('mobile').equals(mobile).first();
      if (existing) {
        setIsFakeWarning(existing.riskLevel === 'Fake');
        const action = await checkForDuplicate(mobile);
        if (action === 'cancel') {
          setFormData(prev => ({ ...prev, mobile: '' }));
          return;
        }
        setFormData(prev => ({
          ...prev,
          name: existing.name,
          alternateNumber: existing.alternateNumber || '',
          address: existing.address || '',
          pincode: existing.pincode || '',
          city: existing.city || '',
          state: existing.state || ''
        }));
      } else {
        setIsFakeWarning(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let customerId;
      const existing = await db.customers.where('mobile').equals(formData.mobile).first();
      
      if (existing) {
        customerId = existing.id;
        await db.customers.update(existing.id!, {
          name: formData.name, address: formData.address, pincode: formData.pincode,
          city: formData.city, state: formData.state
        });
      } else {
        customerId = await db.customers.add({
          mobile: formData.mobile, name: formData.name, alternateNumber: formData.alternateNumber,
          address: formData.address, pincode: formData.pincode, city: formData.city, state: formData.state,
          totalOrders: 0, delivered: 0, rto: 0, cancelled: 0, fakeCount: 0, totalSpend: 0,
          riskLevel: 'Low', currentStatus: formData.status as any, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        
        await db.timelineLogs.add({
          customerId, entityType: 'Customer', action: 'Customer Profile Created',
          agentName: formData.assignedAgent, createdAt: new Date().toISOString()
        });
      }

      const existingLead = await db.leads.where('customerId').equals(customerId!).first();
      if (existingLead) {
        await db.leads.update(existingLead.id!, {
          product: formData.product, source: formData.source,
          expectedAmount: Number(formData.expectedAmount), priority: formData.priority as any,
          status: formData.status as any, assignedAgent: formData.assignedAgent, notes: formData.notes,
          followupDate: formData.followupDate, followupTime: formData.followupTime,
          updatedAt: new Date().toISOString()
        });
        await db.timelineLogs.add({
          customerId: customerId!, entityType: 'Lead', entityId: existingLead.id,
          action: 'Lead Updated (Duplicate Prevention)', statusTo: formData.status,
          notes: `Existing lead #${existingLead.id} updated instead of creating duplicate. Product: ${formData.product}`,
          agentName: formData.assignedAgent, createdAt: new Date().toISOString()
        });
        toast.success('Existing lead updated successfully!');
        onClose();
        return;
      }

      const leadId = await db.leads.add({
        customerId: customerId!, product: formData.product, source: formData.source,
        expectedAmount: Number(formData.expectedAmount), priority: formData.priority as any,
        status: formData.status as any, assignedAgent: formData.assignedAgent, notes: formData.notes,
        followupDate: formData.followupDate, followupTime: formData.followupTime,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });

      await db.timelineLogs.add({
        customerId: customerId!, entityType: 'Lead', entityId: leadId,
        action: 'Lead Created', statusTo: formData.status, notes: formData.notes,
        agentName: formData.assignedAgent, createdAt: new Date().toISOString()
      });

      if (formData.status !== 'New Lead') {
        await processLeadStatusUpdate(leadId, formData.status as any, {
          followupDate: formData.followupDate, followupTime: formData.followupTime,
          notes: formData.notes, agentName: formData.assignedAgent
        });
      }

      toast.success('Lead created successfully!');
      onClose();
    } catch (error) {
      toast.error('Failed to create lead');
      console.error(error);
    }
  };

  // Shared form fields — rendered once per layout (desktop modal + mobile
  // bottom sheet, only one is visible at a time). All inputs are controlled
  // by the same formData state; idPrefix keeps DOM ids unique per layout so
  // label focus works on both breakpoints.
  const formBody = (idPrefix: string) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* ===== Customer Details ===== */}
      <div className="space-y-3.5">
        <h3 className="font-bold text-slate-700 border-b border-slate-100 pb-2 text-sm md:text-base">Customer Details</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>Mobile Number *</span>
            <input type="tel" inputMode="numeric" maxLength={10} required value={formData.mobile}
              onChange={e => { const v = e.target.value.replace(/\D/g, ''); setFormData({...formData, mobile: v}); checkExistingCustomer(v); }}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </label>
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>Alternate Number</span>
            <input type="tel" inputMode="numeric" maxLength={10} value={formData.alternateNumber}
              onChange={e => setFormData({...formData, alternateNumber: e.target.value.replace(/\D/g, '')})}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
        </div>

        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Full Name *</span>
          <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
            className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>

        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Full Address</span>
          <textarea value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} rows={2}
            className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PincodeInput idPrefix={idPrefix} pincode={formData.pincode} city={formData.city} state={formData.state}
            onChange={(updates: any) => setFormData(prev => ({...prev, ...updates}))} />
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>City</span>
            <input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
        </div>

        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>State</span>
          <input type="text" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})}
            placeholder="Auto-filled from pincode"
            className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
      </div>

      {/* ===== Lead Details ===== */}
      <div className="space-y-3.5">
        <h3 className="font-bold text-slate-700 border-b border-slate-100 pb-2 text-sm md:text-base">Lead Details</h3>

        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Product Interested *</span>
          <input type="text" required value={formData.product} onChange={e => setFormData({...formData, product: e.target.value})}
            className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>Expected Amount *</span>
            <input type="number" required value={formData.expectedAmount} onChange={e => setFormData({...formData, expectedAmount: e.target.value})}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>Status</span>
            <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {(isAdmin ? ADMIN_STATUSES : TELECALLER_STATUSES).map(st => <option key={st} value={st}>{statusLabel(st)}</option>)}
            </select>
          </label>
        </div>

        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Source</span>
          <select value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}
            className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            {['Facebook', 'Instagram', 'WhatsApp', 'Website', 'Referral', 'Cold Call', 'Other'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>Followup Date</span>
            <input type="date" value={formData.followupDate} onChange={e => setFormData({...formData, followupDate: e.target.value})}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label className="block text-xs md:text-sm font-medium text-slate-700">
            <span>Followup Time</span>
            <input type="time" value={formData.followupTime} onChange={e => setFormData({...formData, followupTime: e.target.value})}
              className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
        </div>

        <label className="block text-xs md:text-sm font-medium text-slate-700">
          <span>Notes</span>
          <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} rows={2}
            className="mt-1 w-full p-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
      </div>
    </div>
  );

  return (
    <>
      {duplicateModal}
          <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center">
        {/* ===== DESKTOP MODAL ===== */}
        <div className="hidden md:flex bg-white rounded-2xl w-full max-w-[640px] max-h-[90vh] flex-col shadow-2xl av-zoom-in overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Add New Lead</h2>
              {isFakeWarning && (
                <p className="text-red-600 text-xs font-bold flex items-center gap-1 mt-1 bg-red-50 p-1.5 rounded border border-red-200 animate-pulse">
                  <AlertTriangle size={13} /> WARNING: Customer marked fake before!
                </p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500" /></button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto av-scroll-thin px-6 py-5">{formBody('lead-form-')}</div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-sm text-slate-600 hover:bg-slate-200 transition">Cancel</button>
              <button type="submit" className="px-5 py-2 rounded-lg font-medium text-sm text-white bg-blue-600 hover:bg-blue-700 transition">Save Lead</button>
            </div>
          </form>
        </div>

        {/* ===== MOBILE BOTTOM SHEET ===== */}
        <div className="md:hidden bg-white w-full max-h-[92vh] rounded-t-2xl flex flex-col shadow-2xl av-slide-up overflow-hidden">
          <div className="pt-2.5 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>
          <div className="px-4 pb-3 flex justify-between items-center shrink-0">
            <h2 className="text-base font-bold text-slate-800">Add New Lead</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full"><X size={18} className="text-slate-500" /></button>
          </div>
          {isFakeWarning && (
            <p className="mx-4 mb-2 text-red-600 text-xs font-bold flex items-center gap-1 bg-red-50 p-2 rounded border border-red-200 animate-pulse">
              <AlertTriangle size={13} /> WARNING: Customer marked fake before!
            </p>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto av-scroll-thin px-4 pb-4">{formBody('mobile-form-')}</div>
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-sm text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition">Cancel</button>
              <button type="submit" className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-blue-600 hover:bg-blue-700 transition">Save Lead</button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
    </>
  );
}
