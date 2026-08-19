import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader } from '../../components/Shell';
import { fetchFullStaffRoster, inviteStaffMember, setStaffActive, updateStaffRole } from '../../lib/api';
import { StaffProfile, StaffRole } from '../../types';
import { StaffProfileModal } from './StaffProfileModal';

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Admin', manager: 'Manager', salesman: 'Sales Agent' };

export const AdminTeam: React.FC = () => {
  const [roster, setRoster] = useState<StaffProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'manager' as StaffRole });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [profileStaff, setProfileStaff] = useState<StaffProfile | null>(null);

  const load = useCallback(() => {
    fetchFullStaffRoster().then(setRoster);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await inviteStaffMember(form);
      setNotice(`Invite sent to ${form.email}. They'll set a password from the email link, then sign in normally.`);
      setForm({ full_name: '', email: '', role: 'manager' });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Invite failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (staff: StaffProfile) => {
    setBusyId(staff.id);
    try {
      await setStaffActive(staff.id, !staff.is_active);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (staff: StaffProfile, role: StaffRole) => {
    if (role === staff.role) return;
    setBusyId(staff.id);
    try {
      await updateStaffRole(staff.id, role);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Page>
      <TopHeader
        title="Team"
        subtitle="Invite managers, sales agents and fellow admins — click a row to see their performance"
        right={
          <button onClick={() => setShowForm((v) => !v)} className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-emerald-600">
            <span className="material-symbols-outlined text-[16px]">person_add</span> Invite Staff
          </button>
        }
      />
      <Main>
        {notice && <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm px-4 py-3 rounded-xl">{notice}</div>}

        {showForm && (
          <form onSubmit={handleInvite} className="bg-white rounded-xl border border-slate-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Full Name</label>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none">
                <option value="manager">Manager</option>
                <option value="salesman">Sales Agent</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {error && <p className="md:col-span-3 text-sm text-red-500">{error}</p>}
            <button disabled={submitting} type="submit" className="md:col-span-3 bg-[#1e293b] text-white py-3 rounded-lg font-bold text-sm hover:bg-slate-800 disabled:opacity-60">
              {submitting ? 'Sending invite…' : 'Send Invite Email'}
            </button>
          </form>
        )}

        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Name</th>
                <th className="text-left px-6 py-3 font-semibold">Email</th>
                <th className="text-left px-6 py-3 font-semibold">Role</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {roster.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setProfileStaff(s)}>
                  <td className="px-6 py-4 font-geist font-semibold">{s.full_name}</td>
                  <td className="px-6 py-4 text-slate-500">{s.email}</td>
                  <td className="px-6 py-4" onClick={(ev) => ev.stopPropagation()}>
                    <select
                      value={s.role}
                      disabled={busyId === s.id}
                      onChange={(ev) => handleRoleChange(s, ev.target.value as StaffRole)}
                      className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="manager">{ROLE_LABEL.manager}</option>
                      <option value="salesman">{ROLE_LABEL.salesman}</option>
                      <option value="admin">{ROLE_LABEL.admin}</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${s.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {s.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right" onClick={(ev) => ev.stopPropagation()}>
                    <button
                      onClick={() => toggleActive(s)}
                      disabled={busyId === s.id}
                      className="text-xs font-semibold text-slate-500 hover:text-red-500 disabled:opacity-60"
                    >
                      {s.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-400">No staff yet — send your first invite above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Main>

      {profileStaff && <StaffProfileModal staff={profileStaff} onClose={() => setProfileStaff(null)} />}
    </Page>
  );
};
