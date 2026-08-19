import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader, StatusBadge } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import { fetchMyVendorApplications } from '../../lib/api';
import { VendorApplication } from '../../types';

export const SalesmanPipeline: React.FC = () => {
  const { staff } = useStaff();
  const [applications, setApplications] = useState<VendorApplication[]>([]);

  const load = useCallback(async () => {
    if (!staff) return;
    setApplications(await fetchMyVendorApplications(staff.id));
  }, [staff]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Page>
      <TopHeader title="My Pipeline" subtitle="Every vendor lead you've submitted, and its review state" />
      <Main>
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Name</th>
                <th className="text-left px-6 py-3 font-semibold">Role</th>
                <th className="text-left px-6 py-3 font-semibold">City</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
                <th className="text-left px-6 py-3 font-semibold">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {applications.map((a) => (
                <tr key={a.id}>
                  <td className="px-6 py-4 font-geist font-semibold">{a.applicant_name}</td>
                  <td className="px-6 py-4 text-slate-500">{a.role}</td>
                  <td className="px-6 py-4 text-slate-500">{a.city || '—'}</td>
                  <td className="px-6 py-4"><StatusBadge status={a.status} /></td>
                  <td className="px-6 py-4 text-slate-400 text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-400">You haven't submitted any vendor leads yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Main>
    </Page>
  );
};
