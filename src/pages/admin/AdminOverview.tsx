import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader, StatTile, StatusBadge } from '../../components/Shell';
import { AdminOverview, adminAssignEnquiry, fetchAdminOverview, fetchAllEnquiries, fetchStaffRoster, subscribeToEnquiries } from '../../lib/api';
import { EnquiryWithClient, StaffProfile } from '../../types';

function formatPhone(client: EnquiryWithClient['client']): string {
  if (!client) return '—';
  if (client.phone_e164) return client.phone_e164;
  if (client.phone_number) return `${client.phone_country_code || ''} ${client.phone_number}`.trim();
  return '—';
}

export const AdminOverviewPage: React.FC = () => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [unassigned, setUnassigned] = useState<EnquiryWithClient[]>([]);
  const [managers, setManagers] = useState<StaffProfile[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ov, all, mgrs] = await Promise.all([fetchAdminOverview(), fetchAllEnquiries(), fetchStaffRoster('manager')]);
    setOverview(ov);
    setUnassigned(all.filter((e) => !e.assigned_to));
    setManagers(mgrs);
  }, []);

  useEffect(() => {
    load();
    return subscribeToEnquiries(load);
  }, [load]);

  const handleAssign = async (enquiryId: string, managerId: string) => {
    if (!managerId) return;
    setAssigning(enquiryId);
    try {
      await adminAssignEnquiry(enquiryId, managerId);
      await load();
    } finally {
      setAssigning(null);
    }
  };

  return (
    <Page>
      <TopHeader title="Command Overview" subtitle="Everything happening across the platform, right now" />
      <Main>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-5">
          <StatTile label="Enquiries Today" value={overview?.totalEnquiriesToday ?? '—'} tone="dark" icon="today" />
          <StatTile label="All-Time Enquiries" value={overview?.totalEnquiriesAllTime ?? '—'} icon="inbox" />
          <StatTile label="Unassigned" value={overview?.unassignedCount ?? '—'} icon="warning" />
          <StatTile label="Won" value={overview?.confirmedCount ?? '—'} icon="task_alt" />
          <StatTile label="Active Managers" value={overview?.activeManagers ?? '—'} icon="badge" />
          <StatTile label="Active Sales Agents" value={overview?.activeSalesmen ?? '—'} icon="group" />
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-geist font-semibold text-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500">priority_high</span> Unassigned Enquiries
            </h2>
            <span className="text-xs text-slate-400">Auto-updates as new enquiries land</span>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
                <tr>
                  <th className="text-left px-6 py-3 font-semibold">Client</th>
                  <th className="text-left px-6 py-3 font-semibold">Contact</th>
                  <th className="text-left px-6 py-3 font-semibold">Destination</th>
                  <th className="text-left px-6 py-3 font-semibold">Received</th>
                  <th className="text-left px-6 py-3 font-semibold">Assign to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {unassigned.map((e) => (
                  <tr key={e.id}>
                    <td className="px-6 py-4 font-geist font-semibold">{e.client?.full_name || 'Unnamed'}</td>
                    <td className="px-6 py-4 text-slate-500">{formatPhone(e.client)}</td>
                    <td className="px-6 py-4 text-slate-500">{e.destination || '—'}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <select
                        defaultValue=""
                        disabled={assigning === e.id}
                        onChange={(ev) => handleAssign(e.id, ev.target.value)}
                        className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="" disabled>Choose manager…</option>
                        {managers.map((m) => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {unassigned.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-slate-400">All enquiries are assigned. Nice work.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </Main>
    </Page>
  );
};
