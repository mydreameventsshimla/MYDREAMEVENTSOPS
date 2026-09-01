import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GuestRow, RsvpStatus, GuestSide, GuestAccommodation } from '../types';
import {
  fetchGuestsForEnquiryStaff, subscribeToGuestsStaff, updateGuestStaff,
  fetchAccommodationsForGuests, upsertAccommodation, deleteAccommodation, subscribeToAccommodations,
} from '../lib/api';

// A couple manages their own guest list (add, invite, remove) from their
// dashboard — this panel doesn't duplicate that. What it DOES let a
// planner do: see every guest in depth, correct/complete any field by
// hand (a phone number read wrong over a call, a side never set,
// dietary notes the couple forgot to add), and assign a room — all from
// one click on the guest, not gated behind a flag the couple may not
// have set. Room assignment (guest_accommodations, 0027) has no
// couple-facing equivalent at all.

const RSVP_LABEL: Record<RsvpStatus, string> = {
  pending: 'Pending', attending: 'Attending', not_attending: 'Not Attending', maybe: 'Maybe',
};
const RSVP_COLOR: Record<RsvpStatus, string> = {
  pending: 'bg-slate-100 text-slate-500',
  attending: 'bg-emerald-50 text-emerald-700',
  not_attending: 'bg-red-50 text-red-500',
  maybe: 'bg-amber-50 text-amber-600',
};
const SIDE_LABEL: Record<string, string> = { bride: "Bride's Side", groom: "Groom's Side", both: 'Both Sides' };

type TravelFilter = 'all' | 'needs_accommodation' | 'needs_transport';

interface Props {
  enquiryId: string;
}

export const GuestsManagerPanel: React.FC<Props> = ({ enquiryId }) => {
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [accommodations, setAccommodations] = useState<GuestAccommodation[]>([]);
  const [query, setQuery] = useState('');
  const [rsvpFilter, setRsvpFilter] = useState<RsvpStatus | 'all'>('all');
  const [sideFilter, setSideFilter] = useState<GuestSide | 'all'>('all');
  const [travelFilter, setTravelFilter] = useState<TravelFilter>('all');
  const [editingGuest, setEditingGuest] = useState<GuestRow | null>(null);

  const load = useCallback(async () => {
    const rows = await fetchGuestsForEnquiryStaff(enquiryId);
    setGuests(rows);
    setAccommodations(await fetchAccommodationsForGuests(rows.map((g) => g.id)));
  }, [enquiryId]);

  useEffect(() => {
    load();
    return subscribeToGuestsStaff(enquiryId, load);
  }, [load, enquiryId]);

  useEffect(() => subscribeToAccommodations(load), [load]);

  const accommodationByGuest = useMemo(
    () => new Map(accommodations.map((a) => [a.guest_id, a])),
    [accommodations]
  );

  // Keep the open modal's guest in sync with fresh data (e.g. a realtime
  // update from another tab) instead of showing a stale snapshot.
  useEffect(() => {
    if (!editingGuest) return;
    const fresh = guests.find((g) => g.id === editingGuest.id);
    if (fresh && fresh !== editingGuest) setEditingGuest(fresh);
  }, [guests, editingGuest]);

  const attending = guests.filter((g) => g.rsvp_status === 'attending');
  const headcount = attending.reduce((s, g) => s + 1 + (g.plus_ones || 0), 0);
  const needAccommodation = attending.filter((g) => g.needs_accommodation);
  const needTransport = attending.filter((g) => g.needs_transport);
  const unassignedAccommodation = needAccommodation.filter((g) => !accommodationByGuest.has(g.id));

  const nextArrival = useMemo(() => {
    const withDates = attending.filter((g) => g.arrival_date).sort((a, b) => (a.arrival_date || '').localeCompare(b.arrival_date || ''));
    return withDates[0] || null;
  }, [attending]);

  const visible = guests.filter((g) => {
    if (rsvpFilter !== 'all' && g.rsvp_status !== rsvpFilter) return false;
    if (sideFilter !== 'all' && g.side !== sideFilter) return false;
    if (travelFilter === 'needs_accommodation' && !g.needs_accommodation) return false;
    if (travelFilter === 'needs_transport' && !g.needs_transport) return false;
    if (query.trim() && !g.full_name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatTile label="Invited" value={guests.length} />
        <StatTile label="Attending Headcount" value={headcount} tone="emerald" />
        <StatTile label="Bride's Side" value={guests.filter((g) => g.side === 'bride').length} />
        <StatTile label="Groom's Side" value={guests.filter((g) => g.side === 'groom').length} />
        <StatTile label="Need Rooms" value={needAccommodation.length} tone={unassignedAccommodation.length > 0 ? 'amber' : undefined} />
        <StatTile label="Need Pickup" value={needTransport.length} />
      </div>

      {nextArrival && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-blue-700">
          <span className="material-symbols-outlined text-[18px]">flight_land</span>
          Next arrival: <strong>{nextArrival.full_name}</strong> on {new Date(nextArrival.arrival_date!).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          {nextArrival.arrival_time && ` at ${nextArrival.arrival_time.slice(0, 5)}`}
        </div>
      )}
      {unassignedAccommodation.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-amber-700">
          <span className="material-symbols-outlined text-[18px]">bed</span>
          {unassignedAccommodation.length} guest{unassignedAccommodation.length === 1 ? '' : 's'} need a room but {unassignedAccommodation.length === 1 ? 'has' : 'have'} no assignment yet.
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guests…"
          className="flex-1 min-w-[180px] px-3.5 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <FilterPills value={sideFilter} onChange={setSideFilter} options={[
          { id: 'all', label: 'All Sides' }, { id: 'bride', label: "Bride's" }, { id: 'groom', label: "Groom's" }, { id: 'both', label: 'Both' },
        ]} />
        <FilterPills value={rsvpFilter} onChange={setRsvpFilter} options={[
          { id: 'all', label: 'All RSVPs' }, { id: 'attending', label: 'Attending' }, { id: 'pending', label: 'Pending' }, { id: 'not_attending', label: 'Declined' },
        ]} />
        <FilterPills value={travelFilter} onChange={setTravelFilter} options={[
          { id: 'all', label: 'All Travel' }, { id: 'needs_accommodation', label: 'Needs Room' }, { id: 'needs_transport', label: 'Needs Pickup' },
        ]} />
      </div>

      {guests.length === 0 ? (
        <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-8 text-center">
          No guests added yet — the couple builds this list themselves from their own dashboard.
        </p>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-50 overflow-hidden">
          {visible.length === 0 && <p className="text-sm text-slate-400 p-6">No guests match this filter.</p>}
          {visible.map((g) => {
            const stay = accommodationByGuest.get(g.id);
            return (
              <button
                key={g.id}
                onClick={() => setEditingGuest(g)}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50/80 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[11px] font-bold text-slate-500">
                  {g.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-700 truncate">{g.full_name}</p>
                    {g.relation && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 shrink-0">{g.relation}</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {g.side ? SIDE_LABEL[g.side] : 'Side not set'}
                    {g.coming_from && ` · from ${g.coming_from}`}
                    {g.dietary_notes && ` · ${g.dietary_notes}`}
                  </p>
                  {(g.arrival_date || g.needs_accommodation || g.needs_transport) && (
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {g.arrival_date && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[11px]">flight_land</span>
                          {new Date(g.arrival_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {g.needs_accommodation && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 ${stay ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          <span className="material-symbols-outlined text-[11px]">bed</span>
                          {stay ? `${stay.hotel_name || 'Assigned'}${stay.room_number ? ` · ${stay.room_number}` : ''}` : 'Room needed'}
                        </span>
                      )}
                      {g.needs_transport && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[11px]">local_taxi</span> Pickup needed
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {g.phone && <span className="text-[11px] text-slate-400 hidden sm:inline shrink-0">{g.phone}</span>}
                <span className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${RSVP_COLOR[g.rsvp_status]}`}>
                  {RSVP_LABEL[g.rsvp_status]}{g.rsvp_status === 'attending' && g.plus_ones > 0 ? ` +${g.plus_ones}` : ''}
                </span>
                <span className="material-symbols-outlined text-[16px] text-slate-300 shrink-0">chevron_right</span>
              </button>
            );
          })}
        </div>
      )}

      {editingGuest && (
        <GuestDetailModal
          guest={editingGuest}
          existingStay={accommodationByGuest.get(editingGuest.id) || null}
          onClose={() => setEditingGuest(null)}
          onSaved={load}
        />
      )}
    </div>
  );
};

const StatTile: React.FC<{ label: string; value: number; tone?: 'emerald' | 'amber' }> = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-100 rounded-xl p-4">
    <p className={`text-xl font-geist font-bold ${tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-[#1e293b]'}`}>{value}</p>
    <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">{label}</p>
  </div>
);

function FilterPills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex bg-slate-50 rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
            value === o.id ? 'bg-white shadow-sm text-[#1e293b]' : 'text-slate-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FIELD = 'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm';
const LABEL = 'text-[10px] font-bold text-slate-400 uppercase tracking-wide';

// Everything a planner might need to fix or fill in about one guest —
// their info, their travel plans, and their room — in one place, reached
// by clicking the guest directly (no separate flag gating any of it).
const GuestDetailModal: React.FC<{
  guest: GuestRow;
  existingStay: GuestAccommodation | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ guest, existingStay, onClose, onSaved }) => {
  const [tab, setTab] = useState<'info' | 'room'>('info');

  const [fullName, setFullName] = useState(guest.full_name);
  const [relation, setRelation] = useState(guest.relation || '');
  const [side, setSide] = useState<GuestSide | ''>(guest.side || '');
  const [comingFrom, setComingFrom] = useState(guest.coming_from || '');
  const [phone, setPhone] = useState(guest.phone || '');
  const [email, setEmail] = useState(guest.email || '');
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>(guest.rsvp_status);
  const [plusOnes, setPlusOnes] = useState(guest.plus_ones.toString());
  const [dietaryNotes, setDietaryNotes] = useState(guest.dietary_notes || '');
  const [arrivalDate, setArrivalDate] = useState(guest.arrival_date || '');
  const [arrivalTime, setArrivalTime] = useState(guest.arrival_time || '');
  const [departureDate, setDepartureDate] = useState(guest.departure_date || '');
  const [needsAccommodation, setNeedsAccommodation] = useState(guest.needs_accommodation);
  const [needsTransport, setNeedsTransport] = useState(guest.needs_transport);
  const [travelNotes, setTravelNotes] = useState(guest.travel_notes || '');
  const [savingInfo, setSavingInfo] = useState(false);

  const [hotelName, setHotelName] = useState(existingStay?.hotel_name || '');
  const [roomType, setRoomType] = useState(existingStay?.room_type || '');
  const [roomNumber, setRoomNumber] = useState(existingStay?.room_number || '');
  const [checkIn, setCheckIn] = useState(existingStay?.check_in || guest.arrival_date || '');
  const [checkOut, setCheckOut] = useState(existingStay?.check_out || guest.departure_date || '');
  const [roomNotes, setRoomNotes] = useState(existingStay?.notes || '');
  const [savingRoom, setSavingRoom] = useState(false);

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSavingInfo(true);
    try {
      await updateGuestStaff(guest.id, {
        full_name: fullName.trim(),
        relation: relation.trim() || null,
        side: side || null,
        coming_from: comingFrom.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        rsvp_status: rsvpStatus,
        plus_ones: Number(plusOnes) || 0,
        dietary_notes: dietaryNotes.trim() || null,
        arrival_date: arrivalDate || null,
        arrival_time: arrivalTime || null,
        departure_date: departureDate || null,
        needs_accommodation: needsAccommodation,
        needs_transport: needsTransport,
        travel_notes: travelNotes.trim() || null,
      });
      onSaved();
      onClose();
    } finally {
      setSavingInfo(false);
    }
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRoom(true);
    try {
      await upsertAccommodation({
        id: existingStay?.id,
        guestId: guest.id,
        hotelName, roomType, roomNumber,
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        notes: roomNotes,
      });
      onSaved();
      onClose();
    } finally {
      setSavingRoom(false);
    }
  };

  const handleRemoveRoom = async () => {
    if (!existingStay) return;
    await deleteAccommodation(existingStay.id);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 pb-0 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="font-geist font-semibold text-base">{guest.full_name}</h3>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div className="flex gap-1 bg-slate-50 rounded-full p-1 mt-3 w-fit">
            {(['info', 'room'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-full text-[11px] font-bold ${tab === t ? 'bg-white shadow-sm text-[#1e293b]' : 'text-slate-400'}`}
              >
                {t === 'info' ? 'Guest & Travel' : 'Room'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          {tab === 'info' ? (
            <form id="guest-info-form" onSubmit={handleSaveInfo} className="space-y-3">
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" className={FIELD} />
              <div className="grid grid-cols-2 gap-2">
                <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Relation" className={FIELD} />
                <select value={side} onChange={(e) => setSide(e.target.value as GuestSide | '')} className={FIELD}>
                  <option value="">Side not set</option>
                  <option value="bride">Bride's Side</option>
                  <option value="groom">Groom's Side</option>
                  <option value="both">Both Sides</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={FIELD} />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className={FIELD} />
              </div>
              <input value={comingFrom} onChange={(e) => setComingFrom(e.target.value)} placeholder="Coming from (city)" className={FIELD} />
              <div className="grid grid-cols-2 gap-2">
                <select value={rsvpStatus} onChange={(e) => setRsvpStatus(e.target.value as RsvpStatus)} className={FIELD}>
                  {(Object.keys(RSVP_LABEL) as RsvpStatus[]).map((s) => <option key={s} value={s}>{RSVP_LABEL[s]}</option>)}
                </select>
                <input type="number" min="0" value={plusOnes} onChange={(e) => setPlusOnes(e.target.value)} placeholder="Plus ones" className={FIELD} />
              </div>
              <input value={dietaryNotes} onChange={(e) => setDietaryNotes(e.target.value)} placeholder="Dietary notes" className={FIELD} />

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <p className={LABEL}>Travel</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={LABEL}>Arrival date</label>
                    <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL}>Arrival time</label>
                    <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className={FIELD} />
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Departure date</label>
                  <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className={FIELD} />
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={needsAccommodation} onChange={(e) => setNeedsAccommodation(e.target.checked)} /> Needs a room
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={needsTransport} onChange={(e) => setNeedsTransport(e.target.checked)} /> Needs pickup
                  </label>
                </div>
                <input value={travelNotes} onChange={(e) => setTravelNotes(e.target.value)} placeholder="Travel notes (flight #, etc.)" className={FIELD} />
              </div>
            </form>
          ) : (
            <form id="guest-room-form" onSubmit={handleSaveRoom} className="space-y-3">
              {!needsAccommodation && (
                <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  This guest isn't flagged as needing a room — you can still assign one; check "Needs a room" on the Guest & Travel tab to reflect that.
                </p>
              )}
              <input value={hotelName} onChange={(e) => setHotelName(e.target.value)} placeholder="Hotel name" className={FIELD} />
              <div className="grid grid-cols-2 gap-2">
                <input value={roomType} onChange={(e) => setRoomType(e.target.value)} placeholder="Room type" className={FIELD} />
                <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="Room #" className={FIELD} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL}>Check-in</label>
                  <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Check-out</label>
                  <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={FIELD} />
                </div>
              </div>
              <input value={roomNotes} onChange={(e) => setRoomNotes(e.target.value)} placeholder="Notes" className={FIELD} />
            </form>
          )}
        </div>

        <div className="flex gap-2 p-5 pt-3 border-t border-slate-50 shrink-0">
          {tab === 'room' && existingStay && (
            <button type="button" onClick={handleRemoveRoom} className="text-xs font-semibold text-slate-400 hover:text-red-500 px-3">
              Remove room
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="border border-slate-200 text-slate-600 px-4 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-50">
            Cancel
          </button>
          <button
            form={tab === 'info' ? 'guest-info-form' : 'guest-room-form'}
            disabled={tab === 'info' ? savingInfo : savingRoom}
            type="submit"
            className="bg-[#1e293b] text-white px-5 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
          >
            {(tab === 'info' ? savingInfo : savingRoom) ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
