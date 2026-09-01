import React, { useCallback, useEffect, useState } from 'react';
import { EventFunction } from '../types';
import { fetchFunctionsForEnquiry, createFunction, updateFunction, deleteFunction, subscribeToFunctions, searchCatalog } from '../lib/api';

interface Props {
  enquiryId: string;
}

const COMMON_NAMES = ['Mehendi', 'Haldi', 'Sangeet', 'Wedding Ceremony', 'Reception'];

const emptyForm = { name: '', functionDate: '', startTime: '', venueId: '', venueName: '', guestCountEstimate: '', notes: '' };

export const ItineraryPanel: React.FC<Props> = ({ enquiryId }) => {
  const [functions, setFunctions] = useState<EventFunction[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [venueQuery, setVenueQuery] = useState('');
  const [venueResults, setVenueResults] = useState<{ id: string; name: string; location?: string }[]>([]);
  const [venueDropdownOpen, setVenueDropdownOpen] = useState(false);

  const load = useCallback(async () => {
    setFunctions(await fetchFunctionsForEnquiry(enquiryId));
  }, [enquiryId]);

  useEffect(() => {
    load();
    return subscribeToFunctions(enquiryId, load);
  }, [load, enquiryId]);

  // Debounced venue search — same pattern as the Live Call catalog picker.
  useEffect(() => {
    if (!venueDropdownOpen) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalog('venues', venueQuery)
        .then((rows) => {
          if (!cancelled) setVenueResults(rows as { id: string; name: string; location?: string }[]);
        })
        .catch((err) => {
          if (!cancelled) {
            console.error('Venue search failed:', err);
            setVenueResults([]);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [venueQuery, venueDropdownOpen]);

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setVenueQuery('');
    setShowForm(true);
  };

  const startEdit = (fn: EventFunction) => {
    setEditingId(fn.id);
    setForm({
      name: fn.name,
      functionDate: fn.function_date || '',
      startTime: fn.start_time || '',
      venueId: fn.venue_id || '',
      venueName: fn.venue_name || '',
      guestCountEstimate: fn.guest_count_estimate?.toString() || '',
      notes: fn.notes || '',
    });
    setVenueQuery(fn.venue_name || '');
    setShowForm(true);
  };

  const pickVenue = (v: { id: string; name: string }) => {
    setForm({ ...form, venueId: v.id, venueName: v.name });
    setVenueQuery(v.name);
    setVenueDropdownOpen(false);
  };

  const clearVenue = () => {
    setForm({ ...form, venueId: '', venueName: '' });
    setVenueQuery('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        functionDate: form.functionDate || null,
        startTime: form.startTime || null,
        venueId: form.venueId || null,
        venueName: form.venueName.trim() || null,
        guestCountEstimate: form.guestCountEstimate ? Number(form.guestCountEstimate) : null,
        notes: form.notes.trim(),
      };
      if (editingId) {
        await updateFunction(editingId, payload);
      } else {
        await createFunction({ ...payload, enquiryId, displayOrder: functions.length });
      }
      setShowForm(false);
      setForm(emptyForm);
      setVenueQuery('');
      setEditingId(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this function from the itinerary?')) return;
    await deleteFunction(id);
    await load();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-400">
          {functions.length === 0 ? 'No functions planned yet' : `${functions.length} function${functions.length === 1 ? '' : 's'} planned`}
        </p>
        <button
          onClick={startAdd}
          className="flex items-center gap-1.5 text-xs font-bold uppercase bg-[#1e293b] text-white px-4 py-2.5 rounded-lg hover:bg-slate-800"
        >
          <span className="material-symbols-outlined text-[16px]">add</span> Add Function
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white border border-slate-100 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            list="function-names"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Function name (e.g. Sangeet)"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2"
          />
          <datalist id="function-names">
            {COMMON_NAMES.map((n) => <option key={n} value={n} />)}
          </datalist>

          <input
            type="date"
            value={form.functionDate}
            onChange={(e) => setForm({ ...form, functionDate: e.target.value })}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          />
          <input
            type="time"
            value={form.startTime}
            onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          />

          <div className="relative">
            {form.venueId ? (
              <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2.5 text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="material-symbols-outlined text-[15px] text-emerald-600">verified</span>
                  <span className="truncate">{form.venueName}</span>
                </span>
                <button type="button" onClick={clearVenue} className="text-slate-400 hover:text-slate-600 shrink-0 ml-2">
                  <span className="material-symbols-outlined text-[15px]">close</span>
                </button>
              </div>
            ) : (
              <>
                <input
                  value={venueQuery}
                  onChange={(e) => {
                    setVenueQuery(e.target.value);
                    setForm({ ...form, venueName: e.target.value, venueId: '' });
                  }}
                  onFocus={() => setVenueDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setVenueDropdownOpen(false), 150)}
                  placeholder="Search venues, or type a name…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
                />
                {venueDropdownOpen && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {venueResults.length === 0 ? (
                      <p className="text-xs text-slate-400 px-3 py-2.5">
                        {venueQuery.trim() ? 'No matching venues — you can still type a custom name above.' : 'Loading venues…'}
                      </p>
                    ) : (
                      venueResults.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onMouseDown={() => pickVenue(v)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex flex-col"
                        >
                          <span className="font-medium">{v.name}</span>
                          {v.location && <span className="text-[11px] text-slate-400">{v.location}</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <input
            type="number"
            min="0"
            value={form.guestCountEstimate}
            onChange={(e) => setForm({ ...form, guestCountEstimate: e.target.value })}
            placeholder="Expected guests"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          />

          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (dress code, run-of-show highlights…)"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2"
          />

          <div className="sm:col-span-2 flex gap-2">
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); setVenueQuery(''); }} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-50">
              Cancel
            </button>
            <button disabled={saving} type="submit" className="flex-1 bg-[#1e293b] text-white py-2.5 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60">
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add to Itinerary'}
            </button>
          </div>
        </form>
      )}

      {functions.length === 0 && !showForm ? (
        <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-8 text-center">
          Build out the wedding's actual schedule — Mehendi, Sangeet, the ceremony, the reception — each with its
          own date, time, and venue. The couple sees this on their own dashboard the moment you add one.
        </p>
      ) : (
        <div className="relative ml-5">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />
          <div className="space-y-5">
            {functions.map((fn) => (
              <div key={fn.id} className="relative flex items-start gap-4">
                <div className="w-4 h-4 rounded-full bg-white border-2 border-[#1e293b] shrink-0 mt-1 z-10" />
                <div className="flex-1 bg-white border border-slate-100 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-geist font-semibold text-sm">{fn.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {fn.function_date
                          ? new Date(fn.function_date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Date not set'}
                        {fn.start_time && ` · ${fn.start_time.slice(0, 5)}`}
                        {fn.venue_name && ` · ${fn.venue_name}`}
                      </p>
                      {fn.guest_count_estimate !== null && (
                        <p className="text-[11px] text-slate-400 mt-0.5">~{fn.guest_count_estimate} guests expected</p>
                      )}
                      {fn.notes && <p className="text-xs text-slate-500 mt-1.5">{fn.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => startEdit(fn)} className="text-slate-300 hover:text-[#1e293b] p-1">
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                      <button onClick={() => handleDelete(fn.id)} className="text-slate-300 hover:text-red-500 p-1">
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
