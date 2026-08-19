import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Main, TopHeader, StatusBadge } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import { fetchMyEnquiries } from '../../lib/api';
import { EnquiryWithClient, EnquiryStatus } from '../../types';

const STATUS_ORDER: EnquiryStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost'];

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

export const ManagerClients: React.FC = () => {
  const { staff } = useStaff();
  const navigate = useNavigate();
  const [enquiries, setEnquiries] = useState<EnquiryWithClient[]>([]);
  const [filter, setFilter] = useState<EnquiryStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!staff) return;
    fetchMyEnquiries(staff.id)
      .then(setEnquiries)
      .finally(() => setLoading(false));
  }, [staff]);

  const visible = filter === 'all' ? enquiries : enquiries.filter((e) => e.status === filter);

  return (
    <Page>
      <TopHeader title="My Clients" subtitle="Every client currently assigned to you" />
      <Main>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full font-geist text-xs font-semibold ${filter === 'all' ? 'bg-[#1e293b] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            All ({enquiries.length})
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-4 py-2 rounded-full font-geist text-xs font-semibold capitalize ${filter === s ? 'bg-[#1e293b] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              {s} ({enquiries.filter((e) => e.status === s).length})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
                <tr>
                  <th className="text-left px-6 py-3 font-semibold">Client</th>
                  <th className="text-left px-6 py-3 font-semibold">Contact</th>
                  <th className="text-left px-6 py-3 font-semibold">Destination</th>
                  <th className="text-left px-6 py-3 font-semibold">Guests</th>
                  <th className="text-left px-6 py-3 font-semibold">Budget</th>
                  <th className="text-left px-6 py-3 font-semibold">Status</th>
                  <th className="text-left px-6 py-3 font-semibold">Claimed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visible.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/manager/event/${e.id}`)}>
                    <td className="px-6 py-4 font-geist font-semibold">{e.client?.full_name || 'Unnamed'}</td>
                    <td className="px-6 py-4 text-slate-500">{formatPhone(e.client)}</td>
                    <td className="px-6 py-4 text-slate-500">{e.destination || '—'}</td>
                    <td className="px-6 py-4 text-slate-500">{e.guest_bracket || '—'}</td>
                    <td className="px-6 py-4 text-slate-500">{formatBudget(e.estimated_budget)}</td>
                    <td className="px-6 py-4"><StatusBadge status={e.status} /></td>
                    <td className="px-6 py-4 text-slate-400 text-xs">{e.claimed_at ? new Date(e.claimed_at).toLocaleDateString() : '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(ev) => { ev.stopPropagation(); navigate(`/manager/history/${e.id}`); }}
                        className="text-slate-300 hover:text-[#1e293b] mr-2"
                        title="Client history"
                      >
                        <span className="material-symbols-outlined text-[18px]">history</span>
                      </button>
                      <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-slate-400">No clients in this view yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Main>
    </Page>
  );
};
