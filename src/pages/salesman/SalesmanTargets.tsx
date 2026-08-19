import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader, StatusBadge } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import { fetchMyRecruitmentTargets, subscribeToMyTargets, updateRecruitmentStatus } from '../../lib/api';
import { RecruitmentTarget, RecruitmentStatus } from '../../types';

const NEXT_STATUS: Record<RecruitmentStatus, RecruitmentStatus | null> = {
  assigned: 'in_progress',
  in_progress: 'negotiating',
  negotiating: 'onboarded',
  onboarded: null,
  rejected: null,
};

const ICON_BY_CATEGORY: Record<string, string> = {
  venue: 'hotel',
  decor: 'local_florist',
  photography: 'photo_camera',
  makeup: 'face_retouching_natural',
  dj: 'music_note',
  mehendi: 'brush',
  other: 'storefront',
};

export const SalesmanTargets: React.FC = () => {
  const { staff } = useStaff();
  const [targets, setTargets] = useState<RecruitmentTarget[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!staff) return;
    setTargets(await fetchMyRecruitmentTargets(staff.id));
  }, [staff]);

  useEffect(() => {
    load();
    if (!staff) return;
    return subscribeToMyTargets(staff.id, load);
  }, [staff, load]);

  const advance = async (t: RecruitmentTarget) => {
    const next = NEXT_STATUS[t.status];
    if (!next) return;
    setBusy(t.id);
    try {
      await updateRecruitmentStatus(t.id, next);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const active = targets.filter((t) => t.status !== 'onboarded' && t.status !== 'rejected');

  return (
    <Page>
      <TopHeader title="My Recruitment Targets" subtitle={`Welcome back, ${staff?.full_name.split(' ')[0]}`} />
      <Main>
        <div className="flex items-center gap-4 bg-emerald-50 p-4 rounded-xl border border-emerald-100 w-fit">
          <span className="material-symbols-outlined text-emerald-600">shield_person</span>
          <div>
            <span className="block text-[10px] font-bold text-emerald-800 uppercase">Active Role</span>
            <span className="font-geist font-semibold text-emerald-700">Vendor Recruitment Agent</span>
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-geist font-semibold text-lg flex items-center gap-2">
              <span className="material-symbols-outlined">assignment_ind</span> Admin Assigned Targets
            </h2>
            <span className="bg-slate-100 text-[#1e293b] px-3 py-1 rounded-full text-xs font-bold">{active.length} Active</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {active.map((t) => (
              <div key={t.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:-translate-y-1 transition-all space-y-5">
                <div className="flex justify-between items-start">
                  <div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${t.priority === 'high' ? 'text-red-500 bg-red-50' : t.priority === 'medium' ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>
                      {t.priority} priority
                    </span>
                    <h3 className="font-geist font-semibold text-base mt-1">{t.vendor_name}</h3>
                  </div>
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined">{ICON_BY_CATEGORY[t.category] || 'storefront'}</span>
                  </div>
                </div>
                <p className="text-sm text-slate-500">{t.objective || 'Bring this vendor onto the platform.'}</p>
                <div className="flex items-center justify-between">
                  <StatusBadge status={t.status} />
                  {NEXT_STATUS[t.status] && (
                    <button
                      onClick={() => advance(t)}
                      disabled={busy === t.id}
                      className="bg-[#1e293b] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
                    >
                      {busy === t.id ? 'Updating…' : `Mark ${NEXT_STATUS[t.status]!.replace('_', ' ')}`}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {active.length === 0 && <p className="text-sm text-slate-400">No active targets — check in with your admin.</p>}
          </div>
        </section>

        <section className="relative overflow-hidden bg-[#1e293b] text-white rounded-3xl p-10 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-xl relative z-10">
            <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Independent Outreach</span>
            <h2 className="text-3xl font-geist font-bold">Expand the Network</h2>
            <p className="text-white/70 text-sm">Found a high-value vendor yourself? Onboard them directly — they go live once an admin approves.</p>
          </div>
          <a href="#/salesman/onboard" className="relative z-10 bg-emerald-500 text-white px-8 py-4 rounded-2xl font-bold hover:scale-105 transition-all shadow-lg flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl">add_circle</span> Add Independent Vendor
          </a>
        </section>
      </Main>
    </Page>
  );
};
