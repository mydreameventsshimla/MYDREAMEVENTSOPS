import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader, StatusBadge } from '../../components/Shell';
import { createRecruitmentTarget, fetchAllRecruitmentTargets, fetchStaffRoster } from '../../lib/api';
import { RecruitmentTarget, StaffProfile, VendorCategory, RecruitmentPriority } from '../../types';
import { useStaff } from '../../context/StaffContext';

const CATEGORIES: VendorCategory[] = ['venue', 'decor', 'photography', 'makeup', 'dj', 'mehendi', 'other'];

export const AdminSalesTeam: React.FC = () => {
  const { staff } = useStaff();
  const [targets, setTargets] = useState<RecruitmentTarget[]>([]);
  const [salesmen, setSalesmen] = useState<StaffProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    vendor_name: '',
    category: 'venue' as VendorCategory,
    priority: 'medium' as RecruitmentPriority,
    objective: '',
    assigned_salesman_id: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([fetchAllRecruitmentTargets(), fetchStaffRoster('salesman')]);
    setTargets(t);
    setSalesmen(s);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || !form.assigned_salesman_id) return;
    setSubmitting(true);
    try {
      await createRecruitmentTarget({ ...form, created_by: staff.id });
      setForm({ vendor_name: '', category: 'venue', priority: 'medium', objective: '', assigned_salesman_id: '' });
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const bySalesman = (id: string) => targets.filter((t) => t.assigned_salesman_id === id);

  return (
    <Page>
      <TopHeader
        title="Sales Team"
        subtitle="Vendor recruitment targets, per agent"
        right={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-emerald-600"
          >
            <span className="material-symbols-outlined text-[16px]">add</span> New Target
          </button>
        }
      />
      <Main>
        {showForm && (
          <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-100 p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Vendor Name</label>
              <input required value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Assign To</label>
              <select required value={form.assigned_salesman_id} onChange={(e) => setForm({ ...form, assigned_salesman_id: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none">
                <option value="" disabled>Choose sales agent…</option>
                {salesmen.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as VendorCategory })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none capitalize">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as RecruitmentPriority })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none capitalize">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Objective</label>
              <textarea value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none resize-none" rows={2} placeholder="e.g. Negotiate 15% commission and secure an exclusive package" />
            </div>
            <button disabled={submitting} type="submit" className="md:col-span-2 bg-[#1e293b] text-white py-3 rounded-lg font-bold text-sm hover:bg-slate-800 disabled:opacity-60">
              {submitting ? 'Assigning…' : 'Assign Target'}
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {salesmen.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-geist font-semibold text-sm">{s.full_name}</p>
                  <p className="text-xs text-slate-400">{s.email}</p>
                </div>
                <span className="bg-primary/5 text-[#1e293b] px-3 py-1 rounded-full text-xs font-bold bg-slate-100">{bySalesman(s.id).length} targets</span>
              </div>
              <div className="space-y-2">
                {bySalesman(s.id).map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2 last:border-0">
                    <span className="truncate">{t.vendor_name}</span>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
                {bySalesman(s.id).length === 0 && <p className="text-xs text-slate-400">No targets assigned yet.</p>}
              </div>
            </div>
          ))}
          {salesmen.length === 0 && <p className="text-sm text-slate-400">No sales agents on staff yet.</p>}
        </div>
      </Main>
    </Page>
  );
};
