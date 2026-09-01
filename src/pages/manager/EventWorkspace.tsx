import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, StatusBadge } from '../../components/Shell';
import {
  addActivityNote,
  fetchMyEnquiries,
  fetchPushesForEnquiry,
  pushListingToClient,
  searchCatalog,
  subscribeToPushes,
  updateEnquiryStatus,
  fetchGuestsForEnquiryStaff,
  subscribeToGuestsStaff,
  setConfirmedEvent,
} from '../../lib/api';
import { useStaff } from '../../context/StaffContext';
import { EnquiryStatus, EnquiryWithClient, VendorPush, VendorRefTable, GuestRow } from '../../types';
import { BudgetPanel } from '../../components/BudgetPanel';
import { ProposalPanel } from '../../components/ProposalPanel';
import { NotifyClientModal } from '../../components/NotifyClientModal';
import { OverviewPanel } from '../../components/OverviewPanel';
import { GuestsManagerPanel } from '../../components/GuestsManagerPanel';
import { ItineraryPanel } from '../../components/ItineraryPanel';
import { VendorsPanel } from '../../components/VendorsPanel';

// Overview is the landing tab on purpose — everything a manager used to
// have to piece together from a cluttered header (Confirm Date / Notify /
// Full History buttons + a status dropdown, all fighting for attention
// alongside a 3-column live-call layout) now lives in one page: who this
// is, where they are in the journey, the single most urgent next step,
// and snapshots of guests/budget/activity. Call/Itinerary/Vendors/Guests/
// Budget/Proposals are focused work modes you drill into on purpose, not
// places you land.
type WorkspaceTab = 'overview' | 'call' | 'itinerary' | 'vendors' | 'guests' | 'budget' | 'proposal';
const TABS: { id: WorkspaceTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'call', label: 'Live Call', icon: 'call' },
  { id: 'itinerary', label: 'Itinerary', icon: 'event_note' },
  { id: 'vendors', label: 'Vendors', icon: 'storefront' },
  { id: 'guests', label: 'Guests', icon: 'groups' },
  { id: 'budget', label: 'Budget', icon: 'payments' },
  { id: 'proposal', label: 'Proposals', icon: 'description' },
];

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
const CATALOG_TABS: { table: VendorRefTable; label: string }[] = [
  { table: 'venues', label: 'Venues' },
  { table: 'vendors', label: 'Vendors' },
  { table: 'decor_themes', label: 'Decor' },
];

// venues/vendors have `name`; decor_themes has `title` instead — this was
// previously read as `row.name` everywhere, which is undefined for decor
// rows (blank card, and a push whose vendor_label violates the not-null
// constraint on enquiry_vendor_pushes).
function catalogRowLabel(row: any): string {
  return row.name || row.title || 'Untitled';
}

export const EventWorkspace: React.FC = () => {
  const { enquiryId } = useParams<{ enquiryId: string }>();
  const { staff } = useStaff();
  const navigate = useNavigate();

  const [enquiry, setEnquiry] = useState<EnquiryWithClient | null>(null);
  const [pushes, setPushes] = useState<VendorPush[]>([]);
  const [activeTable, setActiveTable] = useState<VendorRefTable>('venues');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
  const [showNotify, setShowNotify] = useState(false);
  const [editingEventDate, setEditingEventDate] = useState(false);
  const [eventDateDraft, setEventDateDraft] = useState('');
  const [venueDraft, setVenueDraft] = useState('');

  const loadEnquiry = useCallback(async () => {
    if (!staff || !enquiryId) return;
    const mine = await fetchMyEnquiries(staff.id);
    setEnquiry(mine.find((e) => e.id === enquiryId) || null);
  }, [staff, enquiryId]);

  const loadPushes = useCallback(async () => {
    if (!enquiryId) return;
    setPushes(await fetchPushesForEnquiry(enquiryId));
  }, [enquiryId]);

  const loadGuests = useCallback(async () => {
    if (!enquiryId) return;
    setGuests(await fetchGuestsForEnquiryStaff(enquiryId));
  }, [enquiryId]);

  useEffect(() => {
    loadEnquiry();
    loadPushes();
    loadGuests();
  }, [loadEnquiry, loadPushes, loadGuests]);

  useEffect(() => {
    if (!enquiryId) return;
    return subscribeToPushes(enquiryId, loadPushes);
  }, [enquiryId, loadPushes]);

  useEffect(() => {
    if (!enquiryId) return;
    return subscribeToGuestsStaff(enquiryId, loadGuests);
  }, [enquiryId, loadGuests]);

  useEffect(() => {
    let cancelled = false;
    // Debounced — this previously fired one query per keystroke with no
    // protection against an earlier, slower response overwriting a later
    // one; the `cancelled` flag only guarded unmount.
    const timer = setTimeout(() => {
      searchCatalog(activeTable, query)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch((err) => {
          if (!cancelled) {
            console.error('Catalog search failed:', err);
            setResults([]);
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [activeTable, query]);

  const handlePush = async (row: any) => {
    if (!enquiryId) return;
    setPushing(row.id);
    try {
      await pushListingToClient(enquiryId, activeTable, row.id, catalogRowLabel(row));
      await loadPushes();
    } finally {
      setPushing(null);
    }
  };

  const handleStatusChange = async (status: EnquiryStatus) => {
    if (!enquiryId) return;
    const previousStatus = enquiry?.status;
    setEnquiry((prev) => (prev ? { ...prev, status } : prev));
    try {
      await updateEnquiryStatus(enquiryId, status);
    } catch (err) {
      console.error('Failed to update enquiry status:', err);
      // Roll back — otherwise the dropdown shows a status the database
      // never actually accepted (e.g. rejected by RLS).
      setEnquiry((prev) => (prev && previousStatus ? { ...prev, status: previousStatus } : prev));
    }
  };

  const handleSaveConfirmedEvent = async () => {
    if (!enquiryId) return;
    await setConfirmedEvent(enquiryId, eventDateDraft || null, venueDraft || null);
    setEnquiry((prev) => (prev ? { ...prev, event_date: eventDateDraft || null, confirmed_venue_name: venueDraft || null } : prev));
    setEditingEventDate(false);
  };

  const handleSaveNote = async () => {
    if (!enquiryId || !staff || !notes.trim()) return;
    setSavingNote(true);
    try {
      await addActivityNote(enquiryId, staff.id, notes.trim());
      setNotes('');
    } finally {
      setSavingNote(false);
    }
  };

  if (!enquiry) {
    return (
      <Page>
        <div className="pt-24 px-8 text-slate-400 flex items-center gap-3">
          <button onClick={() => navigate('/manager')} className="flex items-center gap-1 text-sm hover:text-slate-600">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span> Back to pipeline
          </button>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <header className="fixed top-0 left-64 right-0 h-16 bg-white/95 backdrop-blur-md z-40 px-8 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={() => navigate('/manager')} className="text-slate-400 hover:text-slate-600">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="min-w-0">
            <div className="font-geist font-semibold text-[#1e293b] truncate">{enquiry.client?.full_name || 'Unnamed lead'}</div>
            <div className="text-xs text-slate-400 truncate">
              {enquiry.destination || '—'} ·{' '}
              {enquiry.event_date
                ? new Date(enquiry.event_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                : enquiry.event_date_text || 'no date set'}
              {enquiry.confirmed_venue_name && ` · ${enquiry.confirmed_venue_name}`}
            </div>
          </div>
        </div>
        {/* Status is a glance here, not a control — the Overview tab's
            StatusStepper is the one place it's actually changed. Confirm
            Date / Notify / Full History moved into Overview too (as
            contextual actions next to the data they act on), rather than
            sitting in global chrome that follows you into every tab. */}
        <StatusBadge status={enquiry.status} />
      </header>

      <div className="fixed top-16 left-64 right-0 h-11 bg-white border-b border-slate-100 z-30 flex items-center px-8 gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setWorkspaceTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              workspaceTab === t.id ? 'bg-slate-100 text-[#1e293b]' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {editingEventDate && (
        <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4" onClick={() => setEditingEventDate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-geist font-semibold text-base">Confirm Event Details</h3>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Event Date</label>
              <input
                type="date"
                value={eventDateDraft}
                onChange={(e) => setEventDateDraft(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Confirmed Venue</label>
              <input
                value={venueDraft}
                onChange={(e) => setVenueDraft(e.target.value)}
                placeholder="e.g. Oberoi Udaivilas"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingEventDate(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleSaveConfirmedEvent} className="flex-1 bg-[#1e293b] text-white py-2.5 rounded-lg text-sm font-bold hover:bg-slate-800">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showNotify && enquiryId && (
        <NotifyClientModal enquiryId={enquiryId} clientName={enquiry.client?.full_name || 'this client'} onClose={() => setShowNotify(false)} />
      )}

      {workspaceTab === 'overview' && staff && enquiryId && (
        <main className="pt-[108px] px-8 py-8 overflow-y-auto h-screen">
          <OverviewPanel
            enquiry={enquiry}
            staffId={staff.id}
            onStatusChange={handleStatusChange}
            onOpenGuests={() => setWorkspaceTab('guests')}
            onOpenBudget={() => setWorkspaceTab('budget')}
            onOpenProposals={() => setWorkspaceTab('proposal')}
            onOpenItinerary={() => setWorkspaceTab('itinerary')}
            onOpenVendors={() => setWorkspaceTab('vendors')}
            onOpenHistory={() => navigate(`/manager/history/${enquiryId}`)}
            onNotify={() => setShowNotify(true)}
            onConfirmDate={() => {
              setEventDateDraft(enquiry.event_date || '');
              setVenueDraft(enquiry.confirmed_venue_name || '');
              setEditingEventDate(true);
            }}
          />
        </main>
      )}

      {workspaceTab === 'itinerary' && enquiryId && (
        <main className="pt-[108px] px-8 py-8 overflow-y-auto h-screen">
          <ItineraryPanel enquiryId={enquiryId} />
        </main>
      )}

      {workspaceTab === 'vendors' && enquiryId && (
        <main className="pt-[108px] px-8 py-8 overflow-y-auto h-screen">
          <VendorsPanel enquiryId={enquiryId} clientId={enquiry?.client_id || null} />
        </main>
      )}

      {workspaceTab === 'guests' && enquiryId && (
        <main className="pt-[108px] px-8 py-8 overflow-y-auto h-screen">
          <GuestsManagerPanel enquiryId={enquiryId} />
        </main>
      )}

      {workspaceTab === 'budget' && staff && enquiryId && (
        <main className="pt-[108px] px-8 py-8 overflow-y-auto h-screen">
          <BudgetPanel enquiryId={enquiryId} staffId={staff.id} estimatedBudget={enquiry.estimated_budget} />
        </main>
      )}

      {workspaceTab === 'proposal' && staff && enquiryId && (
        <main className="pt-[108px] px-8 py-8 overflow-y-auto h-screen">
          <ProposalPanel enquiryId={enquiryId} staffId={staff.id} clientName={enquiry.client?.full_name || 'this client'} />
        </main>
      )}

      {workspaceTab === 'call' && (
      <main className="pt-[108px] flex h-screen overflow-hidden">
        {/* Client synopsis */}
        <div className="w-1/4 h-full bg-white overflow-y-auto p-6 gap-6 flex flex-col border-r border-slate-100">
          <h2 className="font-geist font-semibold text-base">Client Synopsis</h2>
          <div className="bg-slate-50 p-5 rounded-xl space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-400 text-xs uppercase">Contact</span><span className="font-semibold">{formatPhone(enquiry.client)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400 text-xs uppercase">Budget</span><span className="font-semibold">{formatBudget(enquiry.estimated_budget)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400 text-xs uppercase">Guest Bracket</span><span className="font-semibold">{enquiry.guest_bracket || '—'}</span></div>
            <div className="flex justify-between">
              <span className="text-slate-400 text-xs uppercase">RSVPs</span>
              <span className="font-semibold">
                {guests.length === 0 ? '—' : `${guests.filter((g) => g.rsvp_status === 'attending').length} attending / ${guests.length} invited`}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-slate-400 text-xs uppercase">Destination</span><span className="font-semibold">{enquiry.destination || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400 text-xs uppercase">Vision</span><span className="font-semibold text-right max-w-[140px]">{enquiry.vision_style || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400 text-xs uppercase">Source</span><span className="font-semibold capitalize">{enquiry.source.replace(/_/g, ' ')}</span></div>
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <h3 className="font-geist text-xs uppercase text-slate-400 font-semibold">Live Call Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full flex-1 bg-slate-50 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              placeholder="Real-time insights from the call…"
            />
            <button
              onClick={handleSaveNote}
              disabled={savingNote || !notes.trim()}
              className="w-full bg-[#1e293b] text-white py-2.5 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
            >
              {savingNote ? 'Saving…' : 'Save Note to Client History'}
            </button>
          </div>
        </div>

        {/* Catalog search + push */}
        <div className="w-1/2 h-full bg-white overflow-y-auto p-6 space-y-5">
          <div className="flex bg-slate-100 p-1 rounded-full w-full">
            {CATALOG_TABS.map((t) => (
              <button
                key={t.table}
                onClick={() => setActiveTable(t.table)}
                className={`flex-1 py-2 rounded-full font-geist text-xs font-semibold transition-all ${activeTable === t.table ? 'bg-white shadow-sm text-[#1e293b]' : 'text-slate-400'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${activeTable}…`}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
          <div className="space-y-4">
            {results.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No catalog matches.</p>}
            {results.map((row) => (
              <div key={row.id} className="group bg-white rounded-2xl p-4 shadow-sm hover:shadow-md border border-slate-100 flex gap-5 items-center">
                <div className="w-28 h-20 rounded-xl bg-slate-200 overflow-hidden shrink-0">
                  {row.image_url && <img src={row.image_url} className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <h3 className="font-geist font-semibold text-sm truncate">{catalogRowLabel(row)}</h3>
                  <p className="text-slate-400 text-xs truncate">{row.location || row.city || row.bio || ''}</p>
                  <div className="flex justify-between items-center pt-1">
                    <span className="font-semibold text-sm">{row.rental_fee || row.price_range || (row.price_starting ? `₹${Number(row.price_starting).toLocaleString('en-IN')}` : '')}</span>
                    <button
                      onClick={() => handlePush(row)}
                      disabled={pushing === row.id}
                      className="bg-[#1e293b] text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[14px]">send_to_mobile</span>
                      {pushing === row.id ? 'Pushing…' : 'Push to Client'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live push stream */}
        <div className="w-1/4 h-full bg-slate-50 p-6 flex flex-col gap-6 overflow-y-auto">
          <h2 className="font-geist font-semibold text-base flex items-center gap-2">
            Push Stream <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
          </h2>
          <div className="space-y-3">
            {pushes.length === 0 && <p className="text-sm text-slate-400">Nothing pushed yet this call.</p>}
            {pushes.map((p) => (
              <div key={p.id} className={`bg-white p-4 rounded-xl shadow-sm border ${p.status === 'wishlist' ? 'border-emerald-200' : p.status === 'skipped' ? 'opacity-60 border-slate-100' : 'border-slate-100'}`}>
                <div className="flex justify-between text-xs text-slate-400 mb-2">
                  <span className="truncate">{p.vendor_label}</span>
                  <span>{new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        </div>
      </main>
      )}
    </Page>
  );
};
