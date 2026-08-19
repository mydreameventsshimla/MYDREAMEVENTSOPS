import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader } from '../../components/Shell';
import { createLocation, deleteLocation, fetchAllLocations, updateLocation } from '../../lib/api';
import { LocationRow } from '../../types';

export const AdminLocations: React.FC = () => {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', region: '', image_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAllLocations().then(setLocations);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      await createLocation({
        name: form.name.trim(),
        region: form.region.trim() || undefined,
        image_url: form.image_url.trim() || undefined,
        display_order: locations.length,
      });
      setForm({ name: '', region: '', image_url: '' });
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (loc: LocationRow) => {
    setBusyId(loc.id);
    try {
      await updateLocation(loc.id, { is_active: !loc.is_active });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (loc: LocationRow) => {
    if (!window.confirm(`Delete "${loc.name}"? This can't be undone — consider deactivating instead if it might come back.`)) return;
    setBusyId(loc.id);
    try {
      await deleteLocation(loc.id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const move = async (loc: LocationRow, direction: -1 | 1) => {
    const idx = locations.findIndex((l) => l.id === loc.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= locations.length) return;
    const other = locations[swapIdx];
    setBusyId(loc.id);
    try {
      await Promise.all([
        updateLocation(loc.id, { display_order: other.display_order }),
        updateLocation(other.id, { display_order: loc.display_order }),
      ]);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Page>
      <TopHeader
        title="Locations"
        subtitle="Destination presets shown in the client intake wizard — no code deploy needed to change these"
        right={
          <button onClick={() => setShowForm((v) => !v)} className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-emerald-600">
            <span className="material-symbols-outlined text-[16px]">add_location_alt</span> Add Location
          </button>
        }
      />
      <Main>
        {showForm && (
          <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Udaipur" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Region (optional)</label>
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="e.g. Rajasthan" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Image URL (optional)</label>
              <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <button disabled={submitting} type="submit" className="md:col-span-3 bg-[#1e293b] text-white py-3 rounded-lg font-bold text-sm hover:bg-slate-800 disabled:opacity-60">
              {submitting ? 'Adding…' : 'Add Location'}
            </button>
          </form>
        )}

        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Order</th>
                <th className="text-left px-6 py-3 font-semibold">Name</th>
                <th className="text-left px-6 py-3 font-semibold">Region</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {locations.map((loc, idx) => (
                <tr key={loc.id}>
                  <td className="px-6 py-4 text-slate-400">
                    <div className="flex gap-1">
                      <button disabled={busyId === loc.id || idx === 0} onClick={() => move(loc, -1)} className="disabled:opacity-30 hover:text-[#1e293b]">
                        <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                      </button>
                      <button disabled={busyId === loc.id || idx === locations.length - 1} onClick={() => move(loc, 1)} className="disabled:opacity-30 hover:text-[#1e293b]">
                        <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-geist font-semibold">{loc.name}</td>
                  <td className="px-6 py-4 text-slate-500">{loc.region || '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${loc.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {loc.is_active ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-3">
                    <button onClick={() => toggleActive(loc)} disabled={busyId === loc.id} className="text-xs font-semibold text-slate-500 hover:text-[#1e293b] disabled:opacity-60">
                      {loc.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => handleDelete(loc)} disabled={busyId === loc.id} className="text-xs font-semibold text-slate-500 hover:text-red-500 disabled:opacity-60">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-400">No locations yet — add your first destination above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Main>
    </Page>
  );
};
