import React, { useEffect, useState } from 'react';
import { Modal } from '../../components/Shell';
import { fetchStaffPerformance, StaffPerformance } from '../../lib/api';
import { StaffProfile } from '../../types';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', manager: 'Manager', salesman: 'Sales Agent' };

const Bar: React.FC<{ label: string; count: number; total: number; color: string }> = ({ label, count, total, color }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs w-28 capitalize text-slate-500 truncate">{label.replace(/_/g, ' ')}</span>
    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${total ? (count / total) * 100 : 0}%` }} />
    </div>
    <span className="text-xs w-6 text-right font-semibold">{count}</span>
  </div>
);

export const StaffProfileModal: React.FC<{ staff: StaffProfile; onClose: () => void }> = ({ staff, onClose }) => {
  const [perf, setPerf] = useState<StaffPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchStaffPerformance(staff)
      .then(setPerf)
      .finally(() => setLoading(false));
  }, [staff]);

  return (
    <Modal title="Staff Performance" onClose={onClose}>
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[#1e293b] flex items-center justify-center text-white text-lg font-bold shrink-0">
          {staff.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0">
          <p className="font-geist font-semibold text-base truncate">{staff.full_name}</p>
          <p className="text-xs text-slate-400 truncate">{staff.email}</p>
          <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
            {ROLE_LABEL[staff.role]}
          </span>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading performance…</p>}

      {!loading && perf?.kind === 'manager' && (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Total Leads" value={perf.total} />
            <Stat label="Won" value={perf.won} tone="emerald" />
            <Stat label="Lost" value={perf.lost} tone="red" />
            <Stat label="Conversion" value={`${Math.round(perf.conversionRate * 100)}%`} />
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase">Pipeline breakdown</h3>
            {Object.entries(perf.byStatus).length === 0 && <p className="text-xs text-slate-400">No leads assigned yet.</p>}
            {Object.entries(perf.byStatus).map(([status, count]) => (
              <Bar
                key={status}
                label={status}
                count={count}
                total={perf.total}
                color={status === 'won' ? 'bg-emerald-500' : status === 'lost' ? 'bg-red-400' : 'bg-blue-400'}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && perf?.kind === 'salesman' && (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Targets" value={perf.totalTargets} />
            <Stat label="Onboarded" value={perf.onboarded} tone="emerald" />
            <Stat label="Rejected" value={perf.rejected} tone="red" />
            <Stat label="Applications Sent" value={perf.totalApplications} />
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase">Recruitment targets</h3>
            {Object.entries(perf.targetsByStatus).length === 0 && <p className="text-xs text-slate-400">No targets assigned yet.</p>}
            {Object.entries(perf.targetsByStatus).map(([status, count]) => (
              <Bar
                key={status}
                label={status}
                count={count}
                total={perf.totalTargets}
                color={status === 'onboarded' ? 'bg-emerald-500' : status === 'rejected' ? 'bg-red-400' : 'bg-amber-400'}
              />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase">Submitted vendor applications</h3>
            <Bar label="pending" count={perf.applicationsByStatus.pending} total={perf.totalApplications} color="bg-amber-400" />
            <Bar label="approved" count={perf.applicationsByStatus.approved} total={perf.totalApplications} color="bg-emerald-500" />
            <Bar label="rejected" count={perf.applicationsByStatus.rejected} total={perf.totalApplications} color="bg-red-400" />
          </div>
        </div>
      )}

      {!loading && perf?.kind === 'admin' && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Vendor Applications Reviewed" value={perf.vendorApplicationsReviewed} />
        </div>
      )}
    </Modal>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'emerald' | 'red' }> = ({ label, value, tone }) => (
  <div className="bg-slate-50 rounded-xl p-3 text-center">
    <p
      className={`text-xl font-geist font-bold ${
        tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-500' : 'text-[#1e293b]'
      }`}
    >
      {value}
    </p>
    <p className="text-[10px] text-slate-400 uppercase font-semibold mt-0.5">{label}</p>
  </div>
);
