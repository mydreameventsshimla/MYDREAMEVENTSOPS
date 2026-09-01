import React, { useCallback, useEffect, useState } from 'react';
import { Proposal, ProposalLineItem, ProposalStatus } from '../types';
import { fetchProposalsForEnquiry, createProposal, updateProposalDraft, sendProposal, deleteProposal, subscribeToProposals } from '../lib/api';

interface Props {
  enquiryId: string;
  staffId: string;
  clientName: string;
}

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  sent: 'bg-blue-50 text-blue-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-600',
};

function money(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

const emptyLineItem: ProposalLineItem = { category: 'Venue', label: '', price: 0 };

export const ProposalPanel: React.FC<Props> = ({ enquiryId, staffId, clientName }) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setProposals(await fetchProposalsForEnquiry(enquiryId));
  }, [enquiryId]);

  useEffect(() => {
    load();
    return subscribeToProposals(enquiryId, load);
  }, [load, enquiryId]);

  const handleCreateDraft = async () => {
    setCreating(true);
    try {
      const proposal = await createProposal({
        enquiryId,
        createdBy: staffId,
        title: `Proposal for ${clientName}`,
        venueId: null,
        venueName: null,
        eventDate: null,
        lineItems: [],
      });
      await load();
      setEditing(proposal);
    } finally {
      setCreating(false);
    }
  };

  if (editing) {
    return (
      <ProposalEditor
        proposal={editing}
        enquiryId={enquiryId}
        staffId={staffId}
        onClose={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex justify-end">
        <button
          onClick={handleCreateDraft}
          disabled={creating}
          className="flex items-center gap-1.5 text-xs font-bold uppercase bg-[#1e293b] text-white px-4 py-2.5 rounded-lg hover:bg-slate-800 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]">add</span> {creating ? 'Creating…' : 'New Proposal'}
        </button>
      </div>

      {proposals.length === 0 && (
        <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-8 text-center">
          No proposals yet — build one with a venue, line items, and a total, then send it straight to the couple's dashboard.
        </p>
      )}

      <div className="space-y-3">
        {proposals.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing(p)}
            className="w-full text-left bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-geist font-semibold text-sm truncate">{p.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {p.venue_name || 'No venue set'} {p.event_date && `· ${new Date(p.event_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`}
                </p>
              </div>
              <span className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${STATUS_STYLE[p.status]}`}>{p.status}</span>
            </div>
            <p className="font-geist font-bold text-lg mt-3">{money(p.total_price || 0)}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

const ProposalEditor: React.FC<{
  proposal: Proposal;
  enquiryId: string;
  staffId: string;
  onClose: () => void;
}> = ({ proposal, enquiryId, staffId, onClose }) => {
  const [title, setTitle] = useState(proposal.title);
  const [venueName, setVenueName] = useState(proposal.venue_name || '');
  const [eventDate, setEventDate] = useState(proposal.event_date || '');
  const [lineItems, setLineItems] = useState<ProposalLineItem[]>(proposal.line_items.length ? proposal.line_items : [emptyLineItem]);
  const [notes, setNotes] = useState(proposal.notes || '');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const readOnly = proposal.status !== 'draft';
  const total = lineItems.reduce((s, li) => s + (Number(li.price) || 0), 0);

  const updateLine = (i: number, patch: Partial<ProposalLineItem>) => {
    setLineItems((prev) => prev.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProposalDraft(proposal.id, {
        title,
        venueName: venueName || null,
        venueId: null,
        eventDate: eventDate || null,
        lineItems: lineItems.filter((li) => li.label.trim()),
        notes,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    await handleSave();
    setSending(true);
    try {
      await sendProposal(proposal.id, enquiryId, staffId, title);
      onClose();
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this draft proposal?')) return;
    await deleteProposal(proposal.id);
    onClose();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span> All Proposals
        </button>
        <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${STATUS_STYLE[proposal.status]}`}>{proposal.status}</span>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={readOnly}
          className="w-full font-geist font-semibold text-lg border-none bg-transparent outline-none disabled:text-slate-400"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Venue</label>
            <input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              disabled={readOnly}
              placeholder="e.g. Oberoi Udaivilas"
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Event Date</label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              disabled={readOnly}
              className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">Line Items</label>
          {lineItems.map((li, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={li.category}
                onChange={(e) => updateLine(i, { category: e.target.value })}
                disabled={readOnly}
                placeholder="Category"
                className="w-28 shrink-0 px-2.5 py-2 border border-slate-200 rounded-lg text-xs disabled:bg-slate-50"
              />
              <input
                value={li.label}
                onChange={(e) => updateLine(i, { label: e.target.value })}
                disabled={readOnly}
                placeholder="What's included"
                className="flex-1 min-w-0 px-2.5 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50"
              />
              <input
                type="number"
                min="0"
                value={li.price || ''}
                onChange={(e) => updateLine(i, { price: Number(e.target.value) })}
                disabled={readOnly}
                placeholder="₹"
                className="w-28 shrink-0 px-2.5 py-2 border border-slate-200 rounded-lg text-sm text-right disabled:bg-slate-50"
              />
              {!readOnly && (
                <button onClick={() => setLineItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500 shrink-0">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              onClick={() => setLineItems((prev) => [...prev, { ...emptyLineItem }])}
              className="text-xs font-semibold text-slate-500 hover:text-[#1e293b] flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add</span> Add line item
            </button>
          )}
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">Notes / Terms</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={readOnly}
            rows={2}
            className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none disabled:bg-slate-50"
          />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-400 uppercase font-bold">Total</span>
          <span className="font-geist font-bold text-2xl">{money(total)}</span>
        </div>
      </div>

      {!readOnly && (
        <div className="flex gap-3">
          <button onClick={handleDelete} className="text-xs font-semibold text-slate-400 hover:text-red-500 px-4 py-3">
            Delete Draft
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={saving}
            className="border border-slate-200 text-slate-600 px-5 py-3 rounded-xl text-sm font-bold hover:bg-slate-50 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || total <= 0}
            className="bg-[#1e293b] text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send to Client'}
          </button>
        </div>
      )}

      {readOnly && (
        <p className="text-xs text-slate-400 text-center">
          {proposal.status === 'sent' && 'Waiting on the client to respond from their dashboard.'}
          {proposal.status === 'accepted' && 'The client accepted this proposal — the event is now marked Won.'}
          {proposal.status === 'rejected' && 'The client declined this proposal.'}
        </p>
      )}
    </div>
  );
};
