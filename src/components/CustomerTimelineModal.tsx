import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { processLeadStatusUpdate } from '../db/workflow';
import { toast } from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x'
import Calendar from 'lucide-react/dist/esm/icons/calendar'
import User from 'lucide-react/dist/esm/icons/user'
import Package from 'lucide-react/dist/esm/icons/package'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import Phone from 'lucide-react/dist/esm/icons/phone'
import Edit3 from 'lucide-react/dist/esm/icons/edit-3'
import { format } from 'date-fns';

interface Props {
  customerId: number;
  isOpen: boolean;
  onClose: () => void;
}

export function CustomerTimelineModal({ customerId, isOpen, onClose }: Props) {
  const customer = useLiveQuery(() => db.customers.get(customerId), [customerId]);
  const logs = useLiveQuery(
    () => db.timelineLogs.where('customerId').equals(customerId).reverse().sortBy('createdAt'),
    [customerId]
  );
  const lead = useLiveQuery(() => db.leads.where('customerId').equals(customerId).first(), [customerId]);
  const [noteText, setNoteText] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddNote = async () => {
    if (!noteText.trim()) {
      toast.error('Please enter a note');
      return;
    }
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();

      if (selectedStatus && lead) {
        if (selectedStatus === 'Order Booked') {
          toast.error('Please use the Book Order button in Customer Profile to book an order');
          setIsSubmitting(false);
          return;
        }
        // Use processLeadStatusUpdate which handles logging, customer sync, and notifications
        await processLeadStatusUpdate(lead.id!, selectedStatus as any, {
          notes: noteText.trim(),
        });
        toast.success('Status updated to ' + selectedStatus);
      } else {
        // Just a note - add directly to timeline
        await db.timelineLogs.add({
          customerId,
          entityType: 'Note',
          action: 'Note added',
          notes: noteText.trim(),
          agentName: 'Admin',
          createdAt: now,
        });
        toast.success('Note added successfully');
      }

      setNoteText('');
      setSelectedStatus('');
      setIsAddingNote(false);
    } catch (error) {
      toast.error('Failed to save');
      console.error(error);
    }
    setIsSubmitting(false);
  };

  if (!isOpen || !customer) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Lifetime Timeline</h2>
            <p className="text-slate-500">{customer.name} ({customer.mobile})</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition">
            <X size={24} className="text-slate-500" />
          </button>
        </div>

        <div className="p-6 bg-slate-50 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-slate-100">
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500">Delivered</p>
            <p className="text-lg font-bold text-emerald-600">{customer.delivered}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500">RTO</p>
            <p className="text-lg font-bold text-red-600">{customer.rto}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500">Total Spend</p>
            <p className="text-lg font-bold text-blue-600">₹{customer.totalSpend}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <p className="text-xs text-slate-500">Risk Level</p>
            <p className={`text-lg font-bold ${customer.riskLevel === 'High' || customer.riskLevel === 'Fake' ? 'text-red-600' : 'text-emerald-600'}`}>
              {customer.riskLevel}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Add Note / Update Status Form */}
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
            {!isAddingNote ? (
              <button
                onClick={() => setIsAddingNote(true)}
                className="flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800 transition"
              >
                <Edit3 size={16} />
                Add Note / Update Status
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-blue-800">Add Timeline Note</h4>
                  <button
                    onClick={() => {
                      setIsAddingNote(false);
                      setNoteText('');
                      setSelectedStatus('');
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                  >
                    Cancel
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Update Status (Optional)</label>
                    <select
                      value={selectedStatus}
                      onChange={(e) => setSelectedStatus(e.target.value)}
                      className="w-full p-2 border border-blue-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">-- Keep current status --</option>
                      <option value="New Lead">New Lead</option>
                      <option value="Interested">Interested</option>
                      <option value="Ring">Ring</option>
                      <option value="Followup">Follow-up</option>
                      <option value="Callback">Callback</option>
                      {/* Order Booked option hidden - use Book Order in Customer Profile */}
                      <option value="Not Interested">Not Interested</option>
                      <option value="Fake Lead">Fake Lead</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleAddNote}
                      disabled={isSubmitting || !noteText.trim()}
                      className="w-full px-4 py-2 rounded-lg font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {isSubmitting ? 'Saving...' : 'Save Note'}
                    </button>
                  </div>
                </div>
                <div>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Type your note here..."
                    rows={3}
                    className="w-full p-3 border border-blue-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                {lead && (
                  <div className="text-xs text-slate-500">
                    Current status: <span className="font-semibold text-blue-700">{lead.status}</span>
                    {lead.priority && <> | Priority: <span className="font-semibold text-blue-700">{lead.priority}</span></>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {logs?.map((log, i) => (
              <div key={log.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    {log.entityType === 'Order' ? <Package size={20} /> :
                     log.entityType === 'NDR' ? <AlertTriangle size={20} /> :
                     log.entityType === 'Followup' ? <Phone size={20} /> :
                     log.entityType === 'Note' ? <Edit3 size={20} /> :
                     <User size={20} />}
                  </div>
                  {i !== logs.length - 1 && <div className="w-0.5 h-full bg-slate-200 my-2"></div>}
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1 mb-2">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-slate-800">{log.action}</h4>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Calendar size={12} />
                      {format(new Date(log.createdAt), 'dd MMM yyyy, hh:mm a')}
                    </span>
                  </div>
                  {log.statusFrom && log.statusTo && (
                    <p className="text-sm text-slate-600 mb-2">
                      Status changed: <span className="line-through opacity-70">{log.statusFrom}</span> → <span className="font-semibold text-blue-600">{log.statusTo}</span>
                    </p>
                  )}
                  {log.notes && (
                    <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 border border-slate-100">
                      {log.notes}
                    </div>
                  )}
                  {log.agentName && (
                    <p className="text-xs text-slate-400 mt-2">Agent: {log.agentName}</p>
                  )}
                </div>
              </div>
            ))}
            {logs?.length === 0 && (
              <div className="text-center text-slate-500 py-10">No timeline history found.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
