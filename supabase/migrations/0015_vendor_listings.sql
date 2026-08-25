-- ============================================================================
-- 0015_vendor_listings.sql
--
-- The vendor listing system: rich, salesman-authored, admin-approved vendor
-- profiles that feed both the ops portal and the public browse/detail pages.
-- Run AFTER 0014. Idempotent, same conventions as prior migrations.
--
-- WHY A NEW TABLE INSTEAD OF EXTENDING `venues` / `vendors`:
--
--   The public browse page filters on guest count, per-plate price, city and
--   badge, and sorts tens of thousands of rows. `venues` cannot serve that:
--   `capacity` and `rental_fee` are BOTH `text` (0009:99-100), so "500-1000
--   guests" or "under Rs 800 a plate" are not expressible as indexed
--   predicates -- they'd need a full scan plus a regex per row. `venues`
--   also has no rating, no badges, and exactly one `image_url` where the
--   card design needs a carousel.
--
--   So `vendor_listings` is canonical and publicly readable (when published),
--   and `venues`/`vendors` keep a MIRROR ROW SHARING THE SAME id. That id
--   sharing is the whole trick: `client_venue_shortlists.venue_id` and
--   `enquiry_vendor_pushes` keep their FKs, the manager push UI keeps
--   working unchanged, and nothing has to be backfilled or dual-written
--   for filtering -- the filter columns live in exactly one place.
--
-- WHAT SALES CANNOT WRITE, DELIBERATELY:
--
--   `badges`, `rating`, `reviews_count` and `is_partner` are admin-only,
--   enforced by trigger (section 5) rather than merely left off a form. A
--   sales agent marking their own vendor "Bestseller", or typing in a 4.8
--   rating and a 6,000 review count that no real couple ever left, is
--   fabricated social proof shown to people choosing where to spend several
--   lakh rupees. That is consumer deception regardless of intent, and the
--   CCPA dark-pattern rules treat invented reviews as exactly that.
--   `rating`/`reviews_count` stay null until real reviews exist; badges are
--   an editorial/commercial decision an admin makes.
--
-- WORKFLOW: draft -> pending_review -> published, with rejected looping back
--   to the author with a reason. Transitions go through SECURITY DEFINER
--   RPCs so the validation ("a published listing must have a cover image
--   and a city") lives in one place instead of in whichever form last
--   touched the row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. vendor_applications: the missing INSERT grant.
--
--    THIS IS THE "Add Vendor button does nothing" BUG. 0012 added a SELECT
--    policy for sales and nothing else, and the live table's existing insert
--    policy was written for the PUBLIC self-submission form -- i.e. for the
--    `anon` role. A signed-in salesman is `authenticated`, so no policy
--    matched their INSERT, Postgres raised 42501, and SalesmanOnboard's
--    error mapper faithfully reported "your account does not have
--    permission". The form was right; the grant never existed.
-- ----------------------------------------------------------------------------
drop policy if exists "sales submits applications" on vendor_applications;
create policy "sales submits applications" on vendor_applications
  for insert to authenticated
  with check (my_staff_role() = 'sales' and submitted_by = my_staff_id());

drop policy if exists "admin manages applications" on vendor_applications;
create policy "admin manages applications" on vendor_applications
  for all to authenticated using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 1. CORE TABLE
-- ----------------------------------------------------------------------------
create table if not exists vendor_listings (
  id uuid primary key default gen_random_uuid(),

  -- Provenance. A listing usually starts life as an approved application,
  -- but an admin can also create one cold, so this is nullable.
  application_id uuid references vendor_applications (id) on delete set null,
  created_by uuid references admin_users (id),
  -- Who manages this profile day to day. Today always a sales agent; when
  -- vendors self-serve later, a vendor account becomes a second possible
  -- owner and the state machine below does not change.
  owner_salesman_id uuid references admin_users (id),

  -- Canonical category slugs. The portal's VendorApplicationRole labels
  -- ('Venue', 'Lens', 'Henna', 'Face', ...) map onto these; storing the
  -- slug rather than the label means renaming a label in the UI later
  -- doesn't invalidate a check constraint across every row.
  category text not null check (category in (
    'venue', 'decor', 'sound', 'photography', 'mehendi',
    'makeup', 'film', 'planning', 'catering'
  )),

  -- WORKFLOW
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'published', 'rejected')),
  submitted_at timestamptz,
  reviewed_by uuid references admin_users (id),
  reviewed_at timestamptz,
  rejection_reason text,
  published_at timestamptz,

  -- PUBLIC IDENTITY
  name text not null,
  slug text unique,
  tagline text,
  description text,

  -- LOCATION. `locality` is the neighbourhood shown on the card
  -- ("Mandrem, Goa" = locality, city); `city` is what the city filter and
  -- the locations table match on.
  city text,
  locality text,
  state text,
  address text,
  map_lat numeric(9,6),
  map_lng numeric(9,6),

  -- CONTACT (portal-visible; the public page shows an enquiry form, not
  -- these, so that leads stay attributable to us).
  phone text,
  email text,
  website text,
  instagram text,

  -- CARD ECONOMICS -- every one of these is a filter or sort key, which is
  -- why they are typed numerics and not the free text `venues` uses.
  price_unit text check (price_unit in ('per_plate', 'per_event', 'per_day', 'per_hour')),
  per_plate_veg numeric(10,2),
  per_plate_nonveg numeric(10,2),
  price_starting numeric(12,2),
  capacity_min integer check (capacity_min >= 0),
  capacity_max integer check (capacity_max >= 0),
  rooms_count integer,

  -- SOCIAL PROOF -- admin/system-only (see section 5). Null means "no
  -- reviews yet", which the card must render as no stars at all rather
  -- than as a zero.
  rating numeric(2,1) check (rating >= 0 and rating <= 5),
  reviews_count integer not null default 0 check (reviews_count >= 0),

  -- MERCHANDISING -- admin-only. `badges` is an array rather than one
  -- `tier` column because the card stacks them: a venue can be Premium AND
  -- a Bestseller AND our choice simultaneously.
  badges text[] not null default '{}'::text[],
  is_partner boolean not null default false,
  offer_text text,
  sort_weight integer not null default 0,

  -- VENUE SPECIFICS (null for other categories)
  amenities text[] not null default '{}'::text[],
  locality_highlights text[] not null default '{}'::text[],
  distance_airport_km numeric(6,1),
  distance_railway_km numeric(6,1),
  parking_capacity integer,
  alcohol_allowed boolean,
  outside_catering_allowed boolean,
  veg_only boolean,

  -- Category-specific overflow that doesn't deserve a column yet
  -- (photographer turnaround time, DJ equipment list, ...).
  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A range that reads backwards ("600 - 100") would silently drop the
  -- listing out of every guest-count filter, so reject it at write time.
  constraint vendor_listings_capacity_order
    check (capacity_min is null or capacity_max is null or capacity_min <= capacity_max)
);

-- Badge vocabulary is ours, not a competitor's. Enforced as a constraint so
-- a typo ("bestsellers") can't quietly create a badge no filter matches.
alter table vendor_listings drop constraint if exists vendor_listings_badges_valid;
alter table vendor_listings add constraint vendor_listings_badges_valid
  check (badges <@ array['choice', 'bestseller', 'premium', 'budget', 'new']::text[]);

-- Free-text search behind the "Search vendor..." box. 'simple' rather than
-- 'english' on purpose: English stemming mangles Indian proper nouns, and
-- property and place names are the entire point of this index.
alter table vendor_listings
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(name, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(locality, '') || ' ' ||
      coalesce(tagline, '')
    )
  ) stored;

-- ----------------------------------------------------------------------------
-- 2. CHILD TABLES
-- ----------------------------------------------------------------------------

-- Media. We store the Cloudinary public_id + version, NOT a finished URL:
-- the card wants a ~400px auto-format thumbnail and the gallery wants the
-- full-size image, and both derive from the same public_id at render time.
-- Baking one URL into the row would mean either shipping 3MB originals into
-- a grid of 30 cards, or losing the ability to change the transform later
-- without rewriting every row. `secure_url` is kept alongside as a plain
-- fallback and as the value mirrored into the legacy `image_url` column.
create table if not exists vendor_listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references vendor_listings (id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'video')),
  role text not null default 'gallery'
    check (role in ('cover', 'gallery', 'logo', 'menu', 'floorplan')),
  cloudinary_public_id text not null,
  cloudinary_version bigint,
  secure_url text,
  format text,
  width integer,
  height integer,
  bytes integer,
  alt text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Banquet halls / lawns -- the "Venues" table on a venue detail page
-- (name, area, pax).
create table if not exists vendor_listing_spaces (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references vendor_listings (id) on delete cascade,
  name text not null,
  space_type text check (space_type in ('indoor', 'outdoor', 'lawn', 'poolside', 'banquet', 'terrace')),
  area_sqft integer,
  capacity_pax integer,
  position integer not null default 0
);

-- "Room Descriptions" (room type, area, how many of them).
create table if not exists vendor_listing_rooms (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references vendor_listings (id) on delete cascade,
  name text not null,
  area_sqft integer,
  room_count integer,
  position integer not null default 0
);

-- Priced packages ("Silver / Gold / Platinum", per-plate menus, shoot-day
-- rates) -- shown on the detail page and used as the enquiry starting point.
create table if not exists vendor_listing_packages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references vendor_listings (id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2),
  unit text check (unit in ('per_plate', 'per_event', 'per_day', 'per_hour', 'per_person')),
  inclusions text[] not null default '{}'::text[],
  is_active boolean not null default true,
  position integer not null default 0
);

-- ----------------------------------------------------------------------------
-- 3. INDEXES
--
--    The browse indexes are partial on `status = 'published'`: the public
--    grid never looks at anything else, and excluding drafts keeps the
--    index pages dense.
-- ----------------------------------------------------------------------------
create index if not exists vendor_listings_public_browse_idx
  on vendor_listings (category, city, sort_weight desc, rating desc nulls last, id)
  where status = 'published';

create index if not exists vendor_listings_capacity_idx
  on vendor_listings (capacity_min, capacity_max) where status = 'published';

create index if not exists vendor_listings_price_idx
  on vendor_listings (per_plate_veg) where status = 'published';

create index if not exists vendor_listings_badges_idx
  on vendor_listings using gin (badges) where status = 'published';

create index if not exists vendor_listings_search_idx
  on vendor_listings using gin (search_vector) where status = 'published';

-- Portal-side: the salesman's own list, and the admin review queue.
create index if not exists vendor_listings_owner_idx
  on vendor_listings (owner_salesman_id, status);
create index if not exists vendor_listings_status_idx
  on vendor_listings (status, submitted_at desc);

create index if not exists vendor_listing_media_idx
  on vendor_listing_media (listing_id, role, position);
create index if not exists vendor_listing_spaces_idx
  on vendor_listing_spaces (listing_id, position);
create index if not exists vendor_listing_rooms_idx
  on vendor_listing_rooms (listing_id, position);
create index if not exists vendor_listing_packages_idx
  on vendor_listing_packages (listing_id, position);

-- ----------------------------------------------------------------------------
-- 4. HOUSEKEEPING TRIGGERS (updated_at, slug)
-- ----------------------------------------------------------------------------
create or replace function vendor_listings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vendor_listings_updated_at on vendor_listings;
create trigger vendor_listings_updated_at
  before update on vendor_listings
  for each row execute function vendor_listings_touch();

-- Slugs are generated from name + city and are permanent once published:
-- a published slug is a URL a couple may have bookmarked or a partner may
-- have linked, so renaming the business later must not 404 it.
create or replace function vendor_listing_slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')
  );
$$;

create or replace function vendor_listing_build_slug(p_name text, p_city text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 0;
begin
  v_base := vendor_listing_slugify(p_name);
  if coalesce(p_city, '') <> '' then
    v_base := v_base || '-' || vendor_listing_slugify(p_city);
  end if;
  if v_base = '' then
    v_base := 'listing';
  end if;

  v_slug := v_base;
  -- Two "Taj Palace, Delhi" listings are entirely plausible, so suffix
  -- rather than fail the publish.
  while exists (select 1 from vendor_listings where slug = v_slug and id <> p_id) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;
  return v_slug;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. PRIVILEGE GUARD
--
--    RLS decides WHICH ROWS a person may touch; this decides WHICH COLUMNS.
--    Without it, a sales agent who legitimately owns a draft could PATCH
--    `badges`, `rating`, `reviews_count`, `is_partner` or `sort_weight`
--    straight through PostgREST -- the merchandising and social-proof
--    fields the whole listing page's credibility rests on. Column-level
--    GRANTs can't express "only on rows you own", so this is a trigger.
--
--    It also pins the workflow: only the review RPC (which runs as definer
--    and sets the flag below) may move a row into `published` or
--    `rejected`, so nobody publishes themselves by PATCHing a status
--    string.
-- ----------------------------------------------------------------------------
create or replace function vendor_listings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := is_admin();
  v_privileged boolean := coalesce(current_setting('app.listing_privileged', true), 'off') = 'on';
begin
  if v_admin or v_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A non-admin may only ever create a plain draft.
    new.status := 'draft';
    new.badges := '{}'::text[];
    new.is_partner := false;
    new.rating := null;
    new.reviews_count := 0;
    new.sort_weight := 0;
    new.published_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  -- UPDATE: silently preserve the protected columns rather than raising,
  -- so a form that PATCHes the whole row (the normal PostgREST pattern)
  -- still succeeds for the fields the author IS allowed to change.
  new.badges := old.badges;
  new.is_partner := old.is_partner;
  new.rating := old.rating;
  new.reviews_count := old.reviews_count;
  new.sort_weight := old.sort_weight;
  new.published_at := old.published_at;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.slug := old.slug;

  if new.status is distinct from old.status then
    raise exception 'Listing status changes go through submit_vendor_listing / review_vendor_listing'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists vendor_listings_guard_trg on vendor_listings;
create trigger vendor_listings_guard_trg
  before insert or update on vendor_listings
  for each row execute function vendor_listings_guard();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table vendor_listings enable row level security;
alter table vendor_listing_media enable row level security;
alter table vendor_listing_spaces enable row level security;
alter table vendor_listing_rooms enable row level security;
alter table vendor_listing_packages enable row level security;

-- PUBLIC: published rows only, to logged-out visitors and clients alike.
drop policy if exists "public reads published listings" on vendor_listings;
create policy "public reads published listings" on vendor_listings
  for select to anon, authenticated
  using (status = 'published');

-- STAFF: any staff member can read every listing (planners need to see
-- drafts to know what's coming; admins need the review queue).
drop policy if exists "staff reads all listings" on vendor_listings;
create policy "staff reads all listings" on vendor_listings
  for select to authenticated using (is_staff());

drop policy if exists "admin manages listings" on vendor_listings;
create policy "admin manages listings" on vendor_listings
  for all to authenticated using (is_admin()) with check (is_admin());

-- SALES: create listings they own, and edit them only while the row is
-- theirs to edit. A row sitting in `pending_review` is deliberately frozen
-- -- otherwise an agent could edit it after an admin started reviewing it,
-- and the admin would approve something they never read.
drop policy if exists "sales creates own listings" on vendor_listings;
create policy "sales creates own listings" on vendor_listings
  for insert to authenticated
  with check (my_staff_role() = 'sales' and owner_salesman_id = my_staff_id());

drop policy if exists "sales edits own draft listings" on vendor_listings;
create policy "sales edits own draft listings" on vendor_listings
  for update to authenticated
  using (
    my_staff_role() = 'sales'
    and owner_salesman_id = my_staff_id()
    and status in ('draft', 'rejected')
  )
  with check (
    my_staff_role() = 'sales'
    and owner_salesman_id = my_staff_id()
  );

drop policy if exists "sales deletes own draft listings" on vendor_listings;
create policy "sales deletes own draft listings" on vendor_listings
  for delete to authenticated
  using (
    my_staff_role() = 'sales'
    and owner_salesman_id = my_staff_id()
    and status in ('draft', 'rejected')
  );

-- Child tables inherit their parent's access rules. Written once as a DO
-- block because all four are identical and copy-pasting four near-identical
-- policy sets is how one of them silently drifts.
do $$
declare
  t text;
begin
  foreach t in array array[
    'vendor_listing_media',
    'vendor_listing_spaces',
    'vendor_listing_rooms',
    'vendor_listing_packages'
  ] loop
    execute format('drop policy if exists "public reads published children" on %I', t);
    execute format($f$
      create policy "public reads published children" on %I
        for select to anon, authenticated
        using (exists (
          select 1 from vendor_listings l
          where l.id = %I.listing_id and l.status = 'published'
        ))
    $f$, t, t);

    execute format('drop policy if exists "staff reads children" on %I', t);
    execute format($f$
      create policy "staff reads children" on %I
        for select to authenticated using (is_staff())
    $f$, t);

    execute format('drop policy if exists "admin manages children" on %I', t);
    execute format($f$
      create policy "admin manages children" on %I
        for all to authenticated using (is_admin()) with check (is_admin())
    $f$, t);

    execute format('drop policy if exists "sales manages own draft children" on %I', t);
    execute format($f$
      create policy "sales manages own draft children" on %I
        for all to authenticated
        using (exists (
          select 1 from vendor_listings l
          where l.id = %I.listing_id
            and l.owner_salesman_id = my_staff_id()
            and my_staff_role() = 'sales'
            and l.status in ('draft', 'rejected')
        ))
        with check (exists (
          select 1 from vendor_listings l
          where l.id = %I.listing_id
            and l.owner_salesman_id = my_staff_id()
            and my_staff_role() = 'sales'
            and l.status in ('draft', 'rejected')
        ))
    $f$, t, t, t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. WORKFLOW RPCs
-- ----------------------------------------------------------------------------

-- Create a draft, optionally seeded from an approved application so the
-- agent doesn't retype the name/city/contact they already captured.
create or replace function create_vendor_listing(
  p_category text,
  p_name text,
  p_application_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid := my_staff_id();
  v_role text := my_staff_role();
  v_id uuid;
  -- Scalars, not a `record`: an unassigned record raises "record is not
  -- assigned yet" the moment you read a field off it, so the common case
  -- (creating a listing with no application behind it) would throw.
  v_app_name text;
  v_app_city text;
  v_app_email text;
  v_app_owner uuid;
begin
  if v_staff is null or v_role not in ('sales', 'admin') then
    raise exception 'Only sales agents and admins can create listings'
      using errcode = '42501';
  end if;

  if p_application_id is not null then
    select applicant_name, city, email, submitted_by
      into v_app_name, v_app_city, v_app_email, v_app_owner
    from vendor_applications where id = p_application_id;
  end if;

  insert into vendor_listings (
    application_id, created_by, owner_salesman_id,
    category, name, city, email, status
  ) values (
    p_application_id,
    v_staff,
    -- An admin creating a listing off someone else's application leaves it
    -- owned by the agent who sourced it, so it stays on their pipeline.
    coalesce(v_app_owner, v_staff),
    p_category,
    coalesce(nullif(p_name, ''), v_app_name, 'Untitled listing'),
    v_app_city,
    v_app_email,
    'draft'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Hand a finished draft to the admin queue. The completeness check lives
-- here rather than in the form so that a listing can never reach an admin
-- (or, worse, the public site) without the fields the card needs to render
-- -- a card with no cover image or no city is a broken tile in the grid.
create or replace function submit_vendor_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing vendor_listings;
  v_staff uuid := my_staff_id();
begin
  select * into v_listing from vendor_listings where id = p_listing_id;
  if not found then
    raise exception 'Listing not found';
  end if;

  if not is_admin() and v_listing.owner_salesman_id is distinct from v_staff then
    raise exception 'This listing belongs to someone else' using errcode = '42501';
  end if;

  if v_listing.status not in ('draft', 'rejected') then
    raise exception 'Only a draft or rejected listing can be submitted (this one is %)',
      v_listing.status;
  end if;

  if coalesce(trim(v_listing.name), '') = '' then
    raise exception 'Add the vendor name before submitting';
  end if;
  if coalesce(trim(v_listing.city), '') = '' then
    raise exception 'Add the city before submitting -- the browse page filters on it';
  end if;
  if not exists (
    select 1 from vendor_listing_media
    where listing_id = p_listing_id and role in ('cover', 'gallery')
  ) then
    raise exception 'Add at least one photo before submitting';
  end if;

  perform set_config('app.listing_privileged', 'on', true);
  update vendor_listings
    set status = 'pending_review',
        submitted_at = now(),
        rejection_reason = null
  where id = p_listing_id;
  perform set_config('app.listing_privileged', 'off', true);
end;
$$;

-- Admin approve/reject. Approving publishes AND writes the mirror row.
create or replace function review_vendor_listing(
  p_listing_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing vendor_listings;
begin
  if not is_admin() then
    raise exception 'Only an admin can review listings' using errcode = '42501';
  end if;

  select * into v_listing from vendor_listings where id = p_listing_id;
  if not found then
    raise exception 'Listing not found';
  end if;

  perform set_config('app.listing_privileged', 'on', true);

  if p_approve then
    update vendor_listings
      set status = 'published',
          published_at = coalesce(published_at, now()),
          reviewed_by = my_staff_id(),
          reviewed_at = now(),
          rejection_reason = null,
          -- Generated once, then permanent: a published slug is a URL
          -- someone may already have linked to.
          slug = coalesce(slug, vendor_listing_build_slug(name, city, id))
    where id = p_listing_id;

    perform sync_vendor_listing_mirror(p_listing_id);
  else
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'Give a reason -- the agent has to know what to fix';
    end if;
    update vendor_listings
      set status = 'rejected',
          reviewed_by = my_staff_id(),
          reviewed_at = now(),
          rejection_reason = p_reason
    where id = p_listing_id;

    -- Pull it off the public site if it had been live before.
    update venues set is_active = false where id = p_listing_id;
    update vendors set is_active = false where id = p_listing_id;
  end if;

  perform set_config('app.listing_privileged', 'off', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. THE MIRROR
--
--    Writes a matching row into legacy `venues` / `vendors` USING THE SAME
--    id, so `client_venue_shortlists.venue_id` and `enquiry_vendor_pushes`
--    resolve and the existing manager push UI needs no changes at all. The
--    mirror is display-only: nothing filters on it, so its text `capacity`
--    and `rental_fee` columns are fine to fill with human-readable strings.
-- ----------------------------------------------------------------------------
create or replace function sync_vendor_listing_mirror(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l vendor_listings;
  v_cover text;
  v_capacity text;
  v_price text;
begin
  select * into l from vendor_listings where id = p_listing_id;
  if not found then
    return;
  end if;

  select coalesce(secure_url, '') into v_cover
  from vendor_listing_media
  where listing_id = p_listing_id and kind = 'image'
  order by (role = 'cover') desc, position asc
  limit 1;

  v_capacity := case
    when l.capacity_min is not null and l.capacity_max is not null
      then l.capacity_min::text || ' - ' || l.capacity_max::text
    when l.capacity_max is not null then 'up to ' || l.capacity_max::text
    else null
  end;

  v_price := case
    when l.per_plate_veg is not null
      then 'Rs ' || trim(to_char(l.per_plate_veg, 'FM999999999')) || '+ per plate'
    when l.price_starting is not null
      then 'Rs ' || trim(to_char(l.price_starting, 'FM999999999')) || '+'
    else null
  end;

  if l.category = 'venue' then
    insert into venues (id, name, location, description, capacity, rental_fee, image_url, is_active)
    values (
      l.id, l.name,
      nullif(concat_ws(', ', l.locality, l.city), ''),
      l.description, v_capacity, v_price, nullif(v_cover, ''),
      l.status = 'published'
    )
    on conflict (id) do update set
      name = excluded.name,
      location = excluded.location,
      description = excluded.description,
      capacity = excluded.capacity,
      rental_fee = excluded.rental_fee,
      image_url = excluded.image_url,
      is_active = excluded.is_active;
  else
    insert into vendors (id, category, name, title, bio, location, rating, reviews_count, image_url, is_active)
    values (
      l.id, l.category, l.name, l.tagline, l.description,
      nullif(concat_ws(', ', l.locality, l.city), ''),
      coalesce(l.rating, 0), l.reviews_count, nullif(v_cover, ''),
      l.status = 'published'
    )
    on conflict (id) do update set
      category = excluded.category,
      name = excluded.name,
      title = excluded.title,
      bio = excluded.bio,
      location = excluded.location,
      rating = excluded.rating,
      reviews_count = excluded.reviews_count,
      image_url = excluded.image_url,
      is_active = excluded.is_active;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. ADMIN-ONLY MERCHANDISING
--
--    Separate RPC because the guard in section 5 blocks these columns for
--    everyone else, and an admin setting a badge is an auditable editorial
--    act, not a form field on the agent's editor.
-- ----------------------------------------------------------------------------
create or replace function set_vendor_listing_merchandising(
  p_listing_id uuid,
  p_badges text[] default null,
  p_is_partner boolean default null,
  p_offer_text text default null,
  p_sort_weight integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only an admin can set badges' using errcode = '42501';
  end if;

  perform set_config('app.listing_privileged', 'on', true);
  update vendor_listings set
    badges = coalesce(p_badges, badges),
    is_partner = coalesce(p_is_partner, is_partner),
    offer_text = coalesce(p_offer_text, offer_text),
    sort_weight = coalesce(p_sort_weight, sort_weight)
  where id = p_listing_id;
  perform set_config('app.listing_privileged', 'off', true);

  perform sync_vendor_listing_mirror(p_listing_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. GRANTS
--
--     Explicit and narrow. `create_vendor_listing` and friends check the
--     caller's role internally, but there is no reason for `anon` to be
--     able to call them at all.
-- ----------------------------------------------------------------------------
revoke all on function create_vendor_listing(text, text, uuid) from public, anon;
revoke all on function submit_vendor_listing(uuid) from public, anon;
revoke all on function review_vendor_listing(uuid, boolean, text) from public, anon;
revoke all on function set_vendor_listing_merchandising(uuid, text[], boolean, text, integer) from public, anon;
revoke all on function sync_vendor_listing_mirror(uuid) from public, anon, authenticated;

grant execute on function create_vendor_listing(text, text, uuid) to authenticated;
grant execute on function submit_vendor_listing(uuid) to authenticated;
grant execute on function review_vendor_listing(uuid, boolean, text) to authenticated;
grant execute on function set_vendor_listing_merchandising(uuid, text[], boolean, text, integer) to authenticated;

-- The public browse page reads the tables directly (RLS-filtered) so that
-- PostgREST's range/count pagination and ordering work without a bespoke
-- RPC per filter combination.
grant select on vendor_listings, vendor_listing_media, vendor_listing_spaces,
  vendor_listing_rooms, vendor_listing_packages to anon, authenticated;
grant insert, update, delete on vendor_listings, vendor_listing_media,
  vendor_listing_spaces, vendor_listing_rooms, vendor_listing_packages to authenticated;

-- Realtime: the admin review queue should light up the moment an agent
-- submits, without polling.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'vendor_listings'
  ) then
    alter publication supabase_realtime add table vendor_listings;
  end if;
end;
$$;
