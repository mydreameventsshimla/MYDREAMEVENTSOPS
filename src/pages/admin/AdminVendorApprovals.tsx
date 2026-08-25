import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader } from '../../components/Shell';
import { fetchPendingVendorApplications, reviewVendorApplication } from '../../lib/api';
import { VendorApplication } from '../../types';
import { useStaff } from '../../context/StaffContext';

// portfolio_url is free text from a PUBLIC, unauthenticated submission
// (vendor self-application or a sales agent's form). Rendering it straight
// into an <a href> would let a submission carry a `javascript:` URL that
// runs in an admin's session the moment they click "View portfolio" —
// stealing their Supabase session token out of localStorage. Only
// http(s) links are ever rendered as a clickable link; anything else
// renders as inert text.
function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// Exported in two shapes on purpose: `ApplicationsPanel` is the content, so
// the combined Vendors screen can render it inside a tab, and the page
// wrapper stays for the standalone /admin/vendors route.
export const AdminVendorApprovals: React.FC = () => (
  <Page>
    <TopHeader
      title="Vendor Approvals"
      subtitle="Vendor applications — self-submitted or brought in by a sales agent — awaiting review"
    />
    <Main><ApplicationsPanel /></Main>
  </Page>
);

export const ApplicationsPanel: React.FC = () => {
  const { staff } = useStaff();
  const [applications, setApplications] = useState<VendorApplication[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPendingVendorApplications().then(setApplications);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (application: VendorApplication, approve: boolean) => {
    if (!staff) return;
    setBusy(application.id);
    try {
      await reviewVendorApplication(application.id, approve, staff.id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {applications.map((a) => (
            <div key={a.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded uppercase">{a.role}</span>
                <span className="text-[10px] text-slate-400">{new Date(a.created_at).toLocaleDateString()}</span>
              </div>
              <div>
                <h3 className="font-geist font-semibold text-base">{a.applicant_name}</h3>
                <p className="text-xs text-slate-400">{[a.city, a.email].filter(Boolean).join(' · ') || 'No details provided'}</p>
                {a.story && <p className="text-xs text-slate-500 mt-2 line-clamp-3">{a.story}</p>}
                {a.portfolio_url && (
                  safeExternalUrl(a.portfolio_url) ? (
                    <a href={safeExternalUrl(a.portfolio_url)!} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 font-semibold hover:underline block mt-1">
                      View portfolio →
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400 block mt-1" title="Not a valid http(s) link">
                      Portfolio link unavailable
                    </span>
                  )
                )}
                {a.submitted_by && (
                  <span className="inline-block mt-2 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase">
                    Sales-sourced lead
                  </span>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleDecision(a, true)}
                  disabled={busy === a.id}
                  className="flex-1 bg-emerald-500 text-white py-2.5 rounded-lg text-xs font-bold hover:bg-emerald-600 disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDecision(a, false)}
                  disabled={busy === a.id}
                  className="flex-1 border border-red-200 text-red-500 py-2.5 rounded-lg text-xs font-bold hover:bg-red-50 disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {applications.length === 0 && (
            <p className="text-sm text-slate-400">No vendor applications waiting on review.</p>
          )}
        </div>
  );
};
