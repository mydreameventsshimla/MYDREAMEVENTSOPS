import React, { useCallback, useEffect, useState } from 'react';
import { EnquiryWithClient, EnquiryTask, Proposal, GuestRow, EnquiryPayment, ActivityLogEntry, EventFunction, ConfirmedVendor } from '../types';
import {
  fetchTasksForEnquiry, subscribeToMyTasks,
  fetchProposalsForEnquiry, subscribeToProposals,
  fetchGuestsForEnquiryStaff, subscribeToGuestsStaff,
  fetchPaymentsForEnquiry, subscribeToPayments,
  fetchActivityLog, subscribeToActivityLog,
  fetchFunctionsForEnquiry, subscribeToFunctions,
  fetchConfirmedVendors, subscribeToConfirmedVendors,
} from '../lib/api';
import { StatusStepper } from './StatusStepper';
import { TasksPanel } from './TasksPanel';

const ICON_BY_TYPE: Record<string, string> = {
  note: 'edit_note', status_change: 'sync_alt', claim: 'flag', assignment: 'swap_horiz',
  push: 'send_to_mobile', client_reaction: 'favorite', shortlist: 'bookmark_added',
  visit_request: 'event_available', callback_request: 'call', proposal: 'description',
};

function formatPhone(client: EnquiryWithClient['client']): string {
  if (!client) return '—';
  if (client.phone_e164) return client.phone_e164;
  if (client.phone_number) return `${client.phone_country_code || ''} ${client.phone_number}`.trim();
  return '—';
}
function money(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}
function daysAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

interface Props {
  enquiry: EnquiryWithClient;
  staffId: string;
  onStatusChange: (status: EnquiryWithClient['status']) => void;
  onOpenGuests: () => void;
  onOpenBudget: () => void;
  onOpenProposals: () => void;
  onOpenItinerary: () => void;
  onOpenVendors: () => void;
  onOpenHistory: () => void;
  onNotify: () => void;
  onConfirmDate: () => void;
}

export const OverviewPanel: React.FC<Props> = ({
  enquiry, staffId, onStatusChange, onOpenGuests, onOpenBudget, onOpenProposals, onOpenItinerary, onOpenVendors, onOpenHistory, onNotify, onConfirmDate,
}) => {
  const [tasks, setTasks] = useState<EnquiryTask[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [payments, setPayments] = useState<EnquiryPayment[]>([]);
  const [functions, setFunctions] = useState<EventFunction[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [vendors, setVendors] = useState<ConfirmedVendor[]>([]);

  const enquiryId = enquiry.id;

  const loadTasks = useCallback(async () => setTasks((await fetchTasksForEnquiry(enquiryId)).filter((t) => t.status === 'pending')), [enquiryId]);
  const loadProposals = useCallback(async () => setProposals(await fetchProposalsForEnquiry(enquiryId)), [enquiryId]);
  const loadGuests = useCallback(async () => setGuests(await fetchGuestsForEnquiryStaff(enquiryId)), [enquiryId]);
  const loadPayments = useCallback(async () => setPayments(await fetchPaymentsForEnquiry(enquiryId)), [enquiryId]);
  const loadActivity = useCallback(async () => setActivity((await fetchActivityLog(enquiryId)).slice(0, 4)), [enquiryId]);
  const loadFunctions = useCallback(async () => setFunctions(await fetchFunctionsForEnquiry(enquiryId)), [enquiryId]);
  const loadVendors = useCallback(async () => setVendors(await fetchConfirmedVendors(enquiryId)), [enquiryId]);

  useEffect(() => { loadTasks(); return subscribeToMyTasks(staffId, loadTasks); }, [loadTasks, staffId]);
  useEffect(() => { loadProposals(); return subscribeToProposals(enquiryId, loadProposals); }, [loadProposals, enquiryId]);
  useEffect(() => { loadGuests(); return subscribeToGuestsStaff(enquiryId, loadGuests); }, [loadGuests, enquiryId]);
  useEffect(() => { loadPayments(); return subscribeToPayments(enquiryId, loadPayments); }, [loadPayments, enquiryId]);
  useEffect(() => { loadActivity(); return subscribeToActivityLog(enquiryId, loadActivity); }, [loadActivity, enquiryId]);
  useEffect(() => { loadFunctions(); return subscribeToFunctions(enquiryId, loadFunctions); }, [loadFunctions, enquiryId]);
  useEffect(() => { loadVendors(); return subscribeToConfirmedVendors(enquiryId, loadVendors); }, [loadVendors, enquiryId]);

  const attending = guests.filter((g) => g.rsvp_status === 'attending');
  const headcount = attending.reduce((s, g) => s + 1 + (g.plus_ones || 0), 0);
  const collected = payments.filter((p) => p.kind === 'client_payment' && p.status === 'received').reduce((s, p) => s + p.amount, 0);
  const pendingFromClient = payments.filter((p) => p.kind === 'client_payment' && p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const nextFunction = [...functions]
    .filter((f) => f.function_date && new Date(f.function_date).getTime() >= Date.now() - 86400000)
    .sort((a, b) => (a.function_date || '').localeCompare(b.function_date || ''))[0];

  const nextStep = computeNextStep(enquiry, tasks, proposals, functions);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Hero — who is this, and where are they in the journey */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#1e293b] text-white flex items-center justify-center font-geist font-bold text-lg shrink-0">
              {(enquiry.client?.full_name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <p className="font-geist font-bold text-xl text-[#1e293b]">{enquiry.client?.full_name || 'Unnamed lead'}</p>
              <p className="text-sm text-slate-400">{formatPhone(enquiry.client)} · {enquiry.destination || 'destination not set'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onConfirmDate} className="text-xs font-semibold text-slate-500 hover:text-[#1e293b] flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-[16px]">event</span> Confirm Date
            </button>
            <button onClick={onNotify} className="text-xs font-semibold text-slate-500 hover:text-[#1e293b] flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-[16px]">notifications</span> Notify
            </button>
          </div>
        </div>

        <StatusStepper status={enquiry.status} onChange={onStatusChange} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-50 text-sm">
          <MiniStat label="Budget" value={enquiry.estimated_budget ? money(enquiry.estimated_budget) : '—'} />
          <MiniStat label="Guests" value={enquiry.guest_bracket || '—'} />
          <MiniStat
            label="Event Date"
            value={enquiry.event_date ? new Date(enquiry.event_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : enquiry.event_date_text || 'Not confirmed'}
          />
          <MiniStat label="Venue" value={enquiry.confirmed_venue_name || '—'} />
        </div>
      </div>

      {/* The single most important thing to do next */}
      <NextStepBanner step={nextStep} onOpenProposals={onOpenProposals} onOpenBudget={onOpenBudget} onOpenItinerary={onOpenItinerary} onConfirmDate={onConfirmDate} />

      {/* Itinerary + vendors + guest + budget snapshots — four things a
          manager used to have almost no visibility into from this page. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button onClick={onOpenItinerary} className="text-left bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-geist font-semibold text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-slate-400">event_note</span> Itinerary
            </h3>
            <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
          </div>
          {functions.length === 0 ? (
            <p className="text-xs text-slate-400">No functions planned yet.</p>
          ) : (
            <>
              <p className="font-geist font-bold text-2xl text-[#1e293b]">{functions.length} <span className="text-sm font-normal text-slate-400">function{functions.length === 1 ? '' : 's'}</span></p>
              <p className="text-xs text-slate-400 mt-1">
                {nextFunction ? `Next: ${nextFunction.name}${nextFunction.function_date ? ` · ${new Date(nextFunction.function_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}` : 'Dates not set yet'}
              </p>
            </>
          )}
        </button>

        <button onClick={onOpenVendors} className="text-left bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-geist font-semibold text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-slate-400">storefront</span> Vendors
            </h3>
            <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
          </div>
          {vendors.length === 0 ? (
            <p className="text-xs text-slate-400">Nothing booked yet.</p>
          ) : (
            <>
              <p className="font-geist font-bold text-2xl text-[#1e293b]">{vendors.filter((v) => v.status !== 'cancelled').length} <span className="text-sm font-normal text-slate-400">booked</span></p>
              <p className="text-xs text-slate-400 mt-1">
                {vendors.some((v) => v.status === 'contract_pending') ? `${vendors.filter((v) => v.status === 'contract_pending').length} contract pending` : 'All confirmed'}
              </p>
            </>
          )}
        </button>

        <button onClick={onOpenGuests} className="text-left bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-geist font-semibold text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-slate-400">groups</span> Guests
            </h3>
            <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
          </div>
          {guests.length === 0 ? (
            <p className="text-xs text-slate-400">No guests added yet.</p>
          ) : (
            <>
              <p className="font-geist font-bold text-2xl text-[#1e293b]">{headcount} <span className="text-sm font-normal text-slate-400">attending</span></p>
              <p className="text-xs text-slate-400 mt-1">{guests.length} invited total</p>
            </>
          )}
        </button>

        <button onClick={onOpenBudget} className="text-left bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-geist font-semibold text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-slate-400">payments</span> Budget
            </h3>
            <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
          </div>
          <p className="font-geist font-bold text-2xl text-emerald-600">{money(collected)} <span className="text-sm font-normal text-slate-400">collected</span></p>
          <p className="text-xs text-slate-400 mt-1">{pendingFromClient > 0 ? `${money(pendingFromClient)} pending` : 'Nothing pending'}</p>
        </button>
      </div>

      {/* Follow-ups — the add/complete flow lives right here, not behind
          another tab, since this is exactly the kind of thing a manager
          should be able to act on without leaving the overview. */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Follow-ups</h3>
        <TasksPanel enquiryId={enquiryId} staffId={staffId} />
      </div>

      {/* Condensed recent activity — full timeline is one click away. */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-geist font-semibold text-sm">Recent Activity</h3>
          <button onClick={onOpenHistory} className="text-xs font-semibold text-slate-400 hover:text-[#1e293b]">Full History →</button>
        </div>
        {activity.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing logged yet.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[15px] text-slate-300 mt-0.5">{ICON_BY_TYPE[entry.type] || 'circle'}</span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-600 truncate">{entry.content}</p>
                  <p className="text-[10px] text-slate-300">{daysAgo(entry.created_at) === 0 ? 'Today' : `${daysAgo(entry.created_at)}d ago`}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-slate-400">{label}</p>
    <p className="font-semibold text-[#1e293b] truncate">{value}</p>
  </div>
);

type NextStep =
  | { kind: 'overdue'; task: EnquiryTask; extraCount: number }
  | { kind: 'awaiting_proposal'; proposal: Proposal }
  | { kind: 'upcoming'; task: EnquiryTask }
  | { kind: 'confirm_date' }
  | { kind: 'no_itinerary' }
  | { kind: 'no_proposal' }
  | { kind: 'all_clear' };

function computeNextStep(enquiry: EnquiryWithClient, tasks: EnquiryTask[], proposals: Proposal[], functions: EventFunction[]): NextStep {
  const now = Date.now();
  const overdue = tasks.filter((t) => new Date(t.due_at).getTime() < now).sort((a, b) => a.due_at.localeCompare(b.due_at));
  if (overdue.length > 0) return { kind: 'overdue', task: overdue[0], extraCount: overdue.length - 1 };

  const sentProposal = proposals.find((p) => p.status === 'sent');
  if (sentProposal) return { kind: 'awaiting_proposal', proposal: sentProposal };

  const upcoming = [...tasks].sort((a, b) => a.due_at.localeCompare(b.due_at));
  if (upcoming.length > 0) return { kind: 'upcoming', task: upcoming[0] };

  if (enquiry.status === 'won' && !enquiry.event_date) return { kind: 'confirm_date' };

  if (enquiry.status === 'won' && functions.length === 0) return { kind: 'no_itinerary' };

  if (enquiry.status !== 'won' && enquiry.status !== 'lost' && proposals.length === 0) return { kind: 'no_proposal' };

  return { kind: 'all_clear' };
}

const NextStepBanner: React.FC<{
  step: NextStep;
  onOpenProposals: () => void;
  onOpenBudget: () => void;
  onOpenItinerary: () => void;
  onConfirmDate: () => void;
}> = ({ step, onOpenProposals, onOpenBudget, onOpenItinerary, onConfirmDate }) => {
  switch (step.kind) {
    case 'overdue':
      return (
        <Banner tone="red" icon="priority_high" title={`Overdue: ${step.task.title}`}
          subtitle={`${daysAgo(step.task.due_at)}d overdue${step.extraCount > 0 ? ` · ${step.extraCount} more overdue` : ''}`} />
      );
    case 'awaiting_proposal':
      return (
        <Banner tone="blue" icon="hourglass_top" title={`Awaiting response on "${step.proposal.title}"`}
          subtitle={`Sent ${daysAgo(step.proposal.sent_at || step.proposal.created_at)}d ago`} action={{ label: 'View Proposal', onClick: onOpenProposals }} />
      );
    case 'upcoming':
      return <Banner tone="slate" icon="schedule" title={step.task.title} subtitle={`Due ${new Date(step.task.due_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`} />;
    case 'confirm_date':
      return <Banner tone="amber" icon="event" title="Confirm the event date" subtitle="This lead is Won but has no confirmed date yet" action={{ label: 'Confirm Date', onClick: onConfirmDate }} />;
    case 'no_itinerary':
      return <Banner tone="amber" icon="event_note" title="Build the itinerary" subtitle="Won, but no functions planned yet — Mehendi, Sangeet, the ceremony…" action={{ label: 'Build Itinerary', onClick: onOpenItinerary }} />;
    case 'no_proposal':
      return <Banner tone="amber" icon="description" title="No proposal sent yet" subtitle="Build one when you're ready to formalize pricing" action={{ label: 'Build Proposal', onClick: onOpenProposals }} />;
    case 'all_clear':
      return <Banner tone="emerald" icon="task_alt" title="All caught up" subtitle="Nothing urgent on this lead right now" />;
  }
};

const TONE_STYLE: Record<string, string> = {
  red: 'bg-red-50 border-red-100 text-red-700',
  blue: 'bg-blue-50 border-blue-100 text-blue-700',
  amber: 'bg-amber-50 border-amber-100 text-amber-700',
  emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
  slate: 'bg-slate-50 border-slate-100 text-slate-600',
};

const Banner: React.FC<{ tone: string; icon: string; title: string; subtitle: string; action?: { label: string; onClick: () => void } }> = ({
  tone, icon, title, subtitle, action,
}) => (
  <div className={`flex items-center gap-4 border rounded-2xl p-5 ${TONE_STYLE[tone]}`}>
    <span className="material-symbols-outlined text-[24px] shrink-0">{icon}</span>
    <div className="flex-1 min-w-0">
      <p className="font-geist font-semibold text-sm truncate">{title}</p>
      <p className="text-xs opacity-70">{subtitle}</p>
    </div>
    {action && (
      <button onClick={action.onClick} className="shrink-0 bg-white/80 hover:bg-white px-4 py-2 rounded-lg text-xs font-bold">
        {action.label}
      </button>
    )}
  </div>
);
