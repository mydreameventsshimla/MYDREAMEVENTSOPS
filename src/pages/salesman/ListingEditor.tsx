import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Page, Main, TopHeader } from '../../components/Shell';
import {
  TextField, NumberField, TextAreaField, SelectField, TriStateField, ChipsField, SectionCard,
} from '../../components/listing/Fields';
import { MediaManager } from '../../components/listing/MediaManager';
import { RepeatableSection, ColumnDef } from '../../components/listing/RepeatableSection';
import { AvailabilityEditor } from '../../components/listing/AvailabilityEditor';
import { ConfirmDialog } from '../../components/listing/ConfirmDialog';
import { deleteListingAndMedia, deletability } from '../../lib/listingActions';
import {
  fetchListingBundle, updateVendorListing, submitVendorListing,
} from '../../lib/api';
import {
  ListingBundle, VendorListing, ListingMedia, ListingSpace, ListingRoom, ListingPackage,
  LISTING_CATEGORY_LABELS, PriceUnit, SpaceType, VenueType, VENUE_TYPE_LABELS,
} from '../../types';

// The listing editor. One listing, seven steps, explicit save.
//
// WHY EXPLICIT SAVE AND NOT AUTOSAVE: the person using this is usually
// sitting across a table from the venue owner, reading numbers off a rate
// card and correcting them as the owner talks. Autosave would push half-typed
// prices to the server continuously, and — because the submit RPC validates
// completeness — could leave a listing in a state the agent never intended to
// commit. Child rows (halls, rooms, packages, photos) are different: adding
// or deleting one is already a deliberate discrete act, so those persist
// immediately.

const PRICE_UNITS: { value: PriceUnit; label: string }[] = [
  { value: 'per_plate', label: 'Per plate' },
  { value: 'per_event', label: 'Per event' },
  { value: 'per_day', label: 'Per day' },
  { value: 'per_hour', label: 'Per hour' },
];

const SPACE_TYPES: { value: SpaceType; label: string }[] = [
  { value: 'banquet', label: 'Banquet hall' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'lawn', label: 'Lawn' },
  { value: 'poolside', label: 'Poolside' },
  { value: 'terrace', label: 'Terrace' },
];

const AMENITY_SUGGESTIONS = [
  'Spa', 'Fitness centre', 'Heated swimming pool', 'Business centre', 'Conference room',
  'Valet parking', 'In-house decor', 'Bridal suite', 'Power backup', 'Air conditioning',
  'Wheelchair accessible', 'Pet friendly',
];

type StepId = 'basics' | 'photos' | 'pricing' | 'spaces' | 'availability' | 'amenities' | 'packages' | 'review';

export const ListingEditor: React.FC = () => {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();

  const [bundle, setBundle] = useState<ListingBundle | null>(null);
  const [draft, setDraft] = useState<VendorListing | null>(null);
  const [step, setStep] = useState<StepId>('basics');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [alsoRemoveApp, setAlsoRemoveApp] = useState(true);

  const load = useCallback(async () => {
    if (!listingId) return;
    setLoading(true);
    setError(null);
    try {
      const b = await fetchListingBundle(listingId);
      setBundle(b);
      setDraft(b.listing);
    } catch (err: any) {
      setError(err?.message || 'Could not load this listing');
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  // A listing under review or already live is read-only to its author. This
  // mirrors the RLS in migration 0015 rather than being the only thing
  // enforcing it — the UI going read-only is a courtesy so the agent doesn't
  // type into fields whose save is going to be rejected anyway.
  const readOnly = !!draft && draft.status !== 'draft' && draft.status !== 'rejected';
  const isVenue = draft?.category === 'venue';

  const dirty = useMemo(() => {
    if (!draft || !bundle) return false;
    return JSON.stringify(draft) !== JSON.stringify(bundle.listing);
  }, [draft, bundle]);

  // Mirrors submit_vendor_listing()'s validation exactly. Duplicated on
  // purpose: the RPC is the enforcement, this is so the agent can see what's
  // missing before they press submit and get a raise() in their face.
  const checklist = useMemo(() => {
    if (!draft || !bundle) return [];
    return [
      { label: 'Vendor name', ok: !!draft.name?.trim() },
      { label: 'City', ok: !!draft.city?.trim() },
      { label: 'At least one photo', ok: bundle.media.length > 0 },
      { label: 'A cover photo', ok: bundle.media.some((m) => m.role === 'cover') },
      { label: 'Description', ok: !!draft.description?.trim(), optional: true },
      { label: 'Contact phone', ok: !!draft.phone?.trim(), optional: true },
      {
        label: 'Guest capacity',
        ok: draft.capacity_min !== null || draft.capacity_max !== null,
        optional: !isVenue,
      },
      ...(isVenue
        ? [{ label: 'Venue type', ok: draft.venue_types.length > 0, optional: true }]
        : []),
    ];
  }, [draft, bundle, isVenue]);

  const blocking = checklist.filter((c) => !c.optional && !c.ok);

  const save = async () => {
    if (!draft || !listingId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateVendorListing(listingId, editableFields(draft));
      setBundle((b) => (b ? { ...b, listing: updated } : b));
      setDraft(updated);
      setSavedAt(new Date());
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!listingId) return;
    setSaving(true);
    setError(null);
    try {
      // Save first: submitting with unsaved edits would send the admin the
      // previous version while the agent watches their own screen show the
      // new one.
      if (dirty && draft) await updateVendorListing(listingId, editableFields(draft));
      await submitVendorListing(listingId);
      await load();
      setStep('review');
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!listingId) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteListingAndMedia(listingId, alsoRemoveApp);
      navigate('/salesman/listings');
    } catch (err: any) {
      setError(friendlyError(err));
      setConfirmingDelete(false);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <TopHeader title="Listing" />
        <Main><p className="text-slate-400 text-sm">Loading…</p></Main>
      </Page>
    );
  }

  if (!draft || !bundle) {
    return (
      <Page>
        <TopHeader title="Listing" />
        <Main>
          <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">
            {error || 'Listing not found.'}
          </div>
        </Main>
      </Page>
    );
  }

  const steps: { id: StepId; label: string; icon: string }[] = [
    { id: 'basics', label: 'Basics', icon: 'edit_note' },
    { id: 'photos', label: 'Photos', icon: 'photo_library' },
    { id: 'pricing', label: 'Pricing', icon: 'payments' },
    ...(isVenue ? [{ id: 'spaces' as StepId, label: 'Halls & Rooms', icon: 'meeting_room' }] : []),
    ...(isVenue ? [{ id: 'availability' as StepId, label: 'Availability', icon: 'calendar_month' }] : []),
    { id: 'amenities', label: isVenue ? 'Amenities & Area' : 'Highlights', icon: 'checklist' },
    { id: 'packages', label: 'Packages', icon: 'sell' },
    { id: 'review', label: 'Review', icon: 'task_alt' },
  ];

  const set = <K extends keyof VendorListing>(key: K, value: VendorListing[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <Page>
      <TopHeader
        title={draft.name || 'Untitled listing'}
        subtitle={`${LISTING_CATEGORY_LABELS[draft.category]}${draft.city ? ` · ${draft.city}` : ''}`}
        right={
          <div className="flex items-center gap-3">
            <StatusPill status={draft.status} />
            {!readOnly && (
              <>
                {savedAt && !dirty && (
                  <span className="text-xs text-slate-400">
                    Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                </button>
              </>
            )}
            {deletability(draft).canDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                title="Delete this listing"
                className="text-slate-400 hover:text-rose-500 transition-colors p-2"
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/salesman/listings')}
              className="text-slate-400 hover:text-slate-600 p-2"
              aria-label="Back to listings"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        }
      />
      <Main>
        <div className="space-y-6">
          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] mt-px">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* A listing that was live and got taken down is a different event
              from one that never passed review, and "Sent back for changes"
              badly misdescribes it — published_at tells the two apart. */}
          {draft.status === 'rejected' && draft.rejection_reason && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 px-5 py-4 rounded-xl space-y-1">
              <p className="font-semibold text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {draft.published_at ? 'visibility_off' : 'undo'}
                </span>
                {draft.published_at ? 'Taken down from the public site' : 'Sent back for changes'}
              </p>
              <p className="text-sm">{draft.rejection_reason}</p>
              <p className="text-xs text-amber-700/70 pt-1">
                {draft.published_at
                  ? 'Fix the above and submit again — it will go back to the same URL.'
                  : 'Fix the above and submit again.'}
              </p>
            </div>
          )}

          {draft.status === 'pending_review' && (
            <div className="bg-sky-50 border border-sky-200 text-sky-900 px-5 py-4 rounded-xl text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
              With an admin for review — locked until they approve it or send it back.
            </div>
          )}

          {draft.status === 'published' && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-5 py-4 rounded-xl text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">public</span>
              Live on the public site. Ask an admin if something needs changing.
            </div>
          )}

          <nav className="flex gap-1.5 overflow-x-auto pb-1">
            {steps.map((s) => {
              const active = step === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(s.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                    active ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-100 hover:border-slate-200'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                  {s.label}
                </button>
              );
            })}
          </nav>

          {step === 'basics' && (
            <SectionCard title="The basics" description="What a couple sees first — name, where it is, and how to reach it.">
              <TextField label="Vendor / property name" value={draft.name} onChange={(v) => set('name', v)} required disabled={readOnly} />
              <TextField
                label="Tagline"
                value={draft.tagline}
                onChange={(v) => set('tagline', v)}
                placeholder="A 5-star hillside resort with valley views"
                hint="One line, shown under the name on the detail page."
                disabled={readOnly}
              />
              {isVenue && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      What kind of venue
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(VENUE_TYPE_LABELS) as VenueType[]).map((t) => {
                        const on = draft.venue_types.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            disabled={readOnly}
                            onClick={() =>
                              set('venue_types', on
                                ? draft.venue_types.filter((x) => x !== t)
                                : [...draft.venue_types, t])
                            }
                            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${
                              on
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                          >
                            {VENUE_TYPE_LABELS[t]}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      Pick every one that applies — a resort with a banquet hall and a lawn is all three, and
                      each is a separate filter couples browse by.
                    </p>
                  </div>

                  <SelectField
                    label="Hotel star rating"
                    value={draft.hotel_star_rating === null ? null : (String(draft.hotel_star_rating) as any)}
                    onChange={(v) => set('hotel_star_rating', v === null ? null : Number(v))}
                    options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n) as any, label: `${n} star` }))}
                    placeholder="Not a rated property"
                    hint="The property's official classification — not a review score."
                    disabled={readOnly}
                  />
                </>
              )}

              <TextAreaField
                label="Description"
                value={draft.description}
                onChange={(v) => set('description', v)}
                rows={6}
                hint="A few sentences on the property, its history and what makes it worth choosing."
                disabled={readOnly}
              />
              <div className="grid md:grid-cols-2 gap-6">
                <TextField label="City" value={draft.city} onChange={(v) => set('city', v)} required
                  hint="Drives the city filter on the browse page — spell it the way couples search for it." disabled={readOnly} />
                <TextField label="Locality / area" value={draft.locality} onChange={(v) => set('locality', v)}
                  placeholder="Mandrem" hint="Shown on the card as “Locality, City”." disabled={readOnly} />
                <TextField label="State" value={draft.state} onChange={(v) => set('state', v)} disabled={readOnly} />
                <TextField label="Full address" value={draft.address} onChange={(v) => set('address', v)} disabled={readOnly} />
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <NumberField label="Map latitude" value={draft.map_lat} onChange={(v) => set('map_lat', v)}
                  placeholder="31.1048" disabled={readOnly}
                  hint="Right-click the property in Google Maps and copy the two numbers it shows." />
                <NumberField label="Map longitude" value={draft.map_lng} onChange={(v) => set('map_lng', v)}
                  placeholder="77.1734" disabled={readOnly} />
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <TextField label="Phone" value={draft.phone} onChange={(v) => set('phone', v)} disabled={readOnly}
                  hint="Internal only — the public page shows an enquiry form so leads stay ours." />
                <TextField label="Email" value={draft.email} onChange={(v) => set('email', v)} type="email" disabled={readOnly} />
                <TextField label="Website" value={draft.website} onChange={(v) => set('website', v)} disabled={readOnly} />
                <TextField label="Instagram" value={draft.instagram} onChange={(v) => set('instagram', v)} placeholder="@handle" disabled={readOnly} />
              </div>
            </SectionCard>
          )}

          {step === 'photos' && (
            <SectionCard
              title="Photos"
              description="The cover is the card image on the browse grid. Drag to reorder — that order is the gallery order."
            >
              <MediaManager
                listingId={draft.id}
                media={bundle.media}
                disabled={readOnly}
                onChange={(media: ListingMedia[]) => setBundle((b) => (b ? { ...b, media } : b))}
              />
            </SectionCard>
          )}

          {step === 'pricing' && (
            <SectionCard title="Capacity & pricing" description="These are the numbers couples filter on, so approximate is better than blank.">
              <div className="grid md:grid-cols-2 gap-6">
                <NumberField label="Minimum guests" value={draft.capacity_min} onChange={(v) => set('capacity_min', v)}
                  placeholder="100" disabled={readOnly} />
                <NumberField label="Maximum guests" value={draft.capacity_max} onChange={(v) => set('capacity_max', v)}
                  placeholder="600" disabled={readOnly} />
              </div>
              {draft.capacity_min !== null && draft.capacity_max !== null && draft.capacity_min > draft.capacity_max && (
                <p className="text-xs text-rose-600 -mt-2">
                  Minimum is higher than maximum — the database will reject this, and the listing would drop out of every guest filter.
                </p>
              )}

              <SelectField label="How they price" value={draft.price_unit} onChange={(v) => set('price_unit', v)}
                options={PRICE_UNITS} disabled={readOnly} />

              <div className="grid md:grid-cols-2 gap-6">
                <NumberField label="Per plate — veg" value={draft.per_plate_veg} onChange={(v) => set('per_plate_veg', v)}
                  prefix="₹" placeholder="1200" disabled={readOnly}
                  hint="Shown on the card as “Per plate ₹1200+”." />
                <NumberField label="Per plate — non-veg" value={draft.per_plate_nonveg} onChange={(v) => set('per_plate_nonveg', v)}
                  prefix="₹" placeholder="1500" disabled={readOnly} />
                <NumberField label="Starting price" value={draft.price_starting} onChange={(v) => set('price_starting', v)}
                  prefix="₹" disabled={readOnly}
                  hint="For vendors who don't price per plate — photographers, decor, planning." />
                <NumberField label="Total rooms" value={draft.rooms_count} onChange={(v) => set('rooms_count', v)} disabled={readOnly} />
              </div>
            </SectionCard>
          )}

          {step === 'spaces' && isVenue && (
            <div className="space-y-6">
              <SectionCard title="Halls & event spaces" description="Every bookable space, its floor area and how many people it seats.">
                <RepeatableSection<ListingSpace>
                  table="vendor_listing_spaces"
                  listingId={draft.id}
                  rows={bundle.spaces}
                  disabled={readOnly}
                  columns={SPACE_COLUMNS}
                  addLabel="Add a space"
                  emptyLabel="No halls added yet."
                  newRow={() => ({ name: 'New hall' })}
                  onChange={(spaces) => setBundle((b) => (b ? { ...b, spaces } : b))}
                />
              </SectionCard>

              <SectionCard title="Room types" description="Guest accommodation — what the rooms are called and how big they are.">
                <RepeatableSection<ListingRoom>
                  table="vendor_listing_rooms"
                  listingId={draft.id}
                  rows={bundle.rooms}
                  disabled={readOnly}
                  columns={ROOM_COLUMNS}
                  addLabel="Add a room type"
                  emptyLabel="No room types added yet."
                  newRow={() => ({ name: 'New room type' })}
                  onChange={(rooms) => setBundle((b) => (b ? { ...b, rooms } : b))}
                />
              </SectionCard>
            </div>
          )}

          {step === 'availability' && isVenue && (
            <SectionCard
              title="Availability calendar"
              description="Keeps working after this listing is submitted or published — a live venue's calendar changes every week, so it isn't frozen the way the rest of this editor is."
            >
              <AvailabilityEditor listingId={draft.id} />
            </SectionCard>
          )}

          {step === 'amenities' && (
            <SectionCard title={isVenue ? 'Amenities & the area' : 'Highlights'} description="Ticked off on the detail page.">
              <ChipsField
                label="Amenities"
                values={draft.amenities}
                onChange={(v) => set('amenities', v)}
                placeholder="Type an amenity and press Enter"
                suggestions={AMENITY_SUGGESTIONS}
                disabled={readOnly}
              />
              {isVenue && (
                <>
                  <ChipsField
                    label="Nearby & local entertainment"
                    values={draft.locality_highlights}
                    onChange={(v) => set('locality_highlights', v)}
                    placeholder="The Mall, Green Valley, Himalayan Nature Park…"
                    disabled={readOnly}
                  />
                  <div className="grid md:grid-cols-2 gap-6">
                    <NumberField label="Distance from airport" value={draft.distance_airport_km}
                      onChange={(v) => set('distance_airport_km', v)} suffix="km" disabled={readOnly} />
                    <NumberField label="Distance from railway station" value={draft.distance_railway_km}
                      onChange={(v) => set('distance_railway_km', v)} suffix="km" disabled={readOnly} />
                    <NumberField label="Parking capacity" value={draft.parking_capacity}
                      onChange={(v) => set('parking_capacity', v)} suffix="cars" disabled={readOnly} />
                  </div>
                  <div className="grid md:grid-cols-3 gap-6">
                    <TriStateField label="Alcohol allowed" value={draft.alcohol_allowed}
                      onChange={(v) => set('alcohol_allowed', v)} disabled={readOnly} />
                    <TriStateField label="Outside catering" value={draft.outside_catering_allowed}
                      onChange={(v) => set('outside_catering_allowed', v)} disabled={readOnly} />
                    <TriStateField label="Vegetarian only" value={draft.veg_only}
                      onChange={(v) => set('veg_only', v)} disabled={readOnly} />
                  </div>
                </>
              )}
            </SectionCard>
          )}

          {step === 'packages' && (
            <SectionCard title="Packages" description="Named price packages a planner can quote from directly.">
              <RepeatableSection<ListingPackage>
                table="vendor_listing_packages"
                listingId={draft.id}
                rows={bundle.packages}
                disabled={readOnly}
                columns={PACKAGE_COLUMNS}
                addLabel="Add a package"
                emptyLabel="No packages yet — optional, but planners quote faster when they exist."
                newRow={() => ({ name: 'New package' })}
                onChange={(packages) => setBundle((b) => (b ? { ...b, packages } : b))}
              />
            </SectionCard>
          )}

          {step === 'review' && (
            <SectionCard
              title="Ready to submit?"
              description="An admin reviews every listing before it reaches the public site."
            >
              <ul className="space-y-2.5">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-3 text-sm">
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        c.ok ? 'text-emerald-500' : c.optional ? 'text-slate-300' : 'text-rose-500'
                      }`}
                    >
                      {c.ok ? 'check_circle' : c.optional ? 'radio_button_unchecked' : 'cancel'}
                    </span>
                    <span className={c.ok ? 'text-slate-700' : 'text-slate-500'}>{c.label}</span>
                    {c.optional && !c.ok && <span className="text-[11px] text-slate-400">optional</span>}
                  </li>
                ))}
              </ul>

              {!readOnly && (
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-400">
                    {blocking.length > 0
                      ? `${blocking.length} required item${blocking.length > 1 ? 's' : ''} still missing.`
                      : 'Everything required is filled in.'}
                  </p>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={saving || blocking.length > 0}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {saving ? 'Submitting…' : 'Submit for approval'}
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
              )}
            </SectionCard>
          )}
        </div>

        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete “${draft.name || 'this listing'}”?`}
            confirmLabel="Delete listing"
            confirmPhrase={draft.name || undefined}
            busy={deleting}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={remove}
            extra={
              draft.application_id ? (
                <label className="flex items-start gap-3 bg-slate-50 rounded-xl p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoRemoveApp}
                    onChange={(e) => setAlsoRemoveApp(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-rose-500"
                  />
                  <span className="text-xs text-slate-600 leading-relaxed">
                    <strong className="font-semibold text-slate-700">Withdraw the vendor lead as well.</strong>{' '}
                    Leave this unticked and the vendor returns to Vendor Listings as a “Build profile” card.
                  </span>
                </label>
              ) : null
            }
            body={
              <>
                This removes the listing, its {bundle.spaces.length} hall(s), {bundle.rooms.length} room
                type(s) and {bundle.packages.length} package(s), and permanently deletes{' '}
                {bundle.media.length} photo(s) from Cloudinary. There is no undo.
              </>
            }
          />
        )}
      </Main>
    </Page>
  );
};

const SPACE_COLUMNS: ColumnDef<ListingSpace>[] = [
  { key: 'name', label: 'Space', kind: 'text', width: '40%', placeholder: 'Lawrence Hall' },
  { key: 'space_type', label: 'Type', kind: 'select', width: '25%', options: SPACE_TYPES },
  { key: 'area_sqft', label: 'Area (sq ft)', kind: 'number', width: '17%', placeholder: '2799' },
  { key: 'capacity_pax', label: 'Pax', kind: 'number', width: '18%', placeholder: '112' },
];

const ROOM_COLUMNS: ColumnDef<ListingRoom>[] = [
  { key: 'name', label: 'Room type', kind: 'text', width: '55%', placeholder: 'Deluxe Garden View' },
  { key: 'area_sqft', label: 'Area (sq ft)', kind: 'number', width: '22%', placeholder: '463' },
  { key: 'room_count', label: 'How many', kind: 'number', width: '23%', placeholder: '20' },
];

const PACKAGE_COLUMNS: ColumnDef<ListingPackage>[] = [
  { key: 'name', label: 'Package', kind: 'text', width: '30%', placeholder: 'Silver' },
  { key: 'description', label: 'What it covers', kind: 'text', width: '40%' },
  { key: 'price', label: 'Price (₹)', kind: 'number', width: '15%' },
  {
    key: 'unit', label: 'Per', kind: 'select', width: '15%',
    options: [...PRICE_UNITS, { value: 'per_person' as any, label: 'Per person' }],
  },
];

// The guard trigger in 0015 silently preserves these for non-admins, so
// sending them back would be harmless — but sending a stale `badges` array
// or `updated_at` in every PATCH is noise in the wire log and, for
// generated columns, an outright error.
// An ALLOWLIST, not a denylist. The first version of this listed the columns
// to exclude and shipped a bug: `fetchListingBundle` does `select('*')`, which
// returns the generated `search_vector` column, so it rode along in every
// PATCH and Postgres rejected the whole update with
// `column "search_vector" can only be updated to DEFAULT`.
//
// A denylist has to be updated every time a column is added; forgetting once
// breaks saving entirely. An allowlist fails the safe way — a new column is
// simply not sent until someone deliberately adds it here.
const EDITABLE_COLUMNS = [
  'name', 'tagline', 'description',
  'city', 'locality', 'state', 'address', 'map_lat', 'map_lng',
  'phone', 'email', 'website', 'instagram',
  'price_unit', 'per_plate_veg', 'per_plate_nonveg', 'price_starting',
  'capacity_min', 'capacity_max', 'rooms_count',
  'amenities', 'locality_highlights',
  'distance_airport_km', 'distance_railway_km', 'parking_capacity',
  'alcohol_allowed', 'outside_catering_allowed', 'veg_only',
  'venue_types', 'hotel_star_rating',
  'details',
  // Deliberately absent: `category` (fixed at creation), everything the
  // status workflow owns, and every admin-only merchandising column.
] as const satisfies readonly (keyof VendorListing)[];

function editableFields(listing: VendorListing): Partial<VendorListing> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_COLUMNS) {
    out[key] = listing[key];
  }
  return out as Partial<VendorListing>;
}

function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  if (e?.code === '42501') return 'You can only edit your own listings, and only while they are a draft.';
  if (e?.code === '23514') return 'One of the values was rejected — check the guest capacity range and prices.';
  if (e?.message) return e.message;
  return 'Something went wrong. Try again.';
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_review: 'bg-sky-100 text-sky-700',
  published: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-amber-100 text-amber-800',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Live',
  rejected: 'Sent back',
};

export const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`text-[11px] font-bold px-3 py-1.5 rounded-lg tracking-wide ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-600'}`}>
    {STATUS_LABELS[status] || status}
  </span>
);
