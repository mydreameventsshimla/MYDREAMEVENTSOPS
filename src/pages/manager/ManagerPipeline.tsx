import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Main, TopHeader, StatTile, StatusBadge } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import {
  claimEnquiry, fetchMyEnquiries, fetchUnclaimedEnquiries, subscribeToEnquiries,
  fetchMyTasks, subscribeToMyTasks, fetchMyFunctionDates,
} from '../../lib/api';
import { EnquiryWithClient, EnquiryTask, EventFunction } from '../../types';
import { DashboardCalendar, CalendarEntry } from '../../components/DashboardCalendar';
import { FollowUpsPanel } from '../../components/FollowUpsPanel';

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
  const [tasks, setTasks] = useState<EnquiryTask[]>([]);
  const [functions, setFunctions] = useState<EventFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!staff) return;
    const [chuteRows, mineRows] = await Promise.all([fetchUnclaimedEnquiries(), fetchMyEnquiries(staff.id)]);
    setChute(chuteRows);
    setMine(mineRows);
    setLoading(false);
    // The individual functions (Mehendi, Sangeet…) that belong to this
    // manager's own leads — depends on `mine` having just loaded, so this
    // is a second pass rather than a parallel fetch.
    setFunctions(await fetchMyFunctionDates(mineRows.map((e) => e.id)));
  }, [staff]);

  const loadTasks = useCallback(async () => {
    if (!staff) return;
    setTasks(await fetchMyTasks(staff.id));
  }, [staff]);

  useEffect(() => {
    load();
    // New enquiries land here the instant a bride submits the inquiry
    // wizard on the client site — no refresh needed.
    const unsubscribe = subscribeToEnquiries(load);
    return unsubscribe;
  }, [load]);

  useEffect(() => {
    if (!staff) return;
    loadTasks();
    return subscribeToMyTasks(staff.id, loadTasks);
  }, [staff, loadTasks]);

  const clientNameByEnquiry = useMemo(
    () => new Map(mine.map((e) => [e.id, e.client?.full_name || 'Unnamed lead'])),
    [mine]
  );

  // One calendar entry per dated thing: an enquiry's own headline date
  // (its "when's the main day" quick-glance field) plus every individual
  // event_function date built out in that lead's Itinerary — a couple
  // with a Mehendi and a Wedding on different days shows up as two marked
  // days, not one.
  const calendarEntries: CalendarEntry[] = useMemo(() => {
    const headline: CalendarEntry[] = mine
      .filter((e) => e.event_date)
      .map((e) => ({ id: `enquiry:${e.id}`, enquiryId: e.id, date: e.event_date as string, label: displayName(e) }));
    const perFunction: CalendarEntry[] = functions
      .filter((f) => f.function_date)
      .map((f) => ({
        id: `function:${f.id}`,
        enquiryId: f.enquiry_id,
        date: f.function_date as string,
        label: `${clientNameByEnquiry.get(f.enquiry_id) || 'Unnamed lead'} — ${f.name}`,
      }));
    return [...headline, ...perFunction];
  }, [mine, functions, clientNameByEnquiry]);

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
  // Real, as of 0025 — pending follow-up tasks whose due date has passed.
  const overdue = tasks.filter((t) => t.status === 'pending' && new Date(t.due_at).getTime() < Date.now()).length;

  return (
    <Page>
      <TopHeader title="Lead Pipeline" subtitle={`Welcome back, ${staff?.full_name.split(' ')[0]}`} />
      <Main>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <StatTile label="Leads Assigned" value={mine.length} icon="contact_page" />
          <StatTile label="Active Events" value={active.length} icon="event" />
          <StatTile label="Won" value={mine.filter((e) => e.status === 'won').length} icon="task_alt" />
          <StatTile label="Overdue Follow-ups" value={overdue} tone={overdue > 0 ? 'dark' : undefined} icon="notifications_active" />
          <StatTile label="Unclaimed in Chute" value={chute.length} tone="dark" icon="inbox" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          <DashboardCalendar entries={calendarEntries} onOpenEvent={(id) => navigate(`/manager/event/${id}`)} />
          <FollowUpsPanel
            tasks={tasks}
            clientNameByEnquiry={clientNameByEnquiry}
            onOpenEnquiry={(id) => navigate(`/manager/event/${id}`)}
            onChanged={loadTasks}
          />
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
