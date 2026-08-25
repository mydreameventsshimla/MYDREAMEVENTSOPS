import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../components/Shell';
import { addActivityNote, fetchActivityLog, fetchMyEnquiries, subscribeToActivityLog } from '../../lib/api';
import { useStaff } from '../../context/StaffContext';
import { ActivityLogEntry, EnquiryWithClient } from '../../types';

const ICON_BY_TYPE: Record<string, string> = {
  note: 'edit_note',
  status_change: 'sync_alt',
  claim: 'flag',
  assignment: 'swap_horiz',
  push: 'send_to_mobile',
  client_reaction: 'favorite',
  // 0021 — signals a couple sends from the client app directly.
  shortlist: 'bookmark_added',
  visit_request: 'event_available',
  callback_request: 'call',
};

const COLOR_BY_TYPE: Record<string, string> = {
  note: 'bg-slate-500',
  status_change: 'bg-[#1e293b]',
  claim: 'bg-emerald-500',
  assignment: 'bg-violet-500',
  push: 'bg-blue-500',
  client_reaction: 'bg-rose-500',
  shortlist: 'bg-amber-500',
  visit_request: 'bg-cyan-600',
  callback_request: 'bg-orange-500',
};

function formatPhone(client: EnquiryWithClient['client']): string {
  if (!client) return '—';
  if (client.phone_e164) return client.phone_e164;
  if (client.phone_number) return `${client.phone_country_code || ''} ${client.phone_number}`.trim();
  return '—';
}

function formatBudget(budget: number | null): string {
  if (budget === null || budget === undefined) return '—';
  return `₹${budget.toLocaleString('en-IN')}`;
}

export const ClientHistory: React.FC = () => {
  const { enquiryId } = useParams<{ enquiryId: string }>();
  const { staff } = useStaff();
  const navigate = useNavigate();
  const [enquiry, setEnquiry] = useState<EnquiryWithClient | null>(null);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'all' | 'note' | 'push' | 'client_signal'>('all');
  const [saving, setSaving] = useState(false);

  const loadLog = useCallback(async () => {
    if (!enquiryId) return;
    setEntries(await fetchActivityLog(enquiryId));
  }, [enquiryId]);

  useEffect(() => {
    if (!staff || !enquiryId) return;
    fetchMyEnquiries(staff.id).then((rows) => setEnquiry(rows.find((e) => e.id === enquiryId) || null));
    loadLog();
    return subscribeToActivityLog(enquiryId, loadLog);
  }, [staff, enquiryId, loadLog]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff || !enquiryId || !note.trim()) return;
    setSaving(true);
    try {
      await addActivityNote(enquiryId, staff.id, note.trim());
      setNote('');
      await loadLog();
    } finally {
      setSaving(false);
    }
  };

  const visible = entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'note') return e.type === 'note';
    if (filter === 'push') return e.type === 'push' || e.type === 'client_reaction';
    if (filter === 'client_signal') return e.type === 'shortlist' || e.type === 'visit_request' || e.type === 'callback_request';
    return true;
  });

  return (
    <Page>
      <main className="pt-16 px-8 py-8 space-y-8 max-w-4xl">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span> Back
        </button>

        <header className="space-y-2">
          <h1 className="font-geist font-semibold text-2xl">Client History</h1>
          <p className="text-slate-400">Complete timeline for {enquiry?.client?.full_name || 'this client'}.</p>
          {enquiry && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 pt-1">
              <span><span className="text-slate-400 uppercase font-semibold">Contact:</span> {formatPhone(enquiry.client)}</span>
              <span><span className="text-slate-400 uppercase font-semibold">Budget:</span> {formatBudget(enquiry.estimated_budget)}</span>
            </div>
          )}
        </header>

        <div className="flex flex-wrap gap-3">
          {(['all', 'note', 'push', 'client_signal'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full font-geist text-xs font-semibold capitalize ${filter === f ? 'bg-[#1e293b] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              {f === 'all' ? 'All Activity' : f === 'note' ? 'Notes' : f === 'push' ? 'Vendor Pushes' : 'Client Activity'}
            </button>
          ))}
        </div>

        <form onSubmit={handleAddNote} className="bg-white border border-slate-100 rounded-xl p-4 flex gap-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Log a call, an email, or any interaction…"
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
          <button disabled={saving || !note.trim()} type="submit" className="bg-[#1e293b] text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </form>

        <div className="relative ml-6 pb-16">
          <div className="absolute left-[19px] top-2 bottom-0 w-px bg-slate-200 z-0"></div>
          <div className="flex flex-col gap-6 relative z-10">
            {visible.map((entry) => (
              <div key={entry.id} className="relative flex items-start">
                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 z-10 shadow-[0_0_0_4px_#F8FAFC]">
                  <div className={`w-7 h-7 rounded-full ${COLOR_BY_TYPE[entry.type] || 'bg-slate-400'} text-white flex items-center justify-center`}>
                    <span className="material-symbols-outlined text-[14px]">{ICON_BY_TYPE[entry.type] || 'circle'}</span>
                  </div>
                </div>
                <div className="ml-5 flex-1 bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-geist font-semibold text-[10px] text-[#1e293b] uppercase">{entry.type.replace('_', ' ')}</span>
                    <span className="text-[11px] text-slate-400">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-700">{entry.content}</p>
                  {entry.actorName && <p className="text-[11px] text-slate-400 mt-1">by {entry.actorName}</p>}
                </div>
              </div>
            ))}
            {visible.length === 0 && <p className="text-sm text-slate-400 ml-5">No activity logged yet.</p>}
          </div>
        </div>
      </main>
    </Page>
  );
};
