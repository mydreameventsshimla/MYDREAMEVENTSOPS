import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmedVendor, ConfirmedVendorStatus, EventFunction, ShortlistedVenue, VisitRequestInfo, VendorPush, VendorRefTable } from '../types';
import {
  fetchConfirmedVendors,
  upsertConfirmedVendor,
  deleteConfirmedVendor,
  subscribeToConfirmedVendors,
  fetchFunctionsForEnquiry,
  fetchClientShortlist,
  fetchVisitRequests,
  fetchPushesForEnquiry,
  searchCatalog,
} from '../lib/api';

interface Props {
  enquiryId: string;
  clientId: string | null;
}

const CATEGORIES = ['Venue', 'Catering', 'Decor', 'Photography', 'Makeup', 'DJ / Music', 'Mehendi', 'Transport', 'Other'];

// Which catalog table a category searches against — the two richer,
// dedicated tables get their own; everything else falls back to the
// general vendors table (filtered by name only, same as the Live Call tab).
function tableForCategory(category: string): VendorRefTable {
  if (category === 'Venue') return 'venues';
  if (category === 'Decor') return 'decor_themes';
  return 'vendors';
}

// Reverse of the above, used only to guess a starting category when a
// client-engagement signal is clicked — the manager can still correct it.
function categoryForTable(table: VendorRefTable): string {
  if (table === 'venues') return 'Venue';
  if (table === 'decor_themes') return 'Decor';
  return 'Other';
}

const STATUS_LABEL: Record<ConfirmedVendorStatus, string> = {
  contract_pending: 'Contract Pending', confirmed: 'Confirmed', deposit_paid: 'Deposit Paid', cancelled: 'Cancelled',
};
const STATUS_STYLE: Record<ConfirmedVendorStatus, string> = {
  contract_pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  deposit_paid: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-500',
};

function money(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

const emptyForm = {
  category: 'Venue', vendorName: '', catalogRefTable: '' as VendorRefTable | '', catalogRefId: '',
  contactPerson: '', contactPhone: '', contactEmail: '',
  agreedPrice: '', status: 'confirmed' as ConfirmedVendorStatus, functionId: '', notes: '',
};

export const VendorsPanel: React.FC<Props> = ({ enquiryId, clientId }) => {
  const [vendors, setVendors] = useState<ConfirmedVendor[]>([]);
  const [functions, setFunctions] = useState<EventFunction[]>([]);
  const [shortlist, setShortlist] = useState<ShortlistedVenue[]>([]);
  const [visits, setVisits] = useState<VisitRequestInfo[]>([]);
  const [pushes, setPushes] = useState<VendorPush[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState<{ id: string; name?: string; title?: string; location?: string }[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const load = useCallback(async () => {
    setVendors(await fetchConfirmedVendors(enquiryId));
  }, [enquiryId]);

  const loadSignals = useCallback(async () => {
    const [visitRows, pushRows] = await Promise.all([
      fetchVisitRequests(enquiryId).catch(() => []),
      fetchPushesForEnquiry(enquiryId).catch(() => []),
    ]);
    setVisits(visitRows);
    setPushes(pushRows.filter((p) => p.status === 'wishlist' || p.status === 'finalized'));
    if (clientId) {
      setShortlist(await fetchClientShortlist(clientId).catch(() => []));
    } else {
      setShortlist([]);
    }
  }, [enquiryId, clientId]);

  useEffect(() => {
    load();
    loadSignals();
    fetchFunctionsForEnquiry(enquiryId).then(setFunctions);
    return subscribeToConfirmedVendors(enquiryId, load);
  }, [load, loadSignals, enquiryId]);

  // Debounced catalog search, scoped to whichever table the current
  // category maps to.
  useEffect(() => {
    if (!catalogOpen) return undefined;
    let cancelled = false;
    const table = tableForCategory(form.category);
    const timer = setTimeout(() => {
      searchCatalog(table, catalogQuery)
        .then((rows) => {
          if (!cancelled) setCatalogResults(rows as { id: string; name?: string; title?: string; location?: string }[]);
        })
        .catch((err) => {
          if (!cancelled) {
            console.error('Vendor catalog search failed:', err);
            setCatalogResults([]);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [catalogOpen, catalogQuery, form.category]);

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setCatalogQuery('');
    setShowForm(true);
  };

  const startEdit = (v: ConfirmedVendor) => {
    setEditingId(v.id);
    setForm({
      category: v.category,
      vendorName: v.vendor_name,
      catalogRefTable: (v.catalog_ref_table as VendorRefTable) || '',
      catalogRefId: v.catalog_ref_id || '',
      contactPerson: v.contact_person || '',
      contactPhone: v.contact_phone || '',
      contactEmail: v.contact_email || '',
      agreedPrice: v.agreed_price?.toString() || '',
      status: v.status,
      functionId: v.function_id || '',
      notes: v.notes || '',
    });
    setCatalogQuery(v.vendor_name);
    setShowForm(true);
  };

  // Pre-fill the Add Vendor form from a client-engagement signal — a
  // shortlisted/visited venue or a wishlisted/finalized push — instead of
  // the manager typing a name blind and hoping it matches what the couple
  // actually picked.
  const startFromSignal = (opts: { category: string; vendorName: string; catalogRefTable?: VendorRefTable; catalogRefId?: string; notes?: string }) => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      category: opts.category,
      vendorName: opts.vendorName,
      catalogRefTable: opts.catalogRefTable || '',
      catalogRefId: opts.catalogRefId || '',
      notes: opts.notes || '',
    });
    setCatalogQuery(opts.vendorName);
    setCatalogOpen(false);
    setShowForm(true);
  };

  const pickCatalogRow = (row: { id: string; name?: string; title?: string }) => {
    const label = row.name || row.title || 'Untitled';
    setForm({ ...form, vendorName: label, catalogRefTable: tableForCategory(form.category), catalogRefId: row.id });
    setCatalogQuery(label);
    setCatalogOpen(false);
  };

  const clearCatalogPick = () => {
    setForm({ ...form, vendorName: '', catalogRefTable: '', catalogRefId: '' });
    setCatalogQuery('');
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setCatalogQuery('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vendorName.trim()) return;
    setSaving(true);
    try {
      await upsertConfirmedVendor({
        id: editingId || undefined,
        enquiryId,
        functionId: form.functionId || null,
        category: form.category,
        vendorName: form.vendorName.trim(),
        catalogRefTable: form.catalogRefTable || null,
        catalogRefId: form.catalogRefId || null,
        contactPerson: form.contactPerson.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim(),
        agreedPrice: form.agreedPrice ? Number(form.agreedPrice) : null,
        status: form.status,
        notes: form.notes.trim(),
      });
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this vendor from the roster?')) return;
    await deleteConfirmedVendor(id);
    await load();
  };

  const totalCommitted = vendors.filter((v) => v.status !== 'cancelled').reduce((s, v) => s + (v.agreed_price || 0), 0);
  const functionName = (id: string | null) => functions.find((f) => f.id === id)?.name;

  // A venue already locked into confirmed_vendors — used to grey out
  // signal chips that have already been actioned so the list doesn't grow
  // stale-looking clutter.
  const isAlreadyBooked = (table: VendorRefTable, refId: string) =>
    vendors.some((v) => v.catalog_ref_table === table && v.catalog_ref_id === refId);

  const finalizedPushes = pushes.filter((p) => p.status === 'finalized');
  const wishlistedPushes = pushes.filter((p) => p.status === 'wishlist');
  const hasSignals = shortlist.length > 0 || visits.length > 0 || pushes.length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatTile label="Vendors Booked" value={vendors.filter((v) => v.status !== 'cancelled').length.toString()} />
        <StatTile label="Total Committed" value={money(totalCommitted)} tone="emerald" />
        <StatTile label="Contracts Pending" value={vendors.filter((v) => v.status === 'contract_pending').length.toString()} tone={vendors.some((v) => v.status === 'contract_pending') ? 'amber' : undefined} />
      </div>

      {hasSignals && (
        <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">What the Couple Has Shown Interest In</p>

          {finalizedPushes.length > 0 && (
            <SignalRow label="This is our pick">
              {finalizedPushes.map((p) => (
                <SignalChip
                  key={p.id}
                  tone="finalized"
                  label={p.vendor_label}
                  sublabel={categoryForTable(p.vendor_ref_table)}
                  disabled={isAlreadyBooked(p.vendor_ref_table, p.vendor_ref_id)}
                  onClick={() => startFromSignal({ category: categoryForTable(p.vendor_ref_table), vendorName: p.vendor_label, catalogRefTable: p.vendor_ref_table, catalogRefId: p.vendor_ref_id, notes: 'Client finalized this as their pick.' })}
                />
              ))}
            </SignalRow>
          )}

          {shortlist.length > 0 && (
            <SignalRow label="Shortlisted venues">
              {shortlist.map((s) => (
                <SignalChip
                  key={s.venue_id}
                  tone="shortlist"
                  label={s.venue_name}
                  disabled={isAlreadyBooked('venues', s.venue_id)}
                  onClick={() => startFromSignal({ category: 'Venue', vendorName: s.venue_name, catalogRefTable: 'venues', catalogRefId: s.venue_id })}
                />
              ))}
            </SignalRow>
          )}

          {visits.length > 0 && (
            <SignalRow label="Scheduled visits">
              {visits.map((v) => (
                <SignalChip
                  key={v.id}
                  tone="visit"
                  label={v.venue_name}
                  sublabel={v.requested_date ? `${v.status} · ${new Date(v.requested_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : v.status}
                  disabled={isAlreadyBooked('venues', v.venue_id)}
                  onClick={() => startFromSignal({ category: 'Venue', vendorName: v.venue_name, catalogRefTable: 'venues', catalogRefId: v.venue_id })}
                />
              ))}
            </SignalRow>
          )}

          {wishlistedPushes.length > 0 && (
            <SignalRow label="Wishlisted">
              {wishlistedPushes.map((p) => (
                <SignalChip
                  key={p.id}
                  tone="wishlist"
                  label={p.vendor_label}
                  sublabel={categoryForTable(p.vendor_ref_table)}
                  disabled={isAlreadyBooked(p.vendor_ref_table, p.vendor_ref_id)}
                  onClick={() => startFromSignal({ category: categoryForTable(p.vendor_ref_table), vendorName: p.vendor_label, catalogRefTable: p.vendor_ref_table, catalogRefId: p.vendor_ref_id })}
                />
              ))}
            </SignalRow>
          )}
          <p className="text-[10px] text-slate-400">Tap any chip to start booking it — greyed-out ones are already on the roster below.</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={startAdd}
          className="flex items-center gap-1.5 text-xs font-bold uppercase bg-[#1e293b] text-white px-4 py-2.5 rounded-lg hover:bg-slate-800"
        >
          <span className="material-symbols-outlined text-[16px]">add</span> Add Vendor
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white border border-slate-100 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={form.category}
            onChange={(e) => { setForm({ ...form, category: e.target.value, vendorName: '', catalogRefTable: '', catalogRefId: '' }); setCatalogQuery(''); }}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="relative">
            {form.catalogRefId ? (
              <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2.5 text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="material-symbols-outlined text-[15px] text-emerald-600">verified</span>
                  <span className="truncate">{form.vendorName}</span>
                </span>
                <button type="button" onClick={clearCatalogPick} className="text-slate-400 hover:text-slate-600 shrink-0 ml-2">
                  <span className="material-symbols-outlined text-[15px]">close</span>
                </button>
              </div>
            ) : (
              <>
                <input
                  required
                  value={catalogQuery}
                  onChange={(e) => { setCatalogQuery(e.target.value); setForm({ ...form, vendorName: e.target.value, catalogRefTable: '', catalogRefId: '' }); }}
                  onFocus={() => setCatalogOpen(true)}
                  onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
                  placeholder="Search the catalog, or type a name…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
                />
                {catalogOpen && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {catalogResults.length === 0 ? (
                      <p className="text-xs text-slate-400 px-3 py-2.5">
                        {catalogQuery.trim() ? 'No matches — you can still type a custom name above.' : 'Loading…'}
                      </p>
                    ) : (
                      catalogResults.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onMouseDown={() => pickCatalogRow(row)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex flex-col"
                        >
                          <span className="font-medium">{row.name || row.title}</span>
                          {row.location && <span className="text-[11px] text-slate-400">{row.location}</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="Contact person" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
          <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="Contact phone" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm" />
          <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Contact email" type="email" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2" />

          <input
            type="number" min="0"
            value={form.agreedPrice}
            onChange={(e) => setForm({ ...form, agreedPrice: e.target.value })}
            placeholder="Agreed price (₹)"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ConfirmedVendorStatus })} className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
            {(Object.keys(STATUS_LABEL) as ConfirmedVendorStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>

          {functions.length > 0 && (
            <select value={form.functionId} onChange={(e) => setForm({ ...form, functionId: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2">
              <option value="">Not tied to a specific function</option>
              {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}

          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2" />

          <div className="sm:col-span-2 flex gap-2">
            <button type="button" onClick={resetForm} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-50">
              Cancel
            </button>
            <button disabled={saving} type="submit" className="flex-1 bg-[#1e293b] text-white py-2.5 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60">
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add to Roster'}
            </button>
          </div>
        </form>
      )}

      {vendors.length === 0 && !showForm ? (
        <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-8 text-center">
          Nothing booked yet. This is separate from what's been pushed/wishlisted to the couple — add a vendor here
          once a contract is actually signed or a booking is confirmed.
        </p>
      ) : (
        <div className="space-y-3">
          {vendors.map((v) => (
            <div key={v.id} className="bg-white border border-slate-100 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-geist font-semibold text-sm">{v.vendor_name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400">{v.category}</span>
                    {v.catalog_ref_id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[11px]">verified</span> From catalog
                      </span>
                    )}
                    {v.function_id && functionName(v.function_id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{functionName(v.function_id)}</span>
                    )}
                  </div>
                  {(v.contact_person || v.contact_phone) && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {v.contact_person}{v.contact_person && v.contact_phone && ' · '}{v.contact_phone}
                    </p>
                  )}
                  {v.notes && <p className="text-xs text-slate-500 mt-1">{v.notes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(v)} className="text-slate-300 hover:text-[#1e293b] p-1">
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button onClick={() => handleDelete(v.id)} className="text-slate-300 hover:text-red-500 p-1">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-50">
                <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${STATUS_STYLE[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                {v.agreed_price !== null && <span className="font-geist font-bold text-sm">{money(v.agreed_price)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const StatTile: React.FC<{ label: string; value: string; tone?: 'emerald' | 'amber' }> = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-100 rounded-xl p-4">
    <p className={`text-xl font-geist font-bold ${tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-[#1e293b]'}`}>{value}</p>
    <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">{label}</p>
  </div>
);

const SignalRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="text-[10px] text-slate-400 mb-1.5">{label}</p>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
);

const SIGNAL_TONE_STYLE: Record<string, string> = {
  finalized: 'bg-green-50 border-green-300 text-green-700',
  shortlist: 'bg-amber-50 border-amber-200 text-amber-700',
  visit: 'bg-blue-50 border-blue-200 text-blue-700',
  wishlist: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700',
};

const SignalChip: React.FC<{ label: string; sublabel?: string; tone: string; disabled?: boolean; onClick: () => void }> = ({ label, sublabel, tone, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
      disabled ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-default' : `${SIGNAL_TONE_STYLE[tone]} hover:opacity-75`
    }`}
  >
    <span className="font-medium">{label}</span>
    {sublabel && <span className="opacity-70"> · {sublabel}</span>}
  </button>
);
