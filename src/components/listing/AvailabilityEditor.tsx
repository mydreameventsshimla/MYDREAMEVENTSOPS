import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchListingAvailability, setVendorAvailability, deleteAvailabilityDates,
} from '../../lib/api';
import { ListingAvailability, AvailabilityStatus } from '../../types';
import { parseCsvToObjects } from '../../lib/csv';

// The salesman's calendar editor. Three ways to fill a year of dates in,
// because "one venue, one date at a time" is not how this actually gets
// done in practice:
//
//   1. "Mark next 12 months available" — the common case. Most dates on
//      most venues are just open; this is one click instead of 365.
//   2. CSV upload — for a venue whose owner hands over a printed calendar
//      with specific dates already booked/blocked/priced-up. Same
//      correct-CSV-parser the vendor bulk import already uses.
//   3. Click a single day on the grid — for the exceptions: a date that
//      just got booked, a newly-announced auspicious date, correcting a
//      mistake in the CSV.
//
// Deliberately NOT gated by `disabled`/readOnly the way every other step in
// this editor is — a live, published venue's calendar has to keep changing
// after the listing itself is frozen for review. See migration 0022.

const STATUS_META: Record<AvailabilityStatus, { label: string; dot: string; cell: string }> = {
  available: { label: 'Available', dot: 'bg-emerald-500', cell: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  low_demand: { label: 'Low demand', dot: 'bg-sky-400', cell: 'bg-sky-50 text-sky-700 border-sky-200' },
  high_demand: { label: 'High demand', dot: 'bg-amber-500', cell: 'bg-amber-50 text-amber-700 border-amber-200' },
  peak_demand: { label: 'Peak demand', dot: 'bg-rose-500', cell: 'bg-rose-50 text-rose-700 border-rose-200' },
  fully_booked: { label: 'Fully booked', dot: 'bg-slate-500', cell: 'bg-slate-100 text-slate-500 border-slate-200' },
  blocked: { label: 'Blocked', dot: 'bg-slate-800', cell: 'bg-slate-200 text-slate-600 border-slate-300' },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const AvailabilityEditor: React.FC<{ listingId: string }> = ({ listingId }) => {
  const [rows, setRows] = useState<ListingAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => addMonths(new Date(), 0));
  const [selected, setSelected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchListingAvailability(listingId));
    } catch (err: any) {
      setError(err?.message || 'Could not load the calendar');
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => new Map(rows.map((r) => [r.date, r])), [rows]);

  const markYearAvailable = async () => {
    setSaving(true);
    setError(null);
    try {
      const start = new Date();
      const dates: string[] = [];
      // 365 days out, not just to Dec 31 — a venue onboarded in November
      // still needs next November covered, not just six weeks of it.
      for (let i = 0; i < 365; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }
      // Existing entries are left alone — this fills in the blanks, it
      // doesn't overwrite a date someone already marked fully booked.
      const known = new Set(rows.map((r) => r.date));
      const toSet = dates.filter((d) => !known.has(d));
      await setVendorAvailability(listingId, toSet, 'available');
      setNote(`Marked ${toSet.length} date(s) available. ${dates.length - toSet.length} already had a status and were left as-is.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not set availability');
    } finally {
      setSaving(false);
    }
  };

  const handleCsv = async (file: File) => {
    setSaving(true);
    setError(null);
    try {
      const text = await file.text();
      const { rows: parsed } = parseCsvToObjects(text);
      if (parsed.length === 0) throw new Error('That file has no data rows.');

      const byStatus = new Map<AvailabilityStatus, string[]>();
      const bad: string[] = [];
      for (const row of parsed) {
        const date = row.date;
        const status = (row.status || 'available').toLowerCase() as AvailabilityStatus;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad.push(row.date || '(blank)'); continue; }
        if (!STATUS_META[status]) { bad.push(`${date}: unknown status "${row.status}"`); continue; }
        if (!byStatus.has(status)) byStatus.set(status, []);
        byStatus.get(status)!.push(date);
      }

      for (const [status, dates] of byStatus) {
        await setVendorAvailability(listingId, dates, status);
      }

      const okCount = parsed.length - bad.length;
      setNote(
        bad.length > 0
          ? `Set ${okCount} date(s). ${bad.length} row(s) skipped: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`
          : `Set ${okCount} date(s) from the file.`
      );
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not read that file');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const setSingleDate = async (
    date: string,
    status: AvailabilityStatus | 'clear',
    isAuspicious = false
  ) => {
    setSaving(true);
    setError(null);
    try {
      if (status === 'clear') {
        await deleteAvailabilityDates(listingId, [date]);
      } else {
        await setVendorAvailability(listingId, [date], status, isAuspicious);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not update that date');
    } finally {
      setSaving(false);
    }
  };

  const toggleAuspicious = (date: string) => {
    const entry = byDate.get(date);
    setSingleDate(date, entry?.status ?? 'available', !entry?.is_auspicious);
  };

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}
      {note && (
        <div className="bg-slate-50 border border-slate-200 text-slate-600 text-sm px-4 py-3 rounded-xl flex items-start justify-between gap-3">
          <span>{note}</span>
          <button onClick={() => setNote(null)} className="text-slate-400 hover:text-slate-600 shrink-0">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={markYearAvailable}
          disabled={saving}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">event_available</span>
          Mark next 12 months available
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          className="border border-slate-200 hover:border-slate-300 text-slate-600 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">upload_file</span>
          Upload CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
          onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />

        <span className="text-[11px] text-slate-400">
          CSV columns: <code className="bg-slate-100 px-1.5 py-0.5 rounded">date</code> (YYYY-MM-DD),{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded">status</code>
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
        {(Object.keys(STATUS_META) as AvailabilityStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${STATUS_META[s].dot}`} />
            {STATUS_META[s].label}
          </span>
        ))}
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setCursor((c) => addMonths(c, -1))} className="p-2 text-slate-400 hover:text-slate-700">
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="font-geist font-semibold text-slate-800">{monthLabel}</span>
          <button onClick={() => setCursor((c) => addMonths(c, 1))} className="p-2 text-slate-400 hover:text-slate-700">
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="text-center text-[10px] font-bold text-slate-400 uppercase pb-1">{d}</div>
            ))}
            {Array.from({ length: firstWeekday }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const date = isoDate(year, month, day);
              const entry = byDate.get(date);
              const meta = entry ? STATUS_META[entry.status] : null;
              const isPast = date < todayIso();
              return (
                <button
                  key={date}
                  type="button"
                  disabled={saving}
                  onClick={() => setSelected(date === selected ? null : date)}
                  className={`relative aspect-square rounded-lg border text-xs font-semibold transition-all disabled:opacity-50 ${
                    selected === date
                      ? 'ring-2 ring-emerald-400 border-emerald-300'
                      : meta ? meta.cell : 'bg-white border-slate-100 text-slate-500 hover:border-slate-300'
                  } ${isPast ? 'opacity-40' : ''}`}
                >
                  {day}
                  {entry?.is_auspicious && (
                    <span className="absolute top-0.5 right-0.5 text-amber-500 text-[10px]">★</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">
            {new Date(selected).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {(Object.keys(STATUS_META) as AvailabilityStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={saving}
                onClick={() => setSingleDate(selected, s)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${STATUS_META[s].cell} hover:opacity-80 disabled:opacity-50`}
              >
                {STATUS_META[s].label}
              </button>
            ))}
            <button
              type="button"
              disabled={saving}
              onClick={() => toggleAuspicious(selected)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border hover:opacity-80 disabled:opacity-50 ${
                byDate.get(selected)?.is_auspicious
                  ? 'border-amber-400 bg-amber-400 text-white'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
              title="Toggle auspicious"
            >
              ★ Auspicious
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setSingleDate(selected, 'clear')}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
