import React, { useMemo, useState } from 'react';
import { cloudinaryUrl } from '../../lib/cloudinary';
import { SafeImage } from './SafeImage';
import { BadgeChip } from './ListingPreview';
import {
  VendorListing, ListingMedia, ListingCategory, LISTING_CATEGORY_LABELS,
} from '../../types';

// A searchable, category-grouped grid of listings, shared by the sales and
// admin sides so the same vendor looks the same to whoever is looking at it.
//
// Grouped by category rather than shown as one flat run because that is how
// people actually look for a vendor — "which photographers do we have in
// Bengaluru", not "show me row 47". With a few hundred listings a flat list
// stops being browsable at all, and the category is the first thing anyone
// filters on mentally.

export interface ListingCardMeta {
  cover?: ListingMedia;
  photoCount?: number;
  footnote?: string | null;
}

interface Props {
  listings: VendorListing[];
  meta: (listing: VendorListing) => ListingCardMeta;
  onOpen: (listing: VendorListing) => void;
  // Rendered in the card's top-right — delete buttons, lock icons, whatever
  // the surrounding screen needs. Kept as a slot so this component doesn't
  // have to know about either side's permissions.
  action?: (listing: VendorListing) => React.ReactNode;
  statusSlot?: (listing: VendorListing) => React.ReactNode;
  emptyLabel?: string;
  loading?: boolean;
}

export const ListingGrid: React.FC<Props> = ({
  listings, meta, onOpen, action, statusSlot, emptyLabel = 'Nothing here.', loading,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ListingCategory | 'all'>('all');

  // Only categories that actually have listings get a chip. A filter for
  // "Mehendi (0)" is a dead end that makes the real options harder to find.
  const presentCategories = useMemo(() => {
    const counts = new Map<ListingCategory, number>();
    for (const l of listings) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [listings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (category !== 'all' && l.category !== category) return false;
      if (!q) return true;
      // Name, city and locality together — an agent searching "shimla"
      // expects every Shimla venue, not only ones with it in the name.
      return [l.name, l.city, l.locality, l.tagline]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(q));
    });
  }, [listings, query, category]);

  const grouped = useMemo(() => {
    const byCategory = new Map<ListingCategory, VendorListing[]>();
    for (const l of filtered) {
      if (!byCategory.has(l.category)) byCategory.set(l.category, []);
      byCategory.get(l.category)!.push(l);
    }
    for (const rows of byCategory.values()) {
      rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-[20px]">
            search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, city or area…"
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400 whitespace-nowrap">
          {filtered.length} of {listings.length}
        </span>
      </div>

      {presentCategories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <CategoryChip active={category === 'all'} onClick={() => setCategory('all')} label="All" count={listings.length} />
          {presentCategories.map(([cat, count]) => (
            <CategoryChip
              key={cat}
              active={category === cat}
              onClick={() => setCategory(cat)}
              label={LISTING_CATEGORY_LABELS[cat]}
              count={count}
            />
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm py-12 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-400 text-sm py-12 text-center">
          {listings.length === 0 ? emptyLabel : `Nothing matches “${query}”.`}
        </p>
      ) : (
        <div className="space-y-9">
          {grouped.map(([cat, rows]) => (
            <section key={cat} className="space-y-4">
              <header className="flex items-baseline gap-2">
                <h3 className="font-geist font-semibold text-slate-700 text-sm">
                  {LISTING_CATEGORY_LABELS[cat]}
                </h3>
                <span className="text-xs text-slate-400">{rows.length}</span>
              </header>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {rows.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    meta={meta(l)}
                    onOpen={() => onOpen(l)}
                    action={action?.(l)}
                    statusSlot={statusSlot?.(l)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

const CategoryChip: React.FC<{ active: boolean; onClick: () => void; label: string; count: number }> = ({
  active, onClick, label, count,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
      active ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
    }`}
  >
    {label}
    <span className={`ml-1.5 ${active ? 'text-white/50' : 'text-slate-300'}`}>{count}</span>
  </button>
);

export const ListingCard: React.FC<{
  listing: VendorListing;
  meta: ListingCardMeta;
  onOpen: () => void;
  action?: React.ReactNode;
  statusSlot?: React.ReactNode;
}> = ({ listing: l, meta, onOpen, action, statusSlot }) => {
  const { cover, photoCount, footnote } = meta;
  const perPlate = l.per_plate_veg ?? l.per_plate_nonveg ?? l.price_starting;
  const capacity =
    l.capacity_min !== null && l.capacity_max !== null
      ? `${l.capacity_min}–${l.capacity_max}`
      : l.capacity_max !== null ? `up to ${l.capacity_max}` : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden hover:border-slate-300 hover:shadow-md transition-all group flex flex-col">
      <button type="button" onClick={onOpen} className="text-left">
        <div className="relative aspect-[4/3] bg-slate-100">
          {cover ? (
            <SafeImage
              src={cloudinaryUrl(cover.cloudinary_public_id, {
                width: 600, height: 450, version: cover.cloudinary_version,
              })}
              alt={cover.alt || l.name}
              label="Cover file missing"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-1">
              <span className="material-symbols-outlined text-3xl">image_not_supported</span>
              <span className="text-[11px] font-semibold">No cover photo</span>
            </div>
          )}

          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            {l.is_partner && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-900/80 text-white tracking-wide backdrop-blur-sm">
                PARTNER
              </span>
            )}
            {l.badges.map((b) => <BadgeChip key={b} badge={b} />)}
          </div>

          {statusSlot && <div className="absolute top-2 right-2">{statusSlot}</div>}

          {typeof photoCount === 'number' && (
            <span
              className={`absolute bottom-2 right-2 text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm ${
                photoCount <= 1 ? 'bg-amber-500/90 text-white' : 'bg-black/50 text-white'
              }`}
            >
              {photoCount} photo{photoCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="p-4 space-y-2">
          <div>
            <p className="font-geist font-semibold text-slate-800 leading-snug truncate">{l.name}</p>
            <p className="text-xs text-slate-400 truncate">
              {[l.locality, l.city].filter(Boolean).join(', ') || 'No location yet'}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {perPlate !== null && <span>₹{perPlate.toLocaleString('en-IN')}+</span>}
            {capacity && <span>{capacity} guests</span>}
          </div>
        </div>
      </button>

      {(action || footnote) && (
        <div className="px-4 pb-3 pt-0 mt-auto flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="truncate">{footnote}</span>
          {action}
        </div>
      )}
    </div>
  );
};
