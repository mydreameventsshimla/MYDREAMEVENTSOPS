import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Main, TopHeader, StatTile, StatusBadge } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import { claimEnquiry, fetchMyEnquiries, fetchUnclaimedEnquiries, subscribeToEnquiries } from '../../lib/api';
import { EnquiryWithClient } from '../../types';

function displayName(e: EnquiryWithClient) {
  return e.client?.full_name || 'Unnamed lead';
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export const ManagerPipeline: React.FC = () => {
  const { staff } = useStaff();
  const navigate = useNavigate();
  const [chute, setChute] = useState<EnquiryWithClient[]>([]);
  const [mine, setMine] = useState<EnquiryWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!staff) return;
    const [chuteRows, mineRows] = await Promise.all([fetchUnclaimedEnquiries(), fetchMyEnquiries(staff.id)]);
    setChute(chuteRows);
    setMine(mineRows);
    setLoading(false);
  }, [staff]);

  useEffect(() => {
    load();
    // New enquiries land here the instant a bride submits the inquiry
    // wizard on the client site — no refresh needed.
    const unsubscribe = subscribeToEnquiries(load);
    return unsubscribe;
  }, [load]);

  const handleClaim = async (enquiryId: string) => {
    setClaiming(enquiryId);
    try {
      const success = await claimEnquiry(enquiryId);
      if (!success) {
        // Someone else claimed it a moment earlier — just refresh.
        await load();
      } else {
        await load();
        navigate(`/manager/event/${enquiryId}`);
      }
    } finally {
      setClaiming(null);
    }
  };

  const active = mine.filter((e) => e.status !== 'won' && e.status !== 'lost');
  const overdue = 0; // placeholder metric; wire up to a real "last activity" timestamp when available

  return (
    <Page>
      <TopHeader title="Lead Pipeline" subtitle={`Welcome back, ${staff?.full_name.split(' ')[0]}`} />
      <Main>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatTile label="Leads Assigned" value={mine.length} icon="contact_page" />
          <StatTile label="Active Events" value={active.length} icon="event" />
          <StatTile label="Won" value={mine.filter((e) => e.status === 'won').length} icon="task_alt" />
          <StatTile label="Unclaimed in Chute" value={chute.length} tone="dark" icon="inbox" />
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-geist font-semibold text-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-500">inbox</span> Available Leads Chute
            </h2>
            <span className="text-xs text-slate-400">First to claim gets the lead — updates live.</span>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : chute.length === 0 ? (
            <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-6">No unclaimed enquiries right now.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {chute.map((e) => (
                <div key={e.id} className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col hover:shadow-md transition-all overflow-hidden">
                  <div className="p-6 border-b border-slate-50 space-y-3">
                    <div className="flex justify-between items-start">
                      <StatusBadge status="new" />
                      <span className="text-[10px] text-slate-400">{timeAgo(e.created_at)}</span>
                    </div>
                    <h3 className="font-geist font-semibold text-base">{displayName(e)}</h3>
                    <p className="text-xs text-slate-400">{e.destination || 'Destination not set'} · {e.guest_bracket || '—'}</p>
                  </div>
                  <div className="p-6 space-y-3 flex-1 flex flex-col justify-end">
                    <button
                      onClick={() => handleClaim(e.id)}
                      disabled={claiming === e.id}
                      className="w-full bg-[#1e293b] text-white py-3 rounded-lg font-bold text-sm hover:bg-slate-800 transition-all disabled:opacity-60"
                    >
                      {claiming === e.id ? 'Claiming…' : 'CLAIM & LOCK'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-geist font-semibold text-lg flex items-center gap-2">
            <span className="material-symbols-outlined text-[#1e293b]">groups</span> My Leads
          </h2>
          <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
            {mine.length === 0 && <p className="text-sm text-slate-400 p-6">Claim a lead from the chute above to get started.</p>}
            {mine.map((e) => (
              <button
                key={e.id}
                onClick={() => navigate(`/manager/event/${e.id}`)}
                className="w-full text-left flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-slate-500">
                    <span className="material-symbols-outlined text-[18px]">person</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-geist font-semibold text-sm truncate">{displayName(e)}</p>
                    <p className="text-xs text-slate-400 truncate">{e.destination || '—'} · {e.event_date_text || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <StatusBadge status={e.status} />
                  <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </Main>
    </Page>
  );
};
