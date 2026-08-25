import React, { useState } from 'react';
import { Page, Main, TopHeader } from '../../components/Shell';
import { ApplicationsPanel } from './AdminVendorApprovals';
import { ListingReviewPanel } from './AdminListings';

// One place for everything vendor-related on the admin side.
//
// These were two separate sidebar entries — "Vendor Approvals" and "Listing
// Review" — which is two clicks and a mental map to answer one question:
// what needs my attention about vendors. They're also sequential stages of
// the same pipeline, so splitting them across screens hid the relationship:
// approving an application produces a listing that shows up in the *other*
// tab, with nothing on screen saying so.
//
// Tabbed instead, with the count of listings actually waiting on the badge,
// so the queue that needs work announces itself.

type Tab = 'applications' | 'listings';

export const AdminVendors: React.FC = () => {
  const [tab, setTab] = useState<Tab>('applications');
  const [pendingListings, setPendingListings] = useState<number | null>(null);

  return (
    <Page>
      <TopHeader
        title="Vendors"
        subtitle="Applications waiting on a decision, and profiles waiting to go live"
      />
      <Main>
        <div className="space-y-6">
          <nav className="flex gap-1.5 border-b border-slate-200 -mb-px">
            <TabButton
              active={tab === 'applications'}
              onClick={() => setTab('applications')}
              label="Applications"
              hint="Should we work with them at all"
            />
            <TabButton
              active={tab === 'listings'}
              onClick={() => setTab('listings')}
              label="Listing Review"
              hint="Is the profile good enough to publish"
              count={pendingListings ?? undefined}
            />
          </nav>

          {/* Both panels stay mounted so switching tabs doesn't re-fetch and
              lose scroll position — and so the Listing Review count is known
              before anyone opens that tab. */}
          <div className={tab === 'applications' ? '' : 'hidden'}>
            <ApplicationsPanel />
          </div>
          <div className={tab === 'listings' ? '' : 'hidden'}>
            <ListingReviewPanel onPendingCount={setPendingListings} />
          </div>
        </div>
      </Main>
    </Page>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  count?: number;
}> = ({ active, onClick, label, hint, count }) => (
  <button
    type="button"
    onClick={onClick}
    title={hint}
    className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all -mb-px ${
      active
        ? 'border-slate-800 text-slate-800'
        : 'border-transparent text-slate-400 hover:text-slate-600'
    }`}
  >
    {label}
    {count !== undefined && count > 0 && (
      <span className="ml-2 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded align-middle">
        {count}
      </span>
    )}
  </button>
);
