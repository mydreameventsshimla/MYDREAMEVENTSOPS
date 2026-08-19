-- ============================================================================
-- 0013_locations_and_guests.sql
--
-- Two independent additions, both purely new tables (nothing existing is
-- touched or renamed):
--
--   1. LOCATIONS — the client intake wizard's destination step currently
--      has 7 cities hardcoded in InquiryModal.tsx. This table lets admin
--      manage that list from the ops-portal (Admin -> Locations) with no
--      code deploy needed to add/retire a destination.
--
--   2. GUESTS — the RSVP/guest-list feature. A couple (an anonymous
--      "client" in this app's existing bearer-token model) adds guests to
--      their own enquiry; each guest gets a unique invite_token and can
--      view/fill their own RSVP with no login, at /guest/:token on the
--      client site. Staff (planners/admins) see the same list with real
--      RLS through the ops-portal, same two-tier trust model the rest of
--      this schema already uses (anon = RPC-gated bearer token, staff =
--      real auth.uid()-scoped RLS).
--
--      Deliberately NOT given a blanket anon "using (true)" policy the way
--      enquiry_vendor_pushes has (see 0012) — guest rows carry real PII
--      (name/phone/city) for third parties, not just the couple, so anon
--      gets zero direct table grants; every anonymous read/write goes
--      through a SECURITY DEFINER RPC scoped to one enquiry_id or one
--      invite_token at a time. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LOCATIONS
-- ----------------------------------------------------------------------------
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text,
  image_url text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table locations enable row level security;

drop policy if exists "public reads active locations" on locations;
create policy "public reads active locations" on locations
  for select to anon, authenticated using (is_active);

drop policy if exists "admin manages locations" on locations;
create policy "admin manages locations" on locations
  for all to authenticated using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 2. GUESTS
-- ----------------------------------------------------------------------------
create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  full_name text not null,
  relation text,
  side text check (side in ('bride', 'groom', 'both')),
  coming_from text,
  phone text,
  email text,
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending', 'attending', 'not_attending', 'maybe')),
  plus_ones integer not null default 0,
  dietary_notes text,
  invite_token uuid not null default gen_random_uuid() unique,
  -- 'manual' | 'link' | 'email' | 'whatsapp' today; kept generic so a real
  -- WhatsApp Business API integration later just adds a new value here and
  -- a delivery-status pair below, no schema change needed.
  invited_via text not null default 'manual' check (invited_via in ('manual', 'link', 'email', 'whatsapp')),
  invite_delivery_status text check (invite_delivery_status in ('queued', 'sent', 'failed')),
  invited_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_guests_enquiry_id on guests (enquiry_id);

alter table guests enable row level security;

-- Staff access (real RLS, same helpers as 0012) — anon gets nothing here;
-- see the RPCs below for the bearer-token path.
drop policy if exists "admin full access guests" on guests;
create policy "admin full access guests" on guests for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "planner manages guests on own enquiries" on guests;
create policy "planner manages guests on own enquiries" on guests
  for all to authenticated
  using (my_staff_role() = 'planner' and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id()))
  with check (my_staff_role() = 'planner' and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id()));

-- ---- Anonymous access, all RPC-gated (SECURITY DEFINER bypasses RLS) ----

-- Couple adds a guest to their own event. Trust model: knowing the
-- enquiry_id is the credential, same as every other anon write in this
-- schema (e.g. enquiry insert itself). Returns the full row so the UI can
-- immediately show/copy the invite_token-based link.
create or replace function add_guest(
  p_enquiry_id uuid,
  p_full_name text,
  p_relation text default null,
  p_side text default null,
  p_coming_from text default null,
  p_phone text default null,
  p_email text default null,
  p_invited_via text default 'manual'
)
returns guests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row guests;
begin
  insert into guests (enquiry_id, full_name, relation, side, coming_from, phone, email, invited_via, invited_at)
    values (p_enquiry_id, p_full_name, p_relation, p_side, p_coming_from, p_phone, p_email, p_invited_via,
            case when p_invited_via <> 'manual' then now() else null end)
    returning * into v_row;
  return v_row;
end;
$$;

-- Couple's "Guests" tab list — scoped to one enquiry_id at a time.
create or replace function list_guests_for_enquiry(p_enquiry_id uuid)
returns setof guests
language sql
stable
security definer
set search_path = public
as $$
  select * from guests where enquiry_id = p_enquiry_id order by created_at asc;
$$;

create or replace function remove_guest(p_guest_id uuid, p_enquiry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from guests where id = p_guest_id and enquiry_id = p_enquiry_id;
end;
$$;

-- Mark how/whether an invite went out (called after a client-side "Send via
-- WhatsApp" wa.me click, or after the email API route succeeds/fails).
create or replace function mark_guest_invited(p_guest_id uuid, p_enquiry_id uuid, p_invited_via text, p_delivery_status text default 'sent')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update guests
    set invited_via = p_invited_via, invite_delivery_status = p_delivery_status, invited_at = now()
    where id = p_guest_id and enquiry_id = p_enquiry_id;
end;
$$;

-- Guest's own dashboard load — single row by token only, so a guest can
-- never enumerate anyone else's RSVP.
create or replace function fetch_guest_by_token(p_token uuid)
returns guests
language sql
stable
security definer
set search_path = public
as $$
  select * from guests where invite_token = p_token;
$$;

-- The event-facing details a guest dashboard needs, resolved via the
-- guest's own token so anon never needs direct access to `enquiries`.
create or replace function fetch_event_summary_for_guest(p_token uuid)
returns table (destination text, event_date_text text, guest_bracket text, vision_style text)
language sql
stable
security definer
set search_path = public
as $$
  select e.destination, e.event_date_text, e.guest_bracket, e.vision_style
  from guests g join enquiries e on e.id = g.enquiry_id
  where g.invite_token = p_token;
$$;

-- Guest fills/edits their own RSVP.
create or replace function submit_guest_rsvp(
  p_token uuid,
  p_full_name text,
  p_relation text,
  p_side text,
  p_coming_from text,
  p_rsvp_status text,
  p_plus_ones integer,
  p_dietary_notes text,
  p_phone text,
  p_email text
)
returns guests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row guests;
begin
  update guests set
    full_name = coalesce(p_full_name, full_name),
    relation = p_relation,
    side = p_side,
    coming_from = p_coming_from,
    rsvp_status = coalesce(p_rsvp_status, rsvp_status),
    plus_ones = coalesce(p_plus_ones, plus_ones),
    dietary_notes = p_dietary_notes,
    phone = coalesce(p_phone, phone),
    email = coalesce(p_email, email),
    responded_at = now()
  where invite_token = p_token
  returning * into v_row;
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. REALTIME — so the couple's Guests tab and the ops-portal's guest view
--    update live as RSVPs come in.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'guests') then
    alter publication supabase_realtime add table guests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'locations') then
    alter publication supabase_realtime add table locations;
  end if;
end $$;
