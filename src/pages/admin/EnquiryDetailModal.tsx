import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StatusBadge } from '../../components/Shell';
import {
  addActivityNote,
  adminAssignEnquiry,
  fetchActivityLog,
  updateEstimatedBudget,
  fetchGuestsForEnquiryStaff,
  subscribeToGuestsStaff,
} from '../../lib/api';
import { ActivityLogEntry, EnquiryWithClient, StaffProfile, GuestRow } from '../../types';
import { useStaff } from '../../context/StaffContext';

const RSVP_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  attending: 'bg-emerald-50 text-emerald-600',
  not_attending: 'bg-red-50 text-red-500',
  maybe: 'bg-amber-50 text-amber-600',
};

function formatPhone(client: EnquiryWithClient['client']): string {
  if (!client) return '—';
  if (client.phone_e164) return client.phone_e164;
  if (client.phone_number) return `${client.phone_country_code || ''} ${client.phone_number}`.trim();
  return '—';
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
    <p className="text-sm text-slate-700 mt-0.5">{value || '—'}</p>
  </div>
);

export const EnquiryDetailModal: React.FC<{
  enquiry: EnquiryWithClient;
  managers: StaffProfile[];
  onClose: () => void;
  onUpdated: () => void;
}> = ({ enquiry, managers, onClose, onUpdated }) => {
  const { staff } = useStaff();
  const [budget, setBudget] = useState(enquiry.estimated_budget?.toString() || '');
  const [savingBudget, setSavingBudget] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [note, setNote] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(true);

  const loadLog = useCallback(() => {
    setLoadingLog(true);
    fetchActivityLog(enquiry.id)
      .then(setEntries)
      .finally(() => setLoadingLog(false));
  }, [enquiry.id]);

  const loadGuests = useCallback(() => {
    setLoadingGuests(true);
    fetchGuestsForEnquiryStaff(enquiry.id)
      .then(setGuests)
      .finally(() => setLoadingGuests(false));
  }, [enquiry.id]);

  useEffect(() => {
    loadLog();
    loadGuests();
    return subscribeToGuestsStaff(enquiry.id, loadGuests);
  }, [loadLog, loadGuests, enquiry.id]);

  const handleSaveBudget = async () => {
    setSavingBudget(true);
    try {
      const parsed = budget.trim() === '' ? null : Number(budget);
      await updateEstimatedBudget(enquiry.id, Number.isFinite(parsed as number) ? parsed : null);
      onUpdated();
    } finally {
      setSavingBudget(false);
    }
  };

  const handleReassign = async (managerId: string) => {
    if (!managerId) return;
    setReassigning(true);
    try {
      await adminAssignEnquiry(enquiry.id, managerId);
      onUpdated();
    } finally {
      setReassigning(false);
    }
  };

  const handleSendNote = async () => {
    if (!staff || !note.trim()) return;
    setSendingNote(true);
    try {
      await addActivityNote(enquiry.id, staff.id, note.trim());
      setNote('');
      loadLog();
    } finally {
      setSendingNote(false);
    }
  };

  return (
    <Modal title={enquiry.client?.full_name || 'Unnamed lead'} onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <StatusBadge status={enquiry.status} />
        <span className="text-xs text-slate-400">Received {new Date(enquiry.created_at).toLocaleString()}</span>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Field label="Contact Number" value={formatPhone(enquiry.client)} />
        <Field label="Email" value={enquiry.client?.email} />
        <Field label="Destination" value={enquiry.destination} />
        <Field label="Event Date" value={enquiry.event_date_text} />
        <Field label="Guest Bracket" value={enquiry.guest_bracket} />
        <Field label="Vision / Style" value={enquiry.vision_style} />
        <Field label="Service Category" value={enquiry.service_category} />
        <Field label="Source" value={enquiry.source?.replace(/_/g, ' ')} />
        <Field label="Claimed At" value={enquiry.claimed_at ? new Date(enquiry.claimed_at).toLocaleString() : '—'} />
      </div>

      {(enquiry.notes || enquiry.dream_text || enquiry.contact_raw) && (
        <div className="grid grid-cols-1 gap-4 bg-slate-50 rounded-xl p-4">
          {enquiry.dream_text && <Field label="Dream / Free-text" value={enquiry.dream_text} />}
          {enquiry.notes && <Field label="Notes" value={enquiry.notes} />}
          {enquiry.contact_raw && <Field label="Raw Contact Info" value={enquiry.contact_raw} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 pt-2 border-t border-slate-100">
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            Estimated Budget (₹) — from the client's intake form; adjust if needed
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 1500000"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={handleSaveBudget}
              disabled={savingBudget}
              className="bg-[#1e293b] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
            >
              {savingBudget ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            Manager {enquiry.manager ? `— currently ${enquiry.manager.full_name}` : '— unassigned'}
          </p>
          <select
            defaultValue=""
            disabled={reassigning}
            onChange={(e) => handleReassign(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="" disabled>{enquiry.manager ? 'Reassign to…' : 'Assign to…'}</option>
            {managers.filter((m) => m.id !== enquiry.assigned_to).map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t border-slate-100">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Send a Note to the Manager</p>
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — e.g. flag something for them to follow up on…"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={handleSendNote}
            disabled={sendingNote || !note.trim()}
            className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-600 disabled:opacity-60"
          >
            {sendingNote ? 'Sending…' : 'Send'}
          </button>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {loadingLog && <p className="text-xs text-slate-400">Loading activity…</p>}
          {!loadingLog && entries.length === 0 && <p className="text-xs text-slate-400">No activity logged yet.</p>}
          {entries.slice(0, 8).map((entry) => (
            <div key={entry.id} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
              <div className="flex justify-between text-slate-400 mb-0.5">
                <span className="font-semibold uppercase">{entry.type.replace('_', ' ')}</span>
                <span>{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              <p className="text-slate-700">{entry.content}</p>
              {entry.actorName && <p className="text-slate-400 mt-0.5">by {entry.actorName}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Guests</p>
          {guests.length > 0 && (
            <span className="text-xs text-slate-400">
              {guests.filter((g) => g.rsvp_status === 'attending').length} attending ·{' '}
              {guests.filter((g) => g.rsvp_status === 'pending').length} pending · {guests.length} total
            </span>
          )}
        </div>
        {loadingGuests && <p className="text-xs text-slate-400">Loading guest list…</p>}
        {!loadingGuests && guests.length === 0 && <p className="text-xs text-slate-400">No guests added yet — the couple manages this from their dashboard.</p>}
        {guests.length > 0 && (
          <div className="max-h-40 overflow-y-auto divide-y divide-slate-50 border border-slate-100 rounded-lg">
            {guests.map((g) => (
              <div key={g.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700 truncate">{g.full_name}</p>
                  <p className="text-slate-400 truncate">{[g.relation, g.side, g.coming_from].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${RSVP_COLOR[g.rsvp_status] || 'bg-slate-100 text-slate-500'}`}>
                  {g.rsvp_status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
