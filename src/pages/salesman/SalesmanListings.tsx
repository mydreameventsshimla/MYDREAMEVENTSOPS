import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Main, TopHeader, Modal } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import {
  fetchMyListings, createVendorListing, fetchMyVendorApplications, deleteVendorApplication,
  fetchCoversForListings, fetchMediaCounts,
} from '../../lib/api';
import { ListingGrid } from '../../components/listing/ListingGrid';
import {
  VendorListing, ListingCategory, LISTING_CATEGORY_LABELS,
  VendorApplication, APPLICATION_ROLE_TO_CATEGORY, ListingMedia,
} from '../../types';
import { StatusPill } from './ListingEditor';
import { ConfirmDialog } from '../../components/listing/ConfirmDialog';
import { deleteListingAndMedia, deletability } from '../../lib/listingActions';

// Every listing this agent owns, in whatever state it's in. This is the
// screen they live on: "Add Vendor" captures a lead in thirty seconds
// standing in a lobby, and the profile gets built out here afterwards.

export const SalesmanListings: React.FC = () => {
  const { staff } = useStaff();
  const navigate = useNavigate();
  const [listings, setListings] = useState<VendorListing[]>([]);
  const [applications, setApplications] = useState<VendorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VendorListing | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [alsoRemoveApp, setAlsoRemoveApp] = useState(true);
  const [dismissingApp, setDismissingApp] = useState<VendorApplication | null>(null);
  const [covers, setCovers] = useState<Map<string, ListingMedia>>(new Map());
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    if (!staff) return;
    setLoading(true);
    try {
      const [mine, apps] = await Promise.all([
        fetchMyListings(staff.id),
        fetchMyVendorApplications(staff.id),
      ]);
      setListings(mine);
      setApplications(apps);

      const ids = mine.map((l) => l.id);
      const [coverMap, countMap] = await Promise.all([
        fetchCoversForListings(ids),
        fetchMediaCounts(ids),
      ]);
      setCovers(coverMap);
      setPhotoCounts(countMap);
    } catch (err: any) {
      setError(err?.message || 'Could not load your listings');
    } finally {
      setLoading(false);
    }
  }, [staff]);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const { photosDeleted, photosFailed, applicationRemoved } =
        await deleteListingAndMedia(pendingDelete.id, alsoRemoveApp);

      const parts = [`“${pendingDelete.name}” deleted, along with ${photosDeleted} photo(s).`];
      if (photosFailed > 0) {
        parts.push(`${photosFailed} photo(s) could not be removed from Cloudinary — tell an admin.`);
      }
      if (alsoRemoveApp && pendingDelete.application_id) {
        parts.push(
          applicationRemoved
            ? 'The vendor lead was withdrawn too.'
            : 'The vendor lead could NOT be withdrawn — it will still show as "approved, no profile".'
        );
      }
      setNote(parts.join(' '));
      setPendingDelete(null);
      await load();
    } catch (err: any) {
      setError(err?.code === '42501'
        ? 'You can only delete your own listings, and only while they are a draft or have been sent back.'
        : err?.message || 'Could not delete that listing');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const startListing = async (category: ListingCategory, name: string, applicationId?: string) => {
    setError(null);
    try {
      const id = await createVendorListing(category, name, applicationId ?? null);
      navigate(`/salesman/listing/${id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the listing');
      setCreating(false);
    }
  };

  // An approved application with no listing behind it yet is the single most
  // actionable thing on this screen — the vendor has already said yes and is
  // waiting to appear on the site. Surfaced above the list rather than left
  // for the agent to cross-reference two tabs.
  const listedApplicationIds = new Set(listings.map((l) => l.application_id).filter(Boolean));
  const awaitingBuild = applications.filter(
    (a) => a.status === 'approved' && !listedApplicationIds.has(a.id)
  );

  return (
    <Page>
      <TopHeader
        title="Vendor Listings"
        subtitle="Build and maintain the profiles that appear on the public site"
        right={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New listing
          </button>
        }
      />
      <Main>
        <div className="space-y-6">
          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">{error}</div>
          )}

          {note && (
            <div className="bg-slate-100 border border-slate-200 text-slate-700 text-sm px-4 py-3 rounded-xl flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] mt-px">delete</span>
              <span className="flex-1">{note}</span>
              <button type="button" onClick={() => setNote(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          )}

          {awaitingBuild.length > 0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
              <div>
                <h2 className="font-geist font-semibold text-amber-900 text-sm">
                  {awaitingBuild.length} approved vendor{awaitingBuild.length > 1 ? 's' : ''} with no profile yet
                </h2>
                <p className="text-xs text-amber-700/80 mt-1">
                  They've been approved but won't appear anywhere until a profile exists.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {awaitingBuild.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => startListing(APPLICATION_ROLE_TO_CATEGORY[a.role], a.applicant_name, a.id)}
                    className="relative bg-white border border-amber-200 hover:border-amber-400 rounded-xl px-4 py-3 pr-9 text-left transition-colors group cursor-pointer"
                  >
                    {/* Without this there is no way to make a lead you no
                        longer want stop asking to be built. */}
                    <button
                      type="button"
                      title="Withdraw this lead"
                      onClick={(e) => { e.stopPropagation(); setDismissingApp(a); }}
                      className="absolute top-2 right-2 text-amber-300 hover:text-rose-500 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                    <p className="text-sm font-semibold text-slate-800">{a.applicant_name}</p>
                    <p className="text-[11px] text-slate-400">
                      {a.role}{a.city ? ` · ${a.city}` : ''}
                    </p>
                    <span className="text-[11px] font-bold text-amber-700 group-hover:text-amber-900 inline-flex items-center gap-0.5 mt-1.5">
                      Build profile
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <ListingGrid
            listings={listings}
            loading={loading}
            emptyLabel="No listings yet. Start one with “New listing”, or build a profile for an approved vendor above."
            meta={(l) => ({
              cover: covers.get(l.id),
              photoCount: photoCounts.get(l.id) ?? 0,
              footnote: l.status === 'rejected' && l.rejection_reason
                ? l.rejection_reason
                : `Edited ${new Date(l.updated_at).toLocaleDateString()}`,
            })}
            statusSlot={(l) => <StatusPill status={l.status} />}
            action={(l) => (
              <span onClick={(e) => e.stopPropagation()}>
                <RowActions listing={l} onDelete={() => { setAlsoRemoveApp(true); setPendingDelete(l); }} />
              </span>
            )}
            onOpen={(l) => navigate(`/salesman/listing/${l.id}`)}
          />
        </div>

        {creating && <NewListingModal onClose={() => setCreating(false)} onCreate={startListing} />}

        {pendingDelete && (
          <ConfirmDialog
            title={`Delete “${pendingDelete.name}”?`}
            confirmLabel="Delete listing"
            confirmPhrase={pendingDelete.name}
            busy={deleting}
            onCancel={() => setPendingDelete(null)}
            onConfirm={confirmDelete}
            body={
              <>
                This removes the listing, its halls, room types and packages, and permanently deletes
                every photo from Cloudinary. There is no undo and nothing to restore from.
              </>
            }
            extra={
              pendingDelete.application_id ? (
                <label className="flex items-start gap-3 bg-slate-50 rounded-xl p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoRemoveApp}
                    onChange={(e) => setAlsoRemoveApp(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-rose-500"
                  />
                  <span className="text-xs text-slate-600 leading-relaxed">
                    <strong className="font-semibold text-slate-700">Withdraw the vendor lead as well.</strong>{' '}
                    Leave this unticked and the vendor stays on your approved list and comes straight back
                    as a “Build profile” card — useful if you're rebuilding the profile, confusing if you're not.
                  </span>
                </label>
              ) : null
            }
          />
        )}

        {dismissingApp && (
          <ConfirmDialog
            title={`Withdraw “${dismissingApp.applicant_name}”?`}
            confirmLabel="Withdraw lead"
            busy={deleting}
            onCancel={() => setDismissingApp(null)}
            onConfirm={async () => {
              setDeleting(true);
              try {
                await deleteVendorApplication(dismissingApp.id);
                setNote(`“${dismissingApp.applicant_name}” withdrawn.`);
                setDismissingApp(null);
                await load();
              } catch (err: any) {
                setError(err?.code === '42501'
                  ? 'You can only withdraw leads you submitted yourself.'
                  : err?.message || 'Could not withdraw that lead');
                setDismissingApp(null);
              } finally {
                setDeleting(false);
              }
            }}
            body={
              <>
                Removes the vendor from your approved list so it stops appearing here. It does not touch any
                listing — build the profile instead if you still want this vendor on the site.
              </>
            }
          />
        )}
      </Main>
    </Page>
  );
};

const NewListingModal: React.FC<{
  onClose: () => void;
  onCreate: (category: ListingCategory, name: string) => void;
}> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ListingCategory>('venue');
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="New listing" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          onCreate(category, name.trim());
        }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ListingCategory)}
            className="w-full p-3.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
          >
            {(Object.keys(LISTING_CATEGORY_LABELS) as ListingCategory[]).map((c) => (
              <option key={c} value={c}>{LISTING_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400">
            Category decides which fields the editor shows, and can't be changed later.
          </p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 text-[12px] text-slate-500 leading-relaxed">
          Starting here needs <strong className="font-semibold text-slate-700">no separate vendor application</strong>.
          You fill in the profile, submit it, and an admin reviews it once — that single review covers both whether
          we work with this vendor and whether the profile is good enough to publish.
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Vendor / property name</label>
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Wildflower Hall, Shimla"
            className="w-full p-3.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create & edit'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Delete is only offered when RLS would actually allow it. When it wouldn't,
// the reason shows on hover rather than the button silently vanishing --
// "why can't I delete this" is a support question, and the answer ("it's with
// an admin", "it's live") is also the instruction for what to do instead.
const RowActions: React.FC<{ listing: VendorListing; onDelete: () => void }> = ({ listing, onDelete }) => {
  const { canDelete, reason } = deletability(listing);
  if (!canDelete) {
    return (
      <span className="text-slate-200 cursor-help" title={reason ?? ''}>
        <span className="material-symbols-outlined text-[18px]">lock</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onDelete}
      title="Delete this listing"
      className="text-slate-300 hover:text-rose-500 transition-colors p-1"
    >
      <span className="material-symbols-outlined text-[18px]">delete</span>
    </button>
  );
};
