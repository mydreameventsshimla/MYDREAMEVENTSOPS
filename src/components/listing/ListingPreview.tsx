import React from 'react';
import { cloudinaryUrl } from '../../lib/cloudinary';
import { SafeImage } from './SafeImage';
import {
  ListingBundle, LISTING_CATEGORY_LABELS, ListingBadge, VENUE_TYPE_LABELS,
} from '../../types';

// A read-only render of everything an agent filled in, laid out roughly the
// way the public detail page will be. An admin approving a listing is
// deciding whether it's good enough for couples to see, so showing them a
// database form would be asking the wrong question — they need to see what
// the couple will see.

const BADGE_LABELS: Record<ListingBadge, string> = {
  choice: "MDE's Choice",
  bestseller: 'Bestseller',
  premium: 'Premium',
  budget: 'Budget Friendly',
  new: 'New',
};

const BADGE_STYLES: Record<ListingBadge, string> = {
  choice: 'bg-pink-500 text-white',
  bestseller: 'bg-rose-500 text-white',
  premium: 'bg-amber-500 text-white',
  budget: 'bg-emerald-500 text-white',
  new: 'bg-sky-500 text-white',
};

export const BadgeChip: React.FC<{ badge: ListingBadge }> = ({ badge }) => (
  <span className={`text-[10px] font-bold px-2.5 py-1 rounded tracking-wide ${BADGE_STYLES[badge]}`}>
    {BADGE_LABELS[badge]}
  </span>
);

const money = (n: number | null) =>
  n === null ? null : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const ListingPreview: React.FC<{ bundle: ListingBundle }> = ({ bundle }) => {
  const { listing: l, media, spaces, rooms, packages } = bundle;
  const cover = media.find((m) => m.role === 'cover') ?? media[0];
  const gallery = media.filter((m) => m.id !== cover?.id);

  const perPlate = l.per_plate_veg ?? l.per_plate_nonveg;
  const capacity =
    l.capacity_min !== null && l.capacity_max !== null
      ? `${l.capacity_min} – ${l.capacity_max}`
      : l.capacity_max !== null
        ? `up to ${l.capacity_max}`
        : null;

  return (
    <div className="space-y-8">
      {/* Cover + identity, i.e. the grid card as a couple would meet it */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-100 aspect-[16/7]">
        {cover ? (
          <SafeImage
            src={cloudinaryUrl(cover.cloudinary_public_id, { width: 1200, height: 525, version: cover.cloudinary_version })}
            alt={cover.alt || l.name}
            label="Cover photo missing — the file was deleted"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-2">
            <span className="material-symbols-outlined text-4xl">image_not_supported</span>
            <span className="text-xs font-semibold">No cover photo</span>
          </div>
        )}

        {(l.badges.length > 0 || l.is_partner || l.offer_text) && (
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
            {l.is_partner && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded bg-slate-900/80 text-white tracking-wide backdrop-blur-sm">
                MDE Partner
              </span>
            )}
            {l.badges.map((b) => <BadgeChip key={b} badge={b} />)}
            {l.offer_text && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded bg-white/90 text-slate-800 tracking-wide">
                {l.offer_text}
              </span>
            )}
          </div>
        )}
      </div>

      <header className="space-y-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="font-geist text-2xl font-semibold text-slate-800">{l.name}</h2>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {LISTING_CATEGORY_LABELS[l.category]}
          </span>
        </div>
        {l.tagline && <p className="text-slate-500">{l.tagline}</p>}
        {l.venue_types.length > 0 && (
          <p className="text-sm text-slate-400">
            {l.venue_types.map((t) => VENUE_TYPE_LABELS[t]).join(', ')}
          </p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500 pt-2">
          {(l.locality || l.city) && (
            <Fact icon="location_on" text={[l.locality, l.city].filter(Boolean).join(', ')} />
          )}
          {perPlate !== null && <Fact icon="restaurant" text={`Per plate ${money(perPlate)}+`} />}
          {capacity && <Fact icon="group" text={`${capacity} guests`} />}
          {l.rooms_count !== null && <Fact icon="hotel" text={`${l.rooms_count} rooms`} />}
          {/* The property's official classification, kept visually distinct
              from the review score below so the two are never read as one. */}
          {l.hotel_star_rating !== null && <Fact icon="apartment" text={`${l.hotel_star_rating}-star property`} />}
          {/* Deliberately absent when null rather than shown as 0 — a listing
              with no reviews yet must not render as a zero-star venue. */}
          {l.rating !== null && <Fact icon="star" text={`${l.rating} (${l.reviews_count} reviews)`} />}
        </div>
      </header>

      {l.description && (
        <Section title="About">
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{l.description}</p>
        </Section>
      )}

      {l.amenities.length > 0 && (
        <Section title="Services & amenities">
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
            {l.amenities.map((a) => (
              <li key={a} className="flex items-center gap-2 text-sm text-slate-600">
                <span className="material-symbols-outlined text-[16px] text-emerald-500">check</span>
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {spaces.length > 0 && (
        <Section title="Halls & event spaces">
          <PreviewTable
            head={['Space', 'Type', 'Area', 'Pax']}
            rows={spaces.map((s) => [
              s.name,
              s.space_type ?? '—',
              s.area_sqft ? `${s.area_sqft.toLocaleString('en-IN')} sq ft` : '—',
              s.capacity_pax?.toString() ?? '—',
            ])}
          />
        </Section>
      )}

      {rooms.length > 0 && (
        <Section title="Room types">
          <PreviewTable
            head={['Room', 'Area', 'How many']}
            rows={rooms.map((r) => [
              r.name,
              r.area_sqft ? `${r.area_sqft.toLocaleString('en-IN')} sq ft` : '—',
              r.room_count?.toString() ?? '—',
            ])}
          />
        </Section>
      )}

      {packages.length > 0 && (
        <Section title="Packages">
          <div className="grid md:grid-cols-2 gap-3">
            {packages.map((p) => (
              <div key={p.id} className="border border-slate-100 rounded-xl p-4 space-y-1">
                <div className="flex justify-between items-baseline gap-3">
                  <span className="font-semibold text-sm text-slate-800">{p.name}</span>
                  {p.price !== null && (
                    <span className="text-sm font-bold text-slate-700 whitespace-nowrap">
                      {money(p.price)}
                      {p.unit && <span className="text-[11px] font-normal text-slate-400"> {p.unit.replace('_', ' ')}</span>}
                    </span>
                  )}
                </div>
                {p.description && <p className="text-xs text-slate-500">{p.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(l.locality_highlights.length > 0 || l.distance_airport_km !== null || l.distance_railway_km !== null) && (
        <Section title="The area">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-500 mb-3">
            {l.distance_airport_km !== null && <Fact icon="flight" text={`${l.distance_airport_km} km from airport`} />}
            {l.distance_railway_km !== null && <Fact icon="train" text={`${l.distance_railway_km} km from railway`} />}
            {l.parking_capacity !== null && <Fact icon="local_parking" text={`${l.parking_capacity} cars`} />}
          </div>
          {l.locality_highlights.length > 0 && (
            <ul className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
              {l.locality_highlights.map((h) => (
                <li key={h} className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="material-symbols-outlined text-[16px] text-slate-300">near_me</span>
                  {h}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {gallery.length > 0 && (
        <Section title={`Gallery (${gallery.length})`}>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {gallery.map((m) => (
              <SafeImage
                key={m.id}
                src={cloudinaryUrl(m.cloudinary_public_id, { width: 300, height: 225, version: m.cloudinary_version })}
                alt={m.alt || ''}
                className="rounded-lg aspect-[4/3] object-cover bg-slate-100 w-full"
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Internal — not shown publicly">
        <dl className="grid md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Row label="Phone" value={l.phone} />
          <Row label="Email" value={l.email} />
          <Row label="Website" value={l.website} />
          <Row label="Instagram" value={l.instagram} />
          <Row label="Address" value={l.address} />
          <Row label="Map coordinates" value={l.map_lat !== null && l.map_lng !== null ? `${l.map_lat}, ${l.map_lng}` : null} />
          <Row label="Alcohol allowed" value={triState(l.alcohol_allowed)} />
          <Row label="Outside catering" value={triState(l.outside_catering_allowed)} />
          <Row label="Vegetarian only" value={triState(l.veg_only)} />
        </dl>
      </Section>
    </div>
  );
};

// null is rendered as "not asked", never as "No" — the difference matters
// when an admin is deciding whether the listing is complete enough to go live.
const triState = (v: boolean | null) => (v === null ? 'Not asked' : v ? 'Yes' : 'No');

const Fact: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="material-symbols-outlined text-[16px] text-slate-300">{icon}</span>
    {text}
  </span>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{title}</h3>
    {children}
  </section>
);

const Row: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="flex gap-2">
    <dt className="text-slate-400 min-w-[130px]">{label}</dt>
    <dd className={value ? 'text-slate-700' : 'text-slate-300'}>{value || 'Not provided'}</dd>
  </div>
);

const PreviewTable: React.FC<{ head: string[]; rows: string[][] }> = ({ head, rows }) => (
  <div className="overflow-x-auto border border-slate-100 rounded-xl">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
        <tr>{head.map((h) => <th key={h} className="text-left px-4 py-2.5 font-semibold">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'font-medium text-slate-700' : 'text-slate-500'}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
