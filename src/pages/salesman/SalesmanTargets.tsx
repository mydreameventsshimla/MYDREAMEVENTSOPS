import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

        {/* This was a single button pointing at `#/salesman/onboard` — a hash
            href under BrowserRouter, so it set the URL fragment and navigated
            nowhere. Rebuilt as the actual choice an agent has, because "add a
            vendor" isn't one action: it depends entirely on how much you
            already have in hand. Each card states its review cost up front so
            nobody picks the two-gate path by accident. */}
        <section className="bg-[#1e293b] text-white rounded-3xl p-10 shadow-xl space-y-7">
          <div className="space-y-2 max-w-xl">
            <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Independent Outreach</span>
            <h2 className="text-3xl font-geist font-bold">Expand the Network</h2>
            <p className="text-white/70 text-sm">
              Found vendors yourself? Add them here. Pick whichever matches what you've got right now —
              nothing goes live until an admin approves it.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <OutreachCard
              to="/salesman/listings"
              icon="storefront"
              title="Build a full profile"
              body="You have the photos, pricing and capacity. Fill it in and submit."
              meta="One admin review"
              primary
            />
            <OutreachCard
              to="/salesman/onboard"
              icon="bolt"
              title="Capture a quick lead"
              body="Just a name and a number. Get sign-off first, build the profile later."
              meta="Approval, then profile"
            />
            <OutreachCard
              to="/salesman/import"
              icon="upload_file"
              title="Import a spreadsheet"
              body="A CSV of vendors, or a ZIP with their photos. Up to 200 at once."
              meta="One review each"
            />
          </div>
        </section>
      </Main>
    </Page>
  );
};

const OutreachCard: React.FC<{
  to: string;
  icon: string;
  title: string;
  body: string;
  meta: string;
  primary?: boolean;
}> = ({ to, icon, title, body, meta, primary }) => (
  <Link
    to={to}
    className={`rounded-2xl p-6 flex flex-col gap-2 transition-all group ${
      primary
        ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg'
        : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
    }`}
  >
    <span className="material-symbols-outlined text-2xl">{icon}</span>
    <span className="font-geist font-bold">{title}</span>
    <span className={`text-xs leading-relaxed ${primary ? 'text-white/80' : 'text-white/60'}`}>{body}</span>
    <span
      className={`text-[10px] font-bold uppercase tracking-widest mt-auto pt-3 inline-flex items-center gap-1 ${
        primary ? 'text-white/70' : 'text-emerald-400'
      }`}
    >
      {meta}
      <span className="material-symbols-outlined text-[14px] group-hover:translate-x-0.5 transition-transform">
        arrow_forward
      </span>
    </span>
  </Link>
);
