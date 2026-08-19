import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader, StatusBadge } from '../../components/Shell';
import { fetchAllEnquiries, fetchStaffRoster, subscribeToEnquiries } from '../../lib/api';
import { EnquiryWithClient, EnquiryStatus, StaffProfile } from '../../types';
import { EnquiryDetailModal } from './EnquiryDetailModal';

const STATUS_ORDER: EnquiryStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost'];

function formatPhone(client: EnquiryWithClient['client']): string {
  if (!client) return '—';
  if (client.phone_e164) return client.phone_e164;
  if (client.phone_number) return `${client.phone_country_code || ''} ${client.phone_number}`.trim();
  return '—';
}

export const AdminEnquiries: React.FC = () => {
  const [enquiries, setEnquiries] = useState<EnquiryWithClient[]>([]);
  const [managers, setManagers] = useState<StaffProfile[]>([]);
  const [statusFilter, setStatusFilter] = useState<EnquiryStatus | 'all'>('all');
  const [managerFilter, setManagerFilter] = useState<string>('all');
  const [selected, setSelected] = useState<EnquiryWithClient | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchAllEnquiries(), fetchStaffRoster('manager')]).then(([e, m]) => {
      setEnquiries(e);
      setManagers(m);
      // Keep an open modal's data fresh after a reassignment/budget edit.
      setSelected((prev) => (prev ? e.find((row) => row.id === prev.id) || null : prev));
    });
  }, []);

  useEffect(() => {
    load();
    return subscribeToEnquiries(load);
  }, [load]);

  const managerNames = Array.from(
    new Map(enquiries.filter((e) => e.manager).map((e) => [e.manager!.id, e.manager!.full_name])).entries()
  );

  const visible = enquiries.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (managerFilter !== 'all' && e.assigned_to !== managerFilter) return false;
    return true;
  });

  return (
    <Page>
      <TopHeader title="All Enquiries" subtitle={`${enquiries.length} total across the platform — click a row for full details`} />
      <Main>
        <div className="flex flex-wrap gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-2 outline-none">
            <option value="all">All statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="text-xs font-semibold border border-slate-200 rounded-lg px-3 py-2 outline-none">
            <option value="all">All managers</option>
            {managerNames.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Client</th>
                <th className="text-left px-6 py-3 font-semibold">Contact</th>
                <th className="text-left px-6 py-3 font-semibold">Destination</th>
                <th className="text-left px-6 py-3 font-semibold">Manager</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
                <th className="text-left px-6 py-3 font-semibold">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visible.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(e)}>
                  <td className="px-6 py-4 font-geist font-semibold">{e.client?.full_name || 'Unnamed'}</td>
                  <td className="px-6 py-4 text-slate-500">{formatPhone(e.client)}</td>
                  <td className="px-6 py-4 text-slate-500">{e.destination || '—'}</td>
                  <td className="px-6 py-4 text-slate-500">{e.manager?.full_name || <span className="text-amber-500 font-semibold">Unassigned</span>}</td>
                  <td className="px-6 py-4"><StatusBadge status={e.status} /></td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{new Date(e.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">No enquiries match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Main>

      {selected && (
        <EnquiryDetailModal
          enquiry={selected}
          managers={managers}
          onClose={() => setSelected(null)}
          onUpdated={load}
        />
      )}
    </Page>
  );
};
