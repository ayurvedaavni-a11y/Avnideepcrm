import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { processLeadStatusUpdate } from '../db/workflow';
import { toast } from 'react-hot-toast';
import Plus from 'lucide-react/dist/esm/icons/plus'
import Eye from 'lucide-react/dist/esm/icons/eye'
import X from 'lucide-react/dist/esm/icons/x'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Copy from 'lucide-react/dist/esm/icons/copy'
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
import { TELECALLER_STATUSES } from '../db/lifecycle';
import { assignLead, bulkAssignLeads, removeAssignment } from '../db/assignmentEngine';
import { listTeamMembers } from '../db/auth';
import type { TeamProfile } from '../db/auth';
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import Phone from 'lucide-react/dist/esm/icons/phone'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import { CallLogModal } from '../components/CallLogModal';
import { api } from '../db/apiClient';

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
  const leads = useLiveQuery(() => db.leads.reverse().toArray()) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray()) || [];
  const allOrders = useLiveQuery(() => db.orders.toArray()) || [];
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
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

  // TELECALLER ISOLATION: non-admin users see ONLY their own assigned leads
  const visibleLeads = useMemo(() => {
    if (isAdmin || !authProfile?.id) return leads;
    return leads.filter(l => l.assignedTo === authProfile.id || l.assignedAgent === authProfile.full_name);
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
      filtered = filtered.filter(lead => lead.assignedTo === filterTelecaller || lead.assignedAgent === filterTelecaller);
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

  // VirtualTable column definitions
  const leadColumns: VirtualTableColumn<any>[] = useMemo(() => {
    const handlePriorityChange = async (lead: any, newPriority: string) => {
      await db.leads.update(lead.id!, { priority: newPriority as any, updatedAt: new Date().toISOString() });
      await db.timelineLogs.add({
        customerId: lead.customerId, entityType: 'Lead', entityId: lead.id,
        action: 'Priority updated to ' + newPriority,
        notes: 'Priority changed from ' + (lead.priority || 'None') + ' to ' + newPriority,
        agentName: 'Admin', createdAt: new Date().toISOString(),
      });
      toast.success('Priority updated to ' + newPriority);
    };

    return [
      {
        key: 'select',
        header: '',
        width: '44px',
        align: 'center',
        render: (lead: any) => isAdmin ? (
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
            className="w-4 h-4 accent-blue-600"
          />
        ) : null
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
            {TELECALLER_STATUSES.map(st => (
              <option key={st} value={st}>{st}</option>
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
              onChange={async (e) => {
                const val = e.target.value;
                try {
                  if (!val) {
                    await removeAssignment(lead.id);
                    toast.success('Assignment removed - lead wapas pool mein');
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
              }}
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
  }, [customerMap, mobileCountMap, handleStatusChange, isAdmin, telecallers, selectedIds]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lead Center</h1>
          <p className="text-slate-500 text-sm">Manage, filter and convert pipeline opportunities.</p>
        </div>
        <button 
          onClick={() => setIsFormOpen(true)}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 hover:bg-blue-700 transition shadow-sm font-semibold"
        >
          <Plus size={20} /> Add New Lead
        </button>
      </div>

      {/* Tabs Filter Bar */}
      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-2">
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

      {/* Search + Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search name, mobile or order ID..."
            value={mobileSearch}
            onChange={(e) => { setMobileSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
            {mobileSearch && <span className="text-blue-600"> matching "{mobileSearch}"</span>}
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

      {/* Filters + Bulk Assign */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-2">
        {isAdmin && (
          <select value={filterTelecaller} onChange={(e) => { setFilterTelecaller(e.target.value); setPage(0); }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none">
            <option value="">All Telecallers</option>
            {telecallers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        )}
        <select value={filterState} onChange={(e) => { setFilterState(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none">
          <option value="">All States</option>
          {Array.from(new Set(allCustomers.map(c => c.state).filter(Boolean))).sort().map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none">
          <option value="">All Statuses</option>
          {TELECALLER_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <input value={filterProduct} onChange={(e) => { setFilterProduct(e.target.value); setPage(0); }}
          placeholder="Filter by product..." className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none w-44" />
        {isAdmin && selectedIds.size > 0 && (
          <>
            <button onClick={() => setBulkAssignLead({ leadIds: Array.from(selectedIds) })}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition">
              <UserPlus size={16} /> Bulk Assign ({selectedIds.size})
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100">Clear</button>
          </>
        )}
      </div>

      {/* Leads Table — Virtual Scrolling */}
      <VirtualTable
        data={paginatedLeads}
        height={520}
        estimateSize={72}
        emptyState={
          <div className="flex items-center justify-center py-12 text-slate-500">
            No leads match this filter.
          </div>
        }
        rowClassName={() => 'border-b border-slate-100 hover:bg-slate-50 transition-colors'}
        columns={leadColumns}
      />

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
                  await db.leads.update(id, { assignedTo: tc.id, assignedAgent: tc.full_name, updatedAt: now });
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

// ===== TabButton (memoized) =====
const TabButton = React.memo(function TabButton({ label, count, active, onClick }: { label: string, count: number, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-bold text-sm transition-all duration-200 flex items-center gap-2 ${
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

// LeadRow removed — now handled inline in VirtualTable columns

function FollowupModal({ lead, onClose, onSave }: any) {
  const [date, setDate] = useState(lead.followupDate || '');
  const [time, setTime] = useState(lead.followupTime || '');
  const [notes, setNotes] = useState(lead.notes || '');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">Schedule {lead.newStatus}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
              <input required type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Time *</label>
              <input required type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Agent Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Customer requested to call after 5 PM..." className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 rows-3" />
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button 
            onClick={() => {
              if(!date) return toast.error('Date is required');
              onSave({ followupDate: date, followupTime: time, notes });
            }}
            className="px-5 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 transition"
          >
            Confirm Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function NotInterestedModal({ onClose, onSave }: any) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">Not Interested Reason</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select / Type Reason *</label>
            <select 
              value={reason} 
              onChange={e => setReason(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 mb-2"
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
              className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 rows-2"
            />
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button 
            onClick={() => {
              if(!reason.trim()) return toast.error('Reason is required');
              onSave(reason);
            }}
            className="px-5 py-2 rounded-lg font-medium text-white bg-slate-900 hover:bg-slate-800 transition"
          >
            Save Reason
          </button>
        </div>
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">Bulk Assign {count} Lead{count > 1 ? 's' : ''}</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Telecaller</label>
            <select value={tcId} onChange={(e) => setTcId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              <option value="">Select telecaller…</option>
              {telecallers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            Already-assigned leads ko bhi move karein (reassign)
          </label>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-6 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button onClick={handle} disabled={busy || !tcId}
            className="px-6 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-60">
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadForm({ onClose }: { onClose: () => void }) {
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

  return (
    <>
    {duplicateModal}
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Add New Lead</h2>
            {isFakeWarning && (
              <p className="text-red-600 text-sm font-bold flex items-center gap-1 mt-1 bg-red-50 p-2 rounded border border-red-200 animate-pulse">
                <AlertTriangle size={16} /> WARNING: Customer marked fake before!
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full"><X size={24} className="text-slate-500"/></button>
        </div>
        <div className="p-6 overflow-y-auto">
          <form id="lead-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-bold text-slate-700 border-b pb-2">Customer Details</h3>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Mobile Number *</label>
                  <input required type="text" maxLength={10} value={formData.mobile}
                    onChange={e => { setFormData({...formData, mobile: e.target.value}); checkExistingCustomer(e.target.value); }}
                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Full Address</label>
                  <textarea value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 rows-2" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <PincodeInput pincode={formData.pincode} city={formData.city} state={formData.state}
                    onChange={(updates: any) => setFormData(prev => ({...prev, ...updates}))} />
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                    <input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
                </div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                  <input type="text" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" placeholder="Auto-filled from pincode" /></div>
              </div>
              <div className="space-y-4">
                <h3 className="font-bold text-slate-700 border-b pb-2">Lead Details</h3>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Product Interested *</label>
                  <input required type="text" value={formData.product} onChange={e => setFormData({...formData, product: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Expected Amount *</label>
                    <input required type="number" value={formData.expectedAmount} onChange={e => setFormData({...formData, expectedAmount: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
                      {TELECALLER_STATUSES.map(st => <option key={st}>{st}</option>)}
                    </select></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Followup Date</label>
                    <input type="date" value={formData.followupDate} onChange={e => setFormData({...formData, followupDate: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Followup Time</label>
                    <input type="time" value={formData.followupTime} onChange={e => setFormData({...formData, followupTime: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></div>
                </div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 rows-2" /></div>
              </div>
            </div>
          </form>
        </div>
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} type="button" className="px-6 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button form="lead-form" type="submit" className="px-6 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 transition">Save Lead</button>
        </div>
      </div>
    </div>
    </>
  );
}
