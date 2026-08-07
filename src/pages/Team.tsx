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
import { useAuth } from '../context/AuthContext';

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

  const load = async () => {
    setLoading(true);
    const list = await listTeamMembers();
    setMembers(list);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (creating) return;
    const digits = mobile.replace(/\D/g, '');
    if (!name.trim()) { toast.error('Naam daalein'); return; }
    if (digits.length < 10) { toast.error('Sahi 10-digit mobile number daalein'); return; }
    if (!/^\d{6,8}$/.test(pin.trim())) { toast.error('PIN 6-8 digits ka hona chahiye'); return; }
    setCreating(true);
    try {
      const res = await createTeamMember(name.trim(), digits, pin.trim(), role);
      if (!res.ok) { toast.error(res.error || 'Account banane mein problem hui'); return; }
      if (role === 'admin' && res.userId) {
        const promote = await setMemberRole(res.userId, 'admin');
        if (!promote.ok) toast.error('Account bana, lekin admin promote nahi ho paya: ' + (promote.error || ''));
      }
      toast.success('Account ban gaya! Member ab login kar sakta hai.');
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
      if (!res.ok) toast.error(res.error || 'Update fail hua');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (m: TeamProfile) => {

    if (m.id === profile?.id) return;

    if (!window.confirm(`${m.full_name} (${m.mobile}) ko DELETE karna hai? Ye member turant logout ho jayega aur login nahi kar payega.`)) return;

    setBusyId(m.id);

    try {

      const res = await deleteMember(m.id);

      if (!res.ok) toast.error(res.error || 'Delete fail hua');

      else toast.success(`${m.full_name} delete ho gaya`);

      await load();

    } finally {

      setBusyId(null);

    }

  };



  const handlePinReset = async () => {
    if (!pinResetMember || pinBusy) return;
    if (!/^\d{6,8}$/.test(newPin.trim())) { toast.error('PIN 6-8 digits ka hona chahiye'); return; }
    setPinBusy(true);
    try {
      const res = await resetMemberPin(pinResetMember.id, newPin.trim());
      if (!res.ok) { toast.error(res.error || 'PIN change nahi hua'); return; }
      toast.success(`${pinResetMember.full_name} ka PIN change ho gaya!`);
      setPinResetMember(null);
      setNewPin('');
    } finally {
      setPinBusy(false);
    }
  };

  const changeRole = async (m: TeamProfile) => {
    if (!window.confirm(`${m.full_name} ko ${m.role === 'admin' ? 'telecaller' : 'admin'} banana hai?`)) return;
    setBusyId(m.id);
    try {
      const res = await setMemberRole(m.id, m.role === 'admin' ? 'telecaller' : 'admin');
      if (!res.ok) toast.error(res.error || 'Update fail hua');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Users className="text-blue-600" /> Team Management</h1>
        <p className="text-slate-500 text-sm">Telecaller accounts banayein aur manage karein. Har member apne mobile + PIN se login karega.</p>
      </div>
      {/* Create member card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <UserPlus className="text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-800 font-sans">Naya Member Add Karein</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mobile Number</label>
              <input type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value)}
                placeholder="9876543210"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Login PIN (6-8 digits)</label>
              <input type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as 'telecaller' | 'admin')}
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
          <p className="text-xs text-slate-400">Note: Naye member ka account turant active hota hai. PIN 6-8 digits ka hona chahiye.</p>
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
          <div className="p-8 text-center text-slate-400 text-sm">Abhi koi member nahi hai. Upar se pehla account banayein.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Mobile</th>
                  <th className="px-6 py-3">Role</th>
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
                      <button onClick={() => { setNewPin(''); setPinResetMember(m); }} disabled={busyId === m.id}
                        title="PIN Change Karein"
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
            </table>
          </div>
        )}
      </div>

      {/* Change PIN modal */}
      {pinResetMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <KeyRound className="text-amber-500" size={18} /> PIN Change
              </h2>
              <button onClick={() => setPinResetMember(null)} className="p-1 hover:bg-slate-100 rounded-full">
                <X size={20} className="text-slate-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                <span className="font-bold">{pinResetMember.full_name}</span> ({pinResetMember.mobile || '—'}) ka naya login PIN daalein.
                Is PIN se woh login karega.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Naya PIN (6-8 digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
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
                {pinBusy ? 'Change ho raha hai…' : 'PIN Change Karein'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
