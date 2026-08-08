import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import Users from 'lucide-react/dist/esm/icons/users'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import Power from 'lucide-react/dist/esm/icons/power'

import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import X from 'lucide-react/dist/esm/icons/x'
import { createTeamMember, deleteMember, listTeamMembers, resetMemberPin, setMemberActive, setMemberRole } from '../db/auth';
import type { TeamProfile } from '../db/auth';
import { api } from '../db/apiClient';
import { useAuth } from '../context/AuthContext';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone'
import { ModalPortal } from '../components/ModalPortal';

export function Team() {
  const { profile } = useAuth();
  const [members, setMembers] = useState<TeamProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<'telecaller' | 'admin'>('telecaller');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pinResetMember, setPinResetMember] = useState<TeamProfile | null>(null);
  const [newPin, setNewPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  // Delete-protection modal: telecaller with assigned leads can only be deleted
  // via an explicit "transfer & delete" (force) confirmation.
  const [deleteTarget, setDeleteTarget] = useState<TeamProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const list = await listTeamMembers();
    setMembers(list);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // Defensive: even with autocomplete="off", some browsers autofill tel/
  // password inputs right after mount and fire an input event, which would
  // capture the login mobile number into this state. Wipe any such value so
  // these fields always render empty on page open.
  useEffect(() => {
    const t = setTimeout(() => {
      setName(''); setMobile(''); setPin(''); setNewPin('');
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleCreate = async () => {
    if (creating) return;
    const digits = mobile.replace(/\D/g, '');
    if (!name.trim()) { toast.error('Enter a name'); return; }
    if (digits.length < 10) { toast.error('Enter a valid 10-digit mobile number'); return; }
    if (!/^\d{6,8}$/.test(pin.trim())) { toast.error('PIN must be 6-8 digits'); return; }
    setCreating(true);
    try {
      const res = await createTeamMember(name.trim(), digits, pin.trim(), role);
      if (!res.ok) { toast.error(res.error || 'There was a problem creating the account'); return; }
      if (role === 'admin' && res.userId) {
        const promote = await setMemberRole(res.userId, 'admin');
        if (!promote.ok) toast.error('Account created, but could not be promoted to admin: ' + (promote.error || ''));
      }
      toast.success('Account created! The member can now log in.');
      setName(''); setMobile(''); setPin(''); setRole('telecaller');
      await load();
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (m: TeamProfile) => {
    setBusyId(m.id);
    try {
      const res = await setMemberActive(m.id, !m.is_active);
      if (!res.ok) toast.error(res.error || 'Update failed');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  // TASK 1 — DELETE PROTECTION: a telecaller with assigned leads must never be
  // silently deleted. If they have leads, open the warning modal first (the
  // server also enforces this — non-force delete of a member with leads → 409).
  const handleDelete = (m: TeamProfile) => {
    if (m.id === profile?.id) return;
    const leads = Number((m as any).lead_count ?? 0);
    if (leads > 0) {
      setDeleteTarget(m);
      return;
    }
    if (!window.confirm(`Delete ${m.full_name} (${m.mobile})? This member will be logged out immediately and will not be able to log in again.`)) return;
    void doDelete(m, false);
  };

  const doDelete = async (m: TeamProfile, force: boolean) => {
    setBusyId(m.id);
    try {
      const res = await deleteMember(m.id, force);
      if (!res.ok) {
        toast.error(res.error || 'Delete failed');
        return; // keep the protection modal open so the admin can retry
      }
      toast.success(force ? `${m.full_name} deleted — their leads are back in the pool` : `${m.full_name} deleted`);
      setDeleteTarget(null);
      await load();
    } finally {
      setBusyId(null);
      setDeleteBusy(false);
    }
  };



  const handlePinReset = async () => {
    if (!pinResetMember || pinBusy) return;
    if (!/^\d{6,8}$/.test(newPin.trim())) { toast.error('PIN must be 6-8 digits'); return; }
    setPinBusy(true);
    try {
      const res = await resetMemberPin(pinResetMember.id, newPin.trim());
      if (!res.ok) { toast.error(res.error || 'PIN change failed'); return; }
      toast.success(`${pinResetMember.full_name}\'s PIN changed!`);
      setPinResetMember(null);
      setNewPin('');
    } finally {
      setPinBusy(false);
    }
  };

  const handleChangeMobile = async (m: TeamProfile) => {
    const next = window.prompt(`New mobile number for ${m.full_name} (10 digits):`, m.mobile || '');
    if (next === null) return;
    const digits = next.replace(/\D/g, '');
    if (digits.length !== 10) { toast.error('Enter a valid 10-digit mobile number'); return; }
    setBusyId(m.id);
    try {
      await api.setMember(m.id, { mobile: digits });
      toast.success(`${m.full_name}\'s mobile number updated!`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Mobile change failed');
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = async (m: TeamProfile) => {
    if (!window.confirm(`Change ${m.full_name} to ${m.role === 'admin' ? 'telecaller' : 'admin'}?`)) return;
    setBusyId(m.id);
    try {
      const res = await setMemberRole(m.id, m.role === 'admin' ? 'telecaller' : 'admin');
      if (!res.ok) toast.error(res.error || 'Update failed');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Users className="text-blue-600" /> Team Management</h1>
        <p className="text-slate-500 text-sm">Create and manage telecaller accounts. Each member logs in with their mobile + PIN.</p>
      </div>
      {/* Create member card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <UserPlus className="text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">Add New Member</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="team-full-name" className="text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name</label>
              <input id="team-full-name" name="team-full-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="e.g. Rahul Sharma"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition" />
            </div>
            <div>
              <label htmlFor="team-mobile" className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mobile Number</label>
              <input id="team-mobile" name="team-mobile" type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value)}
                autoComplete="off" placeholder="9876543210"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="team-pin" className="text-xs font-bold text-slate-500 uppercase tracking-wider">Login PIN (6-8 digits)</label>
              <input id="team-pin" name="team-pin" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)}
                autoComplete="new-password" placeholder="••••••"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition" />
            </div>
            <div>
              <label htmlFor="team-role" className="text-xs font-bold text-slate-500 uppercase tracking-wider">Role</label>
              <select id="team-role" name="team-role" value={role} onChange={(e) => setRole(e.target.value as 'telecaller' | 'admin')}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition">
                <option value="telecaller">Telecaller</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <button onClick={handleCreate} disabled={creating}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg font-bold flex items-center gap-2 transition shadow-sm">
            <UserPlus size={16} /> {creating ? 'Creating…' : 'Create Account'}
          </button>
          <p className="text-xs text-slate-400">Note: New member accounts are active immediately. PIN must be 6-8 digits.</p>
        </div>
      </div>

      {/* Members list */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <ShieldCheck className="text-indigo-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">Team Members ({members.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading members…</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No members yet. Create the first account above.</div>
        ) : (
          <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Mobile</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Leads</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition">
                    <td className="px-6 py-3 font-semibold text-slate-800">
                      {m.full_name}
                      {m.id === profile?.id && <span className="ml-1 text-[10px] text-blue-600 font-bold">(YOU)</span>}
                    </td>
                    <td className="px-6 py-3 text-slate-600">{m.mobile || '—'}</td>
                    <td className="px-6 py-3">
                      <button onClick={() => changeRole(m)} disabled={m.id === profile?.id || busyId === m.id}
                        className={`text-xs font-bold px-2.5 py-1 rounded-full transition ${m.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'} hover:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed`}>
                        {m.role === 'admin' ? 'Admin' : 'Telecaller'}
                      </button>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{(m as any).lead_count ?? 0}</span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => toggleActive(m)} disabled={m.id === profile?.id || busyId === m.id}
                        title={m.is_active ? 'Deactivate' : 'Activate'}
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        <Power size={16} />
                      </button>
                      <button onClick={() => handleChangeMobile(m)} disabled={busyId === m.id}
                        title="Change Mobile Number"
                        className="p-2 rounded-lg text-sky-500 hover:bg-sky-50 hover:text-sky-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        <Smartphone size={16} />
                      </button>
                      <button onClick={() => { setNewPin(''); setPinResetMember(m); }} disabled={busyId === m.id}
                        title="Change PIN"
                        className="p-2 rounded-lg text-amber-500 hover:bg-amber-50 hover:text-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        <KeyRound size={16} />
                      </button>
                      <button onClick={() => handleDelete(m)} disabled={m.id === profile?.id || busyId === m.id}
                        title="Delete"
                        className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2.5">
            {members.map((m) => (
              <div key={m.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden av-fade-in">
                <div className="px-3.5 pt-3 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {(m.full_name || '?').slice(0, 1).toUpperCase()}
                        </span>
                        <h4 className="font-bold text-slate-900 text-[15px] leading-tight truncate">
                          {m.full_name}
                          {m.id === profile?.id && <span className="ml-1 text-[10px] text-blue-600 font-bold">(YOU)</span>}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500 font-medium mt-1">📱 {m.mobile || '—'}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{(m as any).lead_count ?? 0} leads</span>
                    </div>
                  </div>
                </div>
                <div className="px-3 pb-3 flex items-center gap-2">
                  <button onClick={() => changeRole(m)} disabled={m.id === profile?.id || busyId === m.id}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full transition flex-1 ${m.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'} hover:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed`}>
                    {m.role === 'admin' ? 'Admin' : 'Telecaller'} — tap to change
                  </button>
                </div>
                <div className="px-3 pb-3 grid grid-cols-4 gap-2">
                  <button onClick={() => toggleActive(m)} disabled={m.id === profile?.id || busyId === m.id}
                    title={m.is_active ? 'Deactivate' : 'Activate'}
                    className="flex flex-col items-center gap-0.5 py-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 active:scale-95 transition-transform disabled:opacity-40">
                    <Power size={16} /> <span className="text-[9px] font-bold">{m.is_active ? 'Deact.' : 'Activ.'}</span>
                  </button>
                  <button onClick={() => handleChangeMobile(m)} disabled={busyId === m.id}
                    title="Change Mobile"
                    className="flex flex-col items-center gap-0.5 py-2 rounded-xl bg-sky-50 text-sky-600 border border-sky-100 active:scale-95 transition-transform disabled:opacity-40">
                    <Smartphone size={16} /> <span className="text-[9px] font-bold">Mobile</span>
                  </button>
                  <button onClick={() => { setNewPin(''); setPinResetMember(m); }} disabled={busyId === m.id}
                    title="Change PIN"
                    className="flex flex-col items-center gap-0.5 py-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 active:scale-95 transition-transform disabled:opacity-40">
                    <KeyRound size={16} /> <span className="text-[9px] font-bold">PIN</span>
                  </button>
                  <button onClick={() => handleDelete(m)} disabled={m.id === profile?.id || busyId === m.id}
                    title="Delete"
                    className="flex flex-col items-center gap-0.5 py-2 rounded-xl bg-red-50 text-red-600 border border-red-100 active:scale-95 transition-transform disabled:opacity-40">
                    <Trash2 size={16} /> <span className="text-[9px] font-bold">Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      {/* Delete-protection modal — telecaller has assigned leads */}
      {deleteTarget && (
            <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-red-100 flex justify-between items-center bg-red-50 rounded-t-2xl">
              <h2 className="text-lg font-bold text-red-700 flex items-center gap-2">
                <Trash2 size={18} /> Delete blocked
              </h2>
              <button onClick={() => setDeleteTarget(null)} className="p-1 hover:bg-red-100 rounded-full" aria-label="Close">
                <X size={20} className="text-red-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700">
                <span className="font-bold">{deleteTarget.full_name}</span> ({deleteTarget.mobile || '—'}) has{' '}
                <span className="font-black text-red-600">{(deleteTarget as any).lead_count ?? 0} assigned leads</span>.
              </p>
              <p className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Transfer or unassign all leads first, then delete.
              </p>
              <p className="text-xs text-slate-500">
                Alternatively, use <span className="font-bold">"Transfer &amp; Delete"</span> — all their leads will
                automatically be unassigned (back to the pool) and then the account will be deleted. This action cannot be cancelled.
              </p>
            </div>
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}
                className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => { setDeleteBusy(true); void doDelete(deleteTarget, true); }} disabled={deleteBusy}
                className="px-5 py-2 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-60 flex items-center gap-2">
                <Trash2 size={15} /> {deleteBusy ? 'Deleting…' : 'Transfer & Delete'}
              </button>
            </div>
          </div>
        </div>
    </ModalPortal>
      )}

      {/* Change PIN modal */}
      {pinResetMember && (
            <ModalPortal>
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between flex-wrap gap-2 items-center">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <KeyRound className="text-amber-500" size={18} /> PIN Change
              </h2>
              <button onClick={() => setPinResetMember(null)} className="p-1 hover:bg-slate-100 rounded-full">
                <X size={20} className="text-slate-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Set a new login PIN for <span className="font-bold">{pinResetMember.full_name}</span> ({pinResetMember.mobile || '—'}).
                They will use this PIN to log in.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">New PIN (6-8 digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  autoFocus
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setPinResetMember(null)} className="px-5 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-200 transition">
                Cancel
              </button>
              <button onClick={handlePinReset} disabled={pinBusy || !newPin.trim()}
                className="px-5 py-2 rounded-lg font-bold text-white bg-amber-600 hover:bg-amber-700 transition disabled:opacity-60">
                {pinBusy ? 'Changing…' : 'Change PIN'}
              </button>
            </div>
          </div>
        </div>
    </ModalPortal>
      )}
    </div>
  );
}
