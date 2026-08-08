import { useState, useMemo, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SpaceLFollowup } from '../db/db';
import Phone from 'lucide-react/dist/esm/icons/phone'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle'
import Check from 'lucide-react/dist/esm/icons/check'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import X from 'lucide-react/dist/esm/icons/x'
import Eye from 'lucide-react/dist/esm/icons/eye'
import Clock from 'lucide-react/dist/esm/icons/clock'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Filter from 'lucide-react/dist/esm/icons/filter'
import Search from 'lucide-react/dist/esm/icons/search'
import User from 'lucide-react/dist/esm/icons/user'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up'
import Zap from 'lucide-react/dist/esm/icons/zap'
import Bell from 'lucide-react/dist/esm/icons/bell'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import History from 'lucide-react/dist/esm/icons/history'
import { Customer360Profile } from '../components/Customer360Profile';
import { safeFormat } from '../lib/safeFormat';
import { toast } from 'react-hot-toast';
import { processLeadStatusUpdate } from '../db/workflow';
import { useDateFilter } from '../context/DateFilterContext';
import { useAuth } from '../context/AuthContext';

// ========== Types ==========
type PipelineStage = 'all' | 'overdue' | 'due-today' | 'scheduled' | 'callback' | 're-engaged' | 'hot' | 'converted' | 'closed';

interface PipelineTab {
  key: PipelineStage;
  label: string;
  icon: any;
  color: string;
}

const PIPELINE_TABS: PipelineTab[] = [
  { key: 'all', label: 'All SpaceL', icon: Filter, color: 'text-slate-700 bg-slate-100' },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
  { key: 'due-today', label: 'Due Today', icon: Clock, color: 'text-amber-600 bg-amber-50' },
  { key: 'scheduled', label: 'Scheduled', icon: CalendarDays, color: 'text-blue-600 bg-blue-50' },
  { key: 'callback', label: 'Callback', icon: Phone, color: 'text-purple-600 bg-purple-50' },
  { key: 're-engaged', label: 'Re-engaged', icon: RefreshCw, color: 'text-emerald-600 bg-emerald-50' },
  { key: 'hot', label: 'Hot 🔥', icon: TrendingUp, color: 'text-orange-600 bg-orange-50' },
  { key: 'converted', label: 'Won 🏆', icon: Check, color: 'text-green-700 bg-green-50' },
  { key: 'closed', label: 'Closed', icon: X, color: 'text-slate-500 bg-slate-100' },
];

// ========== Helper functions ==========
function getTodayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function classifyLeadStage(lead: any, followupCount: number): PipelineStage {
  const today = getTodayStr();
  const fd = lead.followupDate;
  const status = lead.status;

  if (status === 'Order Booked' || status === 'Order Confirmed') return 'converted';
  if (status === 'Not Interested' || status === 'Order Cancelled' || status === 'Wrong Number' || status === 'Duplicate Lead' || status === 'Already Purchased' || status === 'Closed') return 'closed';

  // Overdue: followup date is in the past and still pending
  if (status === 'Followup' || status === 'Callback' || status === 'Callback Requested' || status === 'Not Reachable' || status === 'Busy') {
    if (fd && fd < today) return 'overdue';
    if (fd === today) return 'due-today';
    if (fd && fd > today) return 'scheduled';
  }

  if (status === 'Callback' || status === 'Callback Requested') return 'callback';      if (status === 'Interested') {
    if (followupCount >= 3) return 'hot';
    return 're-engaged';
  }
  if (status === 'Ring') return 'callback';

  // Default classification
  if (!fd) return 'scheduled';
  if (fd < today) return 'overdue';
  if (fd === today) return 'due-today';
  return 'scheduled';
}

// ========== Main Component ==========
export function FollowUps() {
  const { profile: authProfile, isAdmin } = useAuth();
  const leads = useLiveQuery(() => db.leads.filter(l => 
    ['Followup', 'Callback', 'Callback Requested', 'Not Reachable', 'Busy', 'Interested', 'Ring', 'Order Booked', 'Order Confirmed', 'Not Interested'].includes(l.status) &&
    (isAdmin || !authProfile?.id || l.assignedTo === authProfile.id || l.assignedAgent === authProfile.full_name)
  ).toArray(), [isAdmin, authProfile?.id, authProfile?.full_name]) || [];
  const allCustomers = useLiveQuery(() => db.customers.toArray()) || [];
  const [activePipeline, setActivePipeline] = useState<PipelineStage>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [snoozeModal, setSnoozeModal] = useState<{ lead: any; customer: any } | null>(null);
  const [statusChangeModal, setStatusChangeModal] = useState<{ lead: any; customer: any } | null>(null);
  const [showFollowupHistory, setShowFollowupHistory] = useState<{ lead: any; customer: any; followups: SpaceLFollowup[] } | null>(null);

  // OPTIMIZATION: Build customerMap ONCE
  const customerMap = useMemo(() => {
    const map = new Map<number, any>();
    allCustomers.forEach(c => { if (c.id) map.set(c.id, c); });
    return map;
  }, [allCustomers]);

  // Get follow-up counts per lead from spacelFollowups table
  const followupCounts = useLiveQuery(
    () => db.spacelFollowups.toArray(),
    []
  ) || [];

  // OPTIMIZATION: Build followupMap ONCE
  const followupMap = useMemo(() => {
    const map = new Map<number, SpaceLFollowup[]>();
    followupCounts.forEach(f => {
      if (!map.has(f.leadId)) map.set(f.leadId, []);
      map.get(f.leadId)!.push(f);
    });
    return map;
  }, [followupCounts]);

  const { filterByDate } = useDateFilter();

  // Date-filtered leads (for stats that need to respect date range)
  const dateFilteredLeads = useMemo(() => {
    return filterByDate(leads, 'createdAt');
  }, [leads, filterByDate]);

  // OPTIMIZATION: Stats computed ONCE
  const stats = useMemo(() => {
    const overdue = dateFilteredLeads.filter(l => l.followupDate && l.followupDate < getTodayStr() && (l.status === 'Followup' || l.status === 'Callback')).length;
    const dueToday = dateFilteredLeads.filter(l => l.followupDate === getTodayStr() && (l.status === 'Followup' || l.status === 'Callback')).length;
    const total = dateFilteredLeads.length;
    return { overdue, dueToday, total } as const;
  }, [dateFilteredLeads]);

  // Classify and filter leads
  const pipelineLeads = useMemo(() => {
    const leadStages = dateFilteredLeads.map(lead => ({
      lead,
      customer: customerMap.get(lead.customerId),
      stage: classifyLeadStage(lead, (followupMap.get(lead.id!) || []).length),
      followups: followupMap.get(lead.id!) || [],
      followupCount: (followupMap.get(lead.id!) || []).length,
    })).filter(item => item.customer);

    // Search filter
    let filtered = leadStages;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = leadStages.filter(item => 
        item.customer.name.toLowerCase().includes(q) ||
        item.customer.mobile.includes(q) ||
        item.lead.product.toLowerCase().includes(q) ||
        (item.lead.notes || '').toLowerCase().includes(q)
      );
    }

    // Pipeline filter
    if (activePipeline !== 'all') {
      filtered = filtered.filter(item => item.stage === activePipeline);
    }

    // Sort by urgency
    filtered.sort((a, b) => {
      const stageOrder: Record<string, number> = { 'overdue': 0, 'due-today': 1, 'scheduled': 2, 'callback': 3, 're-engaged': 4, 'hot': 5, 'converted': 6, 'closed': 7 };
      const orderA = stageOrder[a.stage] ?? 99;
      const orderB = stageOrder[b.stage] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      const fdA = a.lead.followupDate || '9999-99-99';
      const fdB = b.lead.followupDate || '9999-99-99';
      return fdA.localeCompare(fdB);
    });

    return filtered;
  }, [dateFilteredLeads, customerMap, followupMap, activePipeline, searchQuery]);

  // Handle status update with SpaceL logging
  const handleStatusChange = async (lead: any, newStatus: string, extraData?: any) => {
    try {
      const action = newStatus === 'Order Booked' ? 'Order Booked' :
        newStatus === 'Not Interested' ? 'Not Interested' :
        newStatus === 'Interested' ? 'Re-engaged' :
        newStatus === 'Callback' ? 'Callback' : 'Called';

      await processLeadStatusUpdate(lead.id!, newStatus as any, {
        notes: extraData?.notes || '',
        followupDate: extraData?.followupDate || lead.followupDate,
        followupTime: extraData?.followupTime || lead.followupTime,
        agentName: 'Admin',
      });

      // Log in SpaceLFollowup table
      await db.spacelFollowups.add({
        leadId: lead.id!,
        customerId: lead.customerId,
        action: action as any,
        status: 'completed',
        notes: extraData?.notes || `Status changed to ${newStatus}`,
        agentName: 'Admin',
        nextFollowupDate: extraData?.nextFollowupDate || '',
        nextFollowupTime: extraData?.nextFollowupTime || '',
        createdAt: new Date().toISOString(),
      });

      toast.success(`Lead moved to ${newStatus}`);
    } catch (error) {
      toast.error('Failed to update status');
      console.error(error);
    }
  };

  // Handle snooze
  const handleSnooze = async (lead: any, newDate: string, newTime: string) => {
    try {
      const now = new Date().toISOString();
      await db.leads.update(lead.id!, {
        followupDate: newDate,
        followupTime: newTime,
        status: 'Followup',
        notes: `Snoozed from ${lead.followupDate || 'unknown'} to ${newDate} at ${newTime}`,
        updatedAt: now,
      });

      await db.spacelFollowups.add({
        leadId: lead.id!,
        customerId: lead.customerId,
        action: 'Snoozed',
        status: 'completed',
        notes: `Snoozed to ${newDate} ${newTime}`,
        agentName: 'Admin',
        nextFollowupDate: newDate,
        nextFollowupTime: newTime,
        createdAt: now,
      });

      await db.timelineLogs.add({
        customerId: lead.customerId,
        entityType: 'Lead',
        action: 'Follow-up Snoozed',
        notes: `Rescheduled from ${lead.followupDate || 'N/A'} to ${newDate} at ${newTime}`,
        agentName: 'Admin',
        createdAt: now,
      });

      setSnoozeModal(null);
      toast.success('Follow-up snoozed successfully');
    } catch (error) {
      toast.error('Failed to snooze');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ===== Header ===== */}
      <div className="flex justify-between flex-wrap gap-2 items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Zap className="text-amber-500" size={28} />
            SpaceL Leads Pipeline
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Track, nurture & convert customers who said "baad mein lunga"
          </p>
        </div>
        <div className="flex items-center gap-5">
          {/* Stats badges */}
          <div className="flex items-center gap-3">
            {stats.overdue > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold animate-pulse">
                <AlertTriangle size={14} /> {stats.overdue} Overdue
              </div>
            )}
            {stats.dueToday > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">
                <Clock size={14} /> {stats.dueToday} Due Today
              </div>
            )}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">
              <User size={14} /> {stats.total} Total
            </div>
          </div>
        </div>
      </div>

      {/* ===== Pipeline Tabs ===== */}
      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-1.5 overflow-x-auto">
        {PIPELINE_TABS.map(tab => {
          const count = tab.key === 'all' ? dateFilteredLeads.length :
            pipelineLeads.filter(p => p.stage === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActivePipeline(tab.key)}
              className={`px-3.5 py-2 rounded-lg font-bold text-xs transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap ${
                activePipeline === tab.key
                  ? 'bg-slate-900 text-white shadow-md scale-105'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activePipeline === tab.key ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ===== Search ===== */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          type="text"
          placeholder="Search by name, mobile, product, notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* ===== Pipeline View ===== */}
      {activePipeline === 'all' ? (
        /* Grouped Pipeline View */
        <div className="space-y-8">
          {(['overdue', 'due-today', 'scheduled', 'callback', 're-engaged', 'hot', 'converted', 'closed'] as PipelineStage[]).map(stageKey => {
            const items = pipelineLeads.filter(p => p.stage === stageKey);
            if (items.length === 0) return null;
            const tab = PIPELINE_TABS.find(t => t.key === stageKey)!;
            return (
              <PipelineSection
                key={stageKey}
                tab={tab}
                items={items}                    onViewTimeline={(cid: number) => setSelectedCustomerId(cid)}
                    onStatusChange={handleStatusChange}
                    onSnooze={(lead: any) => setSnoozeModal({ lead, customer: customerMap.get(lead.customerId) })}
                    onViewHistory={(lead: any, followups: SpaceLFollowup[]) => setShowFollowupHistory({ lead, customer: customerMap.get(lead.customerId), followups })}
                    onStatusModal={(lead: any) => setStatusChangeModal({ lead, customer: customerMap.get(lead.customerId) })}
              />
            );
          })}
          {pipelineLeads.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <Bell size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-bold text-slate-500">No SpaceL Leads Found</p>
              <p className="text-sm mt-1">Leads with "Follow-up" or "Callback" status will appear here</p>
            </div>
          )}
        </div>
      ) : (
        /* Single Stage View */
        <div className="space-y-3">
          {pipelineLeads.map(item => (
            <SpaceLLeadCard
              key={item.lead.id}
              lead={item.lead}
              customer={item.customer}
              stage={item.stage}
              followups={item.followups}
              onViewTimeline={() => setSelectedCustomerId(item.lead.customerId)}
              onStatusChange={(newStatus: string, extra?: any) => handleStatusChange(item.lead, newStatus, extra)}
              onSnooze={() => setSnoozeModal({ lead: item.lead, customer: item.customer })}
              onViewHistory={() => setShowFollowupHistory({ lead: item.lead, customer: item.customer, followups: item.followups })}
              onStatusModal={() => setStatusChangeModal({ lead: item.lead, customer: item.customer })}
            />
          ))}
          {pipelineLeads.length === 0 && (
            <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-slate-200">
              <Check size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-bold text-slate-500">All clear! No leads in this stage.</p>
            </div>
          )}
        </div>
      )}

      {/* ===== Modals ===== */}
      {selectedCustomerId && (
        <Customer360Profile
          customerId={selectedCustomerId}
          isOpen={true}
          onClose={() => setSelectedCustomerId(null)}
        />
      )}

      {snoozeModal && (
        <SnoozeModal
          lead={snoozeModal.lead}
          customer={snoozeModal.customer}
          onClose={() => setSnoozeModal(null)}            onSave={(date: string, time: string) => handleSnooze(snoozeModal.lead, date, time)}
        />
      )}

      {statusChangeModal && (
        <StatusChangeModal
          lead={statusChangeModal.lead}
          customer={statusChangeModal.customer}
          onClose={() => setStatusChangeModal(null)}
          onSave={(newStatus: string, extra: any) => {
            handleStatusChange(statusChangeModal.lead, newStatus, extra);
            setStatusChangeModal(null);
          }}
        />
      )}

      {showFollowupHistory && (
        <FollowupHistoryModal
          lead={showFollowupHistory.lead}
          customer={showFollowupHistory.customer}
          followups={showFollowupHistory.followups}
          onClose={() => setShowFollowupHistory(null)}
          onViewTimeline={() => {
            setSelectedCustomerId(showFollowupHistory.lead.customerId);
            setShowFollowupHistory(null);
          }}
        />
      )}
    </div>
  );
}

// ========== Pipeline Section ==========
function PipelineSection({ tab, items, onViewTimeline, onStatusChange, onSnooze, onViewHistory, onStatusModal }: any) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div
        className={`px-5 py-3.5 flex items-center justify-between cursor-pointer ${tab.color} bg-opacity-40`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2.5">
          <tab.icon size={18} />
          <h3 className="font-bold text-sm">{tab.label}</h3>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/60`}>
            {items.length}
          </span>
        </div>
        <ChevronDown size={16} className={`text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
      </div>
      
      {!collapsed && (
        <div className="divide-y divide-slate-100">
          {items.map((item: any) => (
            <SpaceLLeadCard
              key={item.lead.id}
              lead={item.lead}
              customer={item.customer}
              stage={item.stage}
              compact={true}
              onViewTimeline={() => onViewTimeline(item.lead.customerId)}
              onStatusChange={(newStatus: string, extra?: any) => onStatusChange(item.lead, item.customer, newStatus, extra)}
              onSnooze={() => onSnooze(item.lead, item.customer)}
              onViewHistory={() => onViewHistory(item.lead, item.customer, item.followups)}
              onStatusModal={() => onStatusModal(item.lead, item.customer)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Lead Card ==========
const SpaceLLeadCard = memo(function SpaceLLeadCard({ lead, customer, stage, compact, followups, onViewTimeline, onStatusChange, onSnooze, onViewHistory, onStatusModal }: any) {
  const [showActions, setShowActions] = useState(false);
  const today = getTodayStr();
  const isOverdue = lead.followupDate && lead.followupDate < today && (lead.status === 'Followup' || lead.status === 'Callback');
  const isDueToday = lead.followupDate === today && (lead.status === 'Followup' || lead.status === 'Callback');
  const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.followupDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const fupCount = followups?.length || 0;

  const stageConfig: Record<string, { bg: string; dot: string; label: string }> = {
    'overdue': { bg: 'border-l-red-400', dot: 'bg-red-500', label: 'Overdue' },
    'due-today': { bg: 'border-l-amber-400', dot: 'bg-amber-500', label: 'Due Today' },
    'scheduled': { bg: 'border-l-blue-400', dot: 'bg-blue-500', label: 'Scheduled' },
    'callback': { bg: 'border-l-purple-400', dot: 'bg-purple-500', label: 'Callback' },
    're-engaged': { bg: 'border-l-emerald-400', dot: 'bg-emerald-500', label: 'Re-engaged' },
    'hot': { bg: 'border-l-orange-400', dot: 'bg-orange-500', label: 'Hot' },
    'converted': { bg: 'border-l-green-400', dot: 'bg-green-500', label: 'Won' },
    'closed': { bg: 'border-l-slate-400', dot: 'bg-slate-400', label: 'Closed' },
  };

  const cfg = stageConfig[stage] || stageConfig['scheduled'];

  return (
    <div className={`relative border-l-4 ${cfg.bg} hover:bg-slate-50 transition-all duration-150`}>
      <div className={`p-4 ${compact ? 'pr-16' : 'pr-4'}`}>
        <div className="flex items-start justify-between">
          {/* Left: Customer Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {customer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-slate-800 text-sm cursor-pointer hover:text-blue-600" onClick={() => onViewTimeline()}>{customer.name}</h4>
                  {isOverdue && (
                    <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded flex items-center gap-1">
                      <AlertTriangle size={10} /> {daysOverdue}d overdue
                    </span>
                  )}
                  {isDueToday && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded flex items-center gap-1">
                      <Clock size={10} /> Due Today
                    </span>
                  )}
                  {stage === 'hot' && (
                    <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded flex items-center gap-1">
                      <TrendingUp size={10} /> Hot
                    </span>
                  )}
                  {stage === 'converted' && (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded flex items-center gap-1">
                      <Check size={10} /> Won
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span className="font-medium">{customer.mobile}</span>
                  <span className="text-slate-300">•</span>
                  <span className="font-medium">{lead.product}</span>
                  <span className="text-slate-300">•</span>
                  <span className="font-semibold text-slate-700">₹{lead.expectedAmount}</span>
                </div>
              </div>
            </div>

            {/* Notes and Follow-up info */}
            <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
              {lead.followupDate && (
                <span className="flex items-center gap-1">
                  <CalendarDays size={12} />
                  {safeFormat(lead.followupDate, 'dd MMM')}
                  {lead.followupTime && <> at {lead.followupTime}</>}
                </span>
              )}
              {fupCount > 0 && (
                <span className="flex items-center gap-1 text-slate-400">
                  <History size={12} /> {fupCount} follow-up{fupCount !== 1 ? 's' : ''}
                </span>
              )}
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                lead.priority === 'High' ? 'bg-red-50 text-red-700' :
                lead.priority === 'Medium' ? 'bg-amber-50 text-amber-700' :
                'bg-blue-50 text-blue-700'
              }`}>
                {lead.priority || 'Medium'}
              </span>
            </div>

            {lead.notes && (
              <div className="mt-1.5 text-xs text-slate-600 italic bg-slate-50 px-2.5 py-1.5 rounded border border-slate-100 inline-block max-w-lg truncate">
                "{lead.notes}"
              </div>
            )}
          </div>

          {/* Right: Actions */}
          <div className={`flex items-center gap-1.5 shrink-0 ${compact ? 'absolute right-3 top-1/2 -translate-y-1/2' : ''}`}>
            {stage !== 'converted' && stage !== 'closed' && (
              <>
                <QuickAction icon={Phone} label="Call" color="bg-blue-100 text-blue-700 hover:bg-blue-200" onClick={() => window.open(`tel:${customer.mobile}`)} />
                <QuickAction icon={MessageCircle} label="WhatsApp" color="bg-green-100 text-green-700 hover:bg-green-200" onClick={() => window.open(`https://wa.me/91${customer.mobile}`)} />
                <QuickAction icon={Check} label="Re-engage" color="bg-emerald-100 text-emerald-700 hover:bg-emerald-200" onClick={() => onStatusChange('Interested', { notes: 'Customer re-engaged via SpaceL pipeline' })} />
                <QuickAction icon={ShoppingCart} label="Order" color="bg-indigo-100 text-indigo-700 hover:bg-indigo-200" onClick={() => onStatusChange('Order Booked')} />
                <QuickAction icon={Clock} label="Snooze" color="bg-amber-100 text-amber-700 hover:bg-amber-200" onClick={onSnooze} />
              </>
            )}
            <QuickAction icon={Eye} label="Timeline" color="bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={onViewTimeline} />
            <QuickAction icon={History} label="History" color="bg-purple-100 text-purple-700 hover:bg-purple-200" onClick={onViewHistory} />
            
            {!compact && (
              <div className="relative">
                <button
                  onClick={() => setShowActions(!showActions)}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition"
                >
                  <MoreHorizontal size={16} />
                </button>
                {showActions && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-slate-200 z-20 w-48 py-1">
                    <button className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      onClick={() => { onStatusChange('Not Interested', { notes: '' }); setShowActions(false); }}>
                      <X size={14} className="text-red-500" /> Not Interested
                    </button>
                    <button className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      onClick={() => { onSnooze(); setShowActions(false); }}>
                      <Clock size={14} className="text-amber-500" /> Snooze / Reschedule
                    </button>
                    <button className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      onClick={() => { onStatusModal(); setShowActions(false); }}>
                      <RotateCcw size={14} className="text-purple-500" /> Change Status
                    </button>
                    <button className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      onClick={() => { onViewHistory(); setShowActions(false); }}>
                      <History size={14} className="text-blue-500" /> Follow-up History
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// ========== Quick Action Button ==========
const QuickAction = memo(function QuickAction({ icon: Icon, label, color, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-lg flex flex-col items-center gap-0.5 transition-colors ${color}`}
      title={label}
    >
      <Icon size={14} />
      <span className="text-[8px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
});

// ========== Snooze Modal ==========
function SnoozeModal({ lead, customer, onClose, onSave }: any) {
  const [date, setDate] = useState(lead.followupDate || '');
  const [time, setTime] = useState(lead.followupTime || '');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-amber-500" />
            <h2 className="text-lg font-bold text-slate-800">Snooze / Reschedule</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500"/></button>
        </div>
        <div className="p-6">
          <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500 font-medium">CUSTOMER</p>
            <p className="font-bold text-slate-800">{customer.name} - {customer.mobile}</p>
            <p className="text-sm text-slate-600">Product: {lead.product} | ₹{lead.expectedAmount}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Follow-up Date *</label>
              <input required type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Time *</label>
              <input required type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1, 3, 7].map(days => (
              <button
                key={days}
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + days);
                  setDate(d.toISOString().split('T')[0]);
                  setTime('10:00');
                }}
                className="py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700 transition"
              >
                {days} day{days > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button
            onClick={() => {
              if (!date) return toast.error('Date is required');
              onSave(date, time);
            }}
            className="px-5 py-2 rounded-lg font-medium text-white bg-amber-600 hover:bg-amber-700 transition flex items-center gap-2"
          >
            <Clock size={16} /> Confirm Snooze
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== Status Change Modal ==========
function StatusChangeModal({ lead, customer, onClose, onSave }: any) {
  const [newStatus, setNewStatus] = useState(lead.status);
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">Update Status</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500">Customer: <span className="font-bold text-slate-800">{customer.name}</span></p>
            <p className="text-xs text-slate-500">Current status: <span className="font-bold text-amber-600">{lead.status}</span></p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Status *</label>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Interested">Interested / Re-engaged</option>
              <option value="Callback">Callback Required</option>
              <option value="Followup">Follow-up Later</option>
              <option value="Order Booked">Won - Book Order 🏆</option>
              <option value="Not Interested">Not Interested / Lost ❌</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" placeholder="What happened during this interaction?" />
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">Cancel</button>
          <button
            onClick={() => onSave(newStatus, { notes })}
            className="px-5 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 transition"
          >
            Update Status
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== Follow-up History Modal ==========
function FollowupHistoryModal({ lead, customer, followups, onClose, onViewTimeline }: any) {
  const allTimelineLogs = useLiveQuery(
    () => db.timelineLogs.where('customerId').equals(customer.id).reverse().sortBy('createdAt'),
    [customer.id]
  ) || [];

  // Combine SpaceL followups with timeline logs
  const timelineEvents = useMemo(() => {
    const events: { date: string; type: string; description: string; actor: string; icon: any; color: string }[] = [];

    // Add SpaceL followups
    followups.forEach((f: any) => {
      events.push({
        date: f.createdAt,
        type: f.action,
        description: f.notes || f.action,
        actor: f.agentName || 'Admin',
        icon: f.action === 'Called' ? Phone : f.action === 'WhatsApp' ? MessageCircle : 
              f.action === 'Snoozed' ? Clock : f.action === 'Interested' || f.action === 'Re-engaged' ? Check :
              f.action === 'Order Booked' ? ShoppingCart : f.action === 'Not Interested' ? X : f.action === 'Missed' ? AlertTriangle : Bell,
        color: f.action === 'Called' ? 'bg-blue-100 text-blue-600' : f.action === 'WhatsApp' ? 'bg-green-100 text-green-600' : 
               f.action === 'Snoozed' ? 'bg-amber-100 text-amber-600' : f.action === 'Re-engaged' ? 'bg-emerald-100 text-emerald-600' :
               f.action === 'Order Booked' ? 'bg-indigo-100 text-indigo-600' : f.action === 'Not Interested' ? 'bg-slate-100 text-slate-600' : 
               f.action === 'Missed' ? 'bg-red-100 text-red-600' : 'bg-purple-100 text-purple-600',
      });
    });

    // Add timeline logs that are followup-related
    allTimelineLogs.forEach((log: any) => {
      if (log.action === 'Follow-up Snoozed' || 
          log.action === 'Status Change' || 
          log.action === 'Lead Status Change' ||
          log.action === 'Note added' ||
          log.action.includes('Followup') ||
          log.action.includes('Callback')) {
        events.push({
          date: log.createdAt,
          type: log.action,
          description: log.notes || log.action,
          actor: log.agentName || 'System',
          icon: log.action.includes('Snoozed') ? Clock : log.action.includes('Note') ? Bell : Phone,
          color: log.action.includes('Snoozed') ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600',
        });
      }
    });

    // Sort by date descending
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return events;
  }, [followups, allTimelineLogs]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <History size={22} className="text-purple-500" />
            <div>
              <h2 className="text-lg font-bold text-slate-800">Follow-up History</h2>
              <p className="text-xs text-slate-500">
                {customer.name} ({customer.mobile}) • {lead.product} • ₹{lead.expectedAmount}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onViewTimeline}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700 transition"
            >
              Full Timeline
            </button>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500"/></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
              <p className="text-xs text-slate-500">Total Follow-ups</p>
              <p className="text-xl font-bold text-slate-800">{followups.length}</p>
            </div>
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 text-center">
              <p className="text-xs text-blue-600 font-medium">Calls</p>
              <p className="text-xl font-bold text-blue-700">{followups.filter((f: any) => f.action === 'Called').length}</p>
            </div>
            <div className="bg-green-50 p-3 rounded-xl border border-green-200 text-center">
              <p className="text-xs text-green-600 font-medium">WhatsApp</p>
              <p className="text-xl font-bold text-green-700">{followups.filter((f: any) => f.action === 'WhatsApp').length}</p>
            </div>
            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-center">
              <p className="text-xs text-amber-600 font-medium">Snoozed</p>
              <p className="text-xl font-bold text-amber-700">{followups.filter((f: any) => f.action === 'Snoozed').length}</p>
            </div>
          </div>

          {/* Lead info */}
          <div className="bg-gradient-to-r from-slate-50 to-white p-4 rounded-xl border border-slate-200 mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 font-medium">Current Status</p>
                <p className="font-bold text-slate-800">{lead.status}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Priority</p>
                <p className="font-bold text-slate-800">{lead.priority || 'Medium'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Next Follow-up</p>
                <p className="font-bold text-slate-800">
                  {lead.followupDate ? safeFormat(lead.followupDate, 'dd MMM') : 'Not set'}
                  {lead.followupTime && <> at {lead.followupTime}</>}
                </p>
              </div>
            </div>
          </div>

          {/* Timeline Events */}
          {timelineEvents.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <History size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No follow-up history yet</p>
              <p className="text-sm mt-1">Actions will appear here as you interact with this lead</p>
            </div>
          ) : (
            <div className="space-y-0">
              {timelineEvents.map((event, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-9 h-9 rounded-full ${event.color} flex items-center justify-center shrink-0`}>
                      <event.icon size={16} />
                    </div>
                    {i !== timelineEvents.length - 1 && <div className="w-0.5 h-full bg-slate-200 my-1"></div>}
                  </div>
                  <div className="pb-5 flex-1">
                    <div className="flex justify-between items-start">
                      <h4 className="text-sm font-bold text-slate-800">{event.type}</h4>
                      <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                        {safeFormat(event.date, 'dd MMM yyyy, hh:mm a')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{event.description}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">by {event.actor}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Timeline footer */}
          <div className="text-center mt-4">
            <button
              onClick={onViewTimeline}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 transition"
            >
              View Full Customer Timeline →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
