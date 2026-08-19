import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader } from '../../components/Shell';
import { fetchManagerLoads, ManagerLoad } from '../../lib/api';
import { subscribeToEnquiries } from '../../lib/api';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-400',
  contacted: 'bg-amber-400',
  qualified: 'bg-violet-400',
  proposal_sent: 'bg-orange-400',
  won: 'bg-emerald-500',
  lost: 'bg-red-400',
};

export const AdminManagers: React.FC = () => {
  const [loads, setLoads] = useState<ManagerLoad[]>([]);

  const load = useCallback(() => {
    fetchManagerLoads().then(setLoads);
  }, []);

  useEffect(() => {
    load();
    return subscribeToEnquiries(load);
  }, [load]);

  return (
    <Page>
      <TopHeader title="Managers" subtitle="Who is handling what, at a glance" />
      <Main>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {loads.map(({ manager, total, byStatus }) => (
            <div key={manager.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1e293b] flex items-center justify-center text-white text-sm font-bold">
                    {manager.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <p className="font-geist font-semibold text-sm">{manager.full_name}</p>
                    <p className="text-xs text-slate-400">{manager.email}</p>
                  </div>
                </div>
                <span className="text-2xl font-geist font-bold text-[#1e293b]">{total}</span>
              </div>
              <div className="space-y-2">
                {Object.entries(byStatus).length === 0 && <p className="text-xs text-slate-400">No active clients yet.</p>}
                {Object.entries(byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-xs w-24 capitalize text-slate-500">{status}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${STATUS_COLORS[status] || 'bg-slate-400'}`}
                        style={{ width: `${total ? (count / total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-xs w-6 text-right font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {loads.length === 0 && <p className="text-sm text-slate-400">No managers on staff yet.</p>}
        </div>
      </Main>
    </Page>
  );
};
