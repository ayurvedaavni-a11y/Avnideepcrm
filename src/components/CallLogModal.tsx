// CallLogModal — Telecaller logs a call: status + notes + follow-up + reminder.
// Every call is appended to callLogs (full call history) and notes are appended,
// so previous notes are never overwritten.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { logCall } from '../db/assignmentEngine';
import { TELECALLER_STATUSES } from '../db/lifecycle';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import Bell from 'lucide-react/dist/esm/icons/bell'
import History from 'lucide-react/dist/esm/icons/history'
import X from 'lucide-react/dist/esm/icons/x'
import Save from 'lucide-react/dist/esm/icons/save'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import { safeFormat } from '../lib/safeFormat';
import { getBadgeClasses } from '../db/lifecycle';

interface Props {
  lead: any;
  customer: any;
  onClose: () => void;
}

export function CallLogModal({ lead, customer, onClose }: Props) {
  const { profile } = useAuth();
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState('');
  const [followupDate, setFollowupDate] = useState(lead.followupDate || '');
  const [followupTime, setFollowupTime] = useState(lead.followupTime || '');
  const [reminderDate, setReminderDate] = useState(lead.reminderDate || '');
  const [reminderTime, setReminderTime] = useState(lead.reminderTime || '');
  const [reminderReason, setReminderReason] = useState(lead.reminderReason || '');
  const [durationMin, setDurationMin] = useState('');
  const [busy, setBusy] = useState(false);

  // Full call history for this lead (never overwritten)
  const history = useLiveQuery(
    () => db.callLogs.where('leadId').equals(lead.id).reverse().toArray(),
    [lead.id]
  ) || [];

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const mins = Number(durationMin);
      await logCall({
        leadId: lead.id,
        telecallerId: profile?.id,
        telecallerName: profile?.full_name || 'Telecaller',
        status,
        notes,
        followupDate: followupDate || undefined,
        followupTime: followupTime || undefined,
        reminderDate: reminderDate || undefined,
        reminderTime: reminderTime || undefined,
        reminderReason: reminderReason || undefined,
        durationSec: Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60) : 0,
      });
      toast.success('Call logged successfully');
      onClose();
    } catch (e: any) {
      toast.error('Failed to log call: ' + (e?.message || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <PhoneCall className="text-blue-600" size={22} /> Log Call
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              <span className="font-bold text-slate-700">{customer?.name || 'Unknown'}</span>
              <span className="mx-2 text-slate-300">•</span>
              {customer?.mobile || ''}
              <span className="mx-2 text-slate-300">•</span>
              {lead.product}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
            <X size={24} className="text-slate-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Status */}
          <div>
            <label htmlFor="calllog-status" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Call Result / Status
            </label>
            <select
              id="calllog-status"
              name="calllog-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {TELECALLER_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {status !== lead.status && (
              <span className={`inline-block mt-2 px-2.5 py-1 rounded-full text-[11px] font-bold ${getBadgeClasses(status)}`}>
                {lead.status} → {status}
              </span>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Call Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed with the customer? Previous notes are never overwritten."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          {/* Call duration (optional) */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Call Duration (minutes, optional)
            </label>
            <input
              id="calllog-duration"
              name="calllog-duration"
              type="number"
              min={0}
              inputMode="numeric"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 5 — call duration in minutes"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          {/* Follow-up */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <CalendarDays size={14} /> Next Follow-up
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <input id="calllog-followup-date" name="calllog-followup-date" type="date" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <input id="calllog-followup-time" name="calllog-followup-time" type="time" value={followupTime} onChange={(e) => setFollowupTime(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            </div>
          </div>

          {/* Reminder */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Bell size={14} /> Reminder
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input id="calllog-reminder-date" name="calllog-reminder-date" type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              <input id="calllog-reminder-time" name="calllog-reminder-time" type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <input
              type="text"
              value={reminderReason}
              onChange={(e) => setReminderReason(e.target.value)}
              placeholder="Reminder reason (e.g. call again in the evening)"
              className="mt-3 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          {/* Call History */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <History size={14} /> Call History ({history.length})
            </label>
            {history.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No previous calls logged for this lead.</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {history.map((c) => (
                  <div key={c.id} className="border border-slate-100 rounded-lg p-3 bg-slate-50">
                    <div className="flex items-center justify-between">
     
                      <span className="text-xs font-bold text-slate-600">{c.telecallerName}</span>
                      <span className="text-xs text-slate-400">{safeFormat(c.createdAt, 'dd MMM, h:mm a')}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getBadgeClasses(c.status)}`}>{c.status}</span>
                      {(c.durationSec ?? 0) > 0 && <span className="text-[10px] text-slate-500 font-semibold">⏱ {Math.round((c.durationSec ?? 0) / 60)} min</span>}
                      {c.followupDate && <span className="text-[10px] text-amber-600 font-semibold">📅 {c.followupDate}</span>}
                    </div>
                    {c.notes && <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{c.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} type="button" className="px-6 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="px-6 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-60 flex items-center gap-2"
          >
            <Save size={16} /> {busy ? 'Saving…' : 'Save Call'}
          </button>
        </div>
      </div>
    </div>
  );
}
