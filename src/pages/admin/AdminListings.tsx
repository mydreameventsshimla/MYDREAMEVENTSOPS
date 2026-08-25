import React, { useCallback, useEffect, useState } from 'react';
import { Page, Main, TopHeader, Modal, StatTile } from '../../components/Shell';
import { ListingGrid } from '../../components/listing/ListingGrid';
import { ListingPreview, BadgeChip } from '../../components/listing/ListingPreview';
import {
  fetchListingsByStatus, fetchListingBundle, reviewVendorListing,
  setListingMerchandising, subscribeToListings, fetchStaffRoster,
  fetchCoversForListings, fetchMediaCounts, unpublishVendorListing,
} from '../../lib/api';
import { deleteListingAndMedia } from '../../lib/listingActions';
import { ConfirmDialog } from '../../components/listing/ConfirmDialog';
import {
  VendorListing, ListingBundle, ListingStatus, ListingBadge,
  LISTING_CATEGORY_LABELS, StaffProfile, ListingMedia,
} from '../../types';
import { StatusPill } from '../salesman/ListingEditor';

// The admin's listing review queue. Separate from Vendor Approvals, which
// answers a different question — see the README. Nothing an agent writes
// reaches the public site without passing through this screen.

const TABS: { id: ListingStatus | 'all'; label: string }[] = [
  { id: 'pending_review', label: 'In review' },
  { id: 'published', label: 'Live' },
  { id: 'rejected', label: 'Sent back' },
  { id: 'draft', label: 'Drafts' },
  { id: 'all', label: 'All' },
];

const ALL_BADGES: ListingBadge[] = ['choice', 'bestseller', 'premium', 'budget', 'new'];

// Content-only, so the combined Vendors screen can render it in a tab
// alongside applications. The page wrapper below keeps /admin/listings
// working as its own route.
export const AdminListings: React.FC = () => (
  <Page>
    <TopHeader title="Listing Review" subtitle="Full vendor profiles waiting to go live on the public site" />
    <Main><ListingReviewPanel /></Main>
  </Page>
);

export const ListingReviewPanel: React.FC<{ onPendingCount?: (n: number) => void }> = ({ onPendingCount }) => {
  const [tab, setTab] = useState<ListingStatus | 'all'>('pending_review');
  const [listings, setListings] = useState<VendorListing[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [owners, setOwners] = useState<Map<string, string>>(new Map());
  const [covers, setCovers] = useState<Map<string, ListingMedia>>(new Map());
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, pending, live, staff] = await Promise.all([
        fetchListingsByStatus(tab === 'all' ? undefined : tab),
        fetchListingsByStatus('pending_review'),
        fetchListingsByStatus('published'),
        fetchStaffRoster(),
      ]);
      setListings(rows);
      setPendingCount(pending.length);
      onPendingCount?.(pending.length);
      setLiveCount(live.length);
      setOwners(new Map(staff.map((s: StaffProfile) => [s.id, s.full_name])));

      const ids = rows.map((r) => r.id);
      const [coverMap, countMap] = await Promise.all([
        fetchCoversForListings(ids),
        fetchMediaCounts(ids),
      ]);
      setCovers(coverMap);
      setPhotoCounts(countMap);
    } catch (err: any) {
      setError(err?.message || 'Could not load listings');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // vendor_listings is in the realtime publication (0015), so a submission
  // from an agent in the field appears here without the admin refreshing.
  useEffect(() => subscribeToListings(load), [load]);

  return (
      <>
        <div className="space-y-6">
          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Waiting on you" value={pendingCount} icon="pending_actions" tone={pendingCount > 0 ? 'dark' : 'default'} />
            <StatTile label="Live listings" value={liveCount} icon="public" />
          </div>

          <nav className="flex gap-1.5 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  tab === t.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-100 hover:border-slate-200'
                }`}
              >
                {t.label}
                {t.id === 'pending_review' && pendingCount > 0 && (
                  <span className="ml-2 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <ListingGrid
            listings={listings}
            loading={loading}
            emptyLabel={tab === 'pending_review' ? 'Nothing waiting for review.' : 'Nothing here.'}
            meta={(l) => ({
              cover: covers.get(l.id),
              photoCount: photoCounts.get(l.id) ?? 0,
              footnote: [
                l.owner_salesman_id ? owners.get(l.owner_salesman_id) ?? 'Unknown' : null,
                l.submitted_at ? new Date(l.submitted_at).toLocaleDateString() : null,
              ].filter(Boolean).join(' · '),
            })}
            statusSlot={(l) => <StatusPill status={l.status} />}
            onOpen={(l) => setOpenId(l.id)}
          />
        </div>

        {openId && (
          <ReviewModal
            listingId={openId}
            onClose={() => setOpenId(null)}
            onDone={() => { setOpenId(null); load(); }}
          />
        )}
      </>
  );
};

const ReviewModal: React.FC<{ listingId: string; onClose: () => void; onDone: () => void }> = ({
  listingId, onClose, onDone,
}) => {
  const [bundle, setBundle] = useState<ListingBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [takingDown, setTakingDown] = useState(false);
  const [takedownReason, setTakedownReason] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [badges, setBadges] = useState<ListingBadge[]>([]);
  const [isPartner, setIsPartner] = useState(false);
  const [offerText, setOfferText] = useState('');
  const [sortWeight, setSortWeight] = useState(0);
  const [merchSaved, setMerchSaved] = useState(false);

  useEffect(() => {
    fetchListingBundle(listingId)
      .then((b) => {
        setBundle(b);
        setBadges(b.listing.badges);
        setIsPartner(b.listing.is_partner);
        setOfferText(b.listing.offer_text ?? '');
        setSortWeight(b.listing.sort_weight);
      })
      .catch((err) => setError(err?.message || 'Could not load this listing'));
  }, [listingId]);

  const decide = async (approve: boolean) => {
    if (!approve && !reason.trim()) {
      setError('Give a reason — the agent has to know what to fix.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Merchandising is saved BEFORE approving, so a listing that goes live
      // with a "Premium" badge does so in one step rather than appearing
      // unbadged on the public site for however long it takes the admin to
      // reopen it.
      if (approve) await saveMerchandising(true);
      await reviewVendorListing(listingId, approve, approve ? undefined : reason.trim());
      onDone();
    } catch (err: any) {
      setError(err?.message || 'That did not go through');
      setBusy(false);
    }
  };

  const saveMerchandising = async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      await setListingMerchandising(listingId, {
        badges,
        is_partner: isPartner,
        offer_text: offerText.trim() || null,
        sort_weight: sortWeight,
      });
      if (!silent) {
        setMerchSaved(true);
        setTimeout(() => setMerchSaved(false), 2500);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not save the badges');
      throw err;
    } finally {
      if (!silent) setBusy(false);
    }
  };

  const takeDown = async () => {
    if (!takedownReason.trim()) {
      setError('Give a reason — the agent has to know why it came down.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unpublishVendorListing(listingId, takedownReason.trim());
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not take that listing down');
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteListingAndMedia(listingId, false, true);
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not delete that listing');
      setConfirmingDelete(false);
      setBusy(false);
    }
  };

  if (!bundle) {
    return (
      <Modal title="Listing" onClose={onClose} xl>
        <p className="text-slate-400 text-sm">{error || 'Loading…'}</p>
      </Modal>
    );
  }

  const l = bundle.listing;
  const decidable = l.status === 'pending_review';

  return (
    <Modal title={l.name} onClose={onClose} xl>
      <div className="space-y-8">
        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">{error}</div>
        )}

        <ListingPreview bundle={bundle} />

        {/* Merchandising. Admin-only at the database level (0015's guard
            trigger), which is why this panel exists here and nowhere in the
            agent's editor. */}
        <section className="border-t border-slate-100 pt-6 space-y-5">
          <div>
            <h3 className="font-geist font-semibold text-slate-800 text-sm">Badges & placement</h3>
            <p className="text-xs text-slate-400 mt-1">
              Commercial decisions, admin-only. Never set from the agent's editor.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {ALL_BADGES.map((b) => {
              const on = badges.includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBadges(on ? badges.filter((x) => x !== b) : [...badges, b])}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-all ${
                    on ? 'border-transparent' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {on ? <BadgeChip badge={b} /> : b.replace('_', ' ')}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setIsPartner(!isPartner)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-all ${
                isPartner ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
              }`}
            >
              MDE Partner
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Offer ribbon</label>
              <input
                value={offerText}
                onChange={(e) => setOfferText(e.target.value)}
                placeholder="Upto ₹30,000 savings"
                className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Sort weight</label>
              <input
                type="number"
                value={sortWeight}
                onChange={(e) => setSortWeight(Number(e.target.value) || 0)}
                className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
              />
              <p className="text-[11px] text-slate-400">Higher pins it further up the grid.</p>
            </div>
          </div>

          {!decidable && (
            <button
              type="button"
              onClick={() => saveMerchandising()}
              disabled={busy}
              className="px-5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {merchSaved ? 'Saved' : busy ? 'Saving…' : 'Save badges'}
            </button>
          )}
        </section>

        {!decidable && (
          <section className="border-t border-slate-100 pt-6 space-y-4">
            {l.status === 'published' && !takingDown && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">public</span>
                Live on the public site
                {l.slug && <span className="text-emerald-700/70 text-xs">/{l.slug}</span>}
              </div>
            )}

            {takingDown && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Why is it coming down?
                </label>
                <textarea
                  value={takedownReason}
                  onChange={(e) => setTakedownReason(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="The venue has closed for renovation until March."
                  className="w-full p-3.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm resize-none"
                />
                <p className="text-[11px] text-slate-400">
                  It leaves the public site immediately and goes back to the agent, who can edit and resubmit.
                  The URL is kept, so republishing lands on the same link.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              {takingDown ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setTakingDown(false); setTakedownReason(''); setError(null); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={takeDown}
                    disabled={busy || !takedownReason.trim()}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-7 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
                  >
                    {busy ? 'Taking down…' : 'Take down'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={busy}
                    className="px-6 py-3 rounded-xl text-sm font-bold text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                    Delete permanently
                  </button>
                  {l.status === 'published' && (
                    <button
                      type="button"
                      onClick={() => setTakingDown(true)}
                      disabled={busy}
                      className="px-7 py-3 rounded-xl text-sm font-bold text-amber-700 border border-amber-200 hover:bg-amber-50 disabled:opacity-50 flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">visibility_off</span>
                      Take down
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete “${l.name}” permanently?`}
            confirmLabel="Delete permanently"
            confirmPhrase={l.name}
            busy={busy}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={destroy}
            body={
              <>
                Removes the listing, its {bundle.media.length} photo(s) from Cloudinary, and the public
                catalog entry — including any couple's shortlist that points at it. There is no undo.
                {l.status === 'published' && (
                  <strong className="block mt-2 text-slate-700">
                    This listing is currently live. Taking it down instead keeps the record and lets the
                    agent fix and resubmit it.
                  </strong>
                )}
              </>
            }
          />
        )}

        {decidable && (
          <section className="border-t border-slate-100 pt-6 space-y-4">
            {rejecting && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  What needs fixing?
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Photos are too dark to use, and the per-plate price is missing."
                  className="w-full p-3.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm resize-none"
                />
                <p className="text-[11px] text-slate-400">
                  This goes straight to the agent at the top of their editor.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              {!rejecting ? (
                <>
                  <button
                    type="button"
                    onClick={() => setRejecting(true)}
                    disabled={busy}
                    className="px-6 py-3 rounded-xl text-sm font-bold text-amber-700 border border-amber-200 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Send back
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={busy}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy ? 'Publishing…' : 'Approve & publish'}
                    <span className="material-symbols-outlined text-[18px]">public</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setRejecting(false); setReason(''); setError(null); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(false)}
                    disabled={busy || !reason.trim()}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-7 py-3 rounded-xl font-bold text-sm disabled:opacity-40"
                  >
                    {busy ? 'Sending…' : 'Send back to agent'}
                  </button>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
};
