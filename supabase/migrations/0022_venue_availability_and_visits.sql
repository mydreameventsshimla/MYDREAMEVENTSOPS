-- ============================================================================
-- 0022_venue_availability_and_visits.sql
--
-- The two pieces Phase 7 (the real venue page) needs that nothing built so
-- far provides: a per-date availability calendar a salesman owns and edits,
-- and a structured record of "client asked to visit on this date" a manager
-- can actually query — not just a line of text on an activity timeline.
-- Run AFTER 0021.
--
-- WHY AVAILABILITY IS A SEPARATE RLS SHAPE FROM EVERY OTHER CHILD TABLE:
--
--   vendor_listing_media/spaces/rooms/packages (0015) all lock to the
--   listing's author once it leaves `draft`/`rejected` — the review step
--   is supposed to freeze what an admin is looking at. Availability cannot
--   follow that rule: a published, live venue's calendar changes every
--   week regardless of listing status, and freezing it at publish time
--   would mean the "salesman keeps it current" workflow this migration
--   exists for stops working the moment the listing goes live — exactly
--   when it starts mattering. So the salesman/admin write policy below
--   checks ownership only, not status.
--
-- WHY visit REQUESTS ARE A TABLE AND NOT JUST AN ACTIVITY LOG ROW:
--
--   0021's `log_visit_request` already puts "client asked to visit X" on
--   the manager's timeline, and that still fires here (see the RPC below —
--   it calls the same function). But a "Visits Scheduled" tab needs to
--   list a couple's own upcoming visits with real state (requested vs
--   confirmed vs done) that can be queried and filtered — a free-text log
--   line can't do that. Timeline = notification. This table = queryable
--   state. Both exist because they answer different questions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. AVAILABILITY
-- ----------------------------------------------------------------------------
create table if not exists vendor_listing_availability (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references vendor_listings (id) on delete cascade,
  date date not null,
  -- Matches the demand vocabulary a couple actually needs to act on:
  -- "can I book this date" plus "is it going to cost more because everyone
  -- else wants it too". `auspicious` is informational, not a booking
  -- constraint — it can combine with any of the demand levels.
  status text not null default 'available'
    check (status in ('available', 'low_demand', 'high_demand', 'peak_demand', 'fully_booked', 'blocked')),
  is_auspicious boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, date)
);

create or replace function set_updated_at_availability()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists vendor_listing_availability_updated_at on vendor_listing_availability;
create trigger vendor_listing_availability_updated_at
  before update on vendor_listing_availability
  for each row execute function set_updated_at_availability();

create index if not exists vendor_listing_availability_idx
  on vendor_listing_availability (listing_id, date);

alter table vendor_listing_availability enable row level security;

drop policy if exists "public reads availability of published listings" on vendor_listing_availability;
create policy "public reads availability of published listings" on vendor_listing_availability
  for select to anon, authenticated
  using (exists (
    select 1 from vendor_listings l
    where l.id = vendor_listing_availability.listing_id and l.status = 'published'
  ));

drop policy if exists "staff reads availability" on vendor_listing_availability;
create policy "staff reads availability" on vendor_listing_availability
  for select to authenticated using (is_staff());

drop policy if exists "admin manages availability" on vendor_listing_availability;
create policy "admin manages availability" on vendor_listing_availability
  for all to authenticated using (is_admin()) with check (is_admin());

-- The ownership-only (no status gate) policy described above.
drop policy if exists "sales manages own listing availability" on vendor_listing_availability;
create policy "sales manages own listing availability" on vendor_listing_availability
  for all to authenticated
  using (exists (
    select 1 from vendor_listings l
    where l.id = vendor_listing_availability.listing_id
      and l.owner_salesman_id = my_staff_id()
      and my_staff_role() = 'sales'
  ))
  with check (exists (
    select 1 from vendor_listings l
    where l.id = vendor_listing_availability.listing_id
      and l.owner_salesman_id = my_staff_id()
      and my_staff_role() = 'sales'
  ));

grant select on vendor_listing_availability to anon, authenticated;
grant insert, update, delete on vendor_listing_availability to authenticated;

-- Bulk set: the CSV/"apply to whole year" path in the listing editor. One
-- call, one round trip, instead of hundreds of individual upserts for a
-- year of dates — and a single ownership check instead of relying on RLS
-- to re-check it per row.
create or replace function set_vendor_availability(
  p_listing_id uuid,
  p_dates date[],
  p_status text,
  p_is_auspicious boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_salesman_id into v_owner from vendor_listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'Listing not found';
  end if;
  if not is_admin() and not (my_staff_role() = 'sales' and v_owner = my_staff_id()) then
    raise exception 'You do not manage this listing' using errcode = '42501';
  end if;

  insert into vendor_listing_availability (listing_id, date, status, is_auspicious)
  select p_listing_id, d, p_status, p_is_auspicious
  from unnest(p_dates) as d
  on conflict (listing_id, date) do update
    set status = excluded.status, is_auspicious = excluded.is_auspicious;
end;
$$;

revoke all on function set_vendor_availability(uuid, date[], text, boolean) from public, anon;
grant execute on function set_vendor_availability(uuid, date[], text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. VISIT REQUESTS
-- ----------------------------------------------------------------------------
create table if not exists venue_visit_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  enquiry_id uuid references enquiries (id) on delete set null,
  venue_id uuid not null references vendor_listings (id) on delete cascade,
  requested_date date not null,
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists venue_visit_requests_client_idx on venue_visit_requests (client_id, requested_date);
create index if not exists venue_visit_requests_enquiry_idx on venue_visit_requests (enquiry_id);

alter table venue_visit_requests enable row level security;

-- Same anon trust model as the shortlist table it sits beside: knowledge of
-- your own client_id is the credential. Direct table grants (not RPC-only)
-- because the "Visits Scheduled" tab needs ordinary select/filter, the same
-- reasoning as 0015's public listing reads.
revoke all on venue_visit_requests from anon, authenticated;

drop policy if exists "staff reads visit requests" on venue_visit_requests;
create policy "staff reads visit requests" on venue_visit_requests
  for select to authenticated using (is_staff());

drop policy if exists "admin manages visit requests" on venue_visit_requests;
create policy "admin manages visit requests" on venue_visit_requests
  for all to authenticated using (is_admin()) with check (is_admin());

-- Request a visit: inserts the row AND puts it on the manager's timeline via
-- 0021's log_visit_request, in one call — the couple-facing action and the
-- manager-facing notification either both happen or neither does.
create or replace function request_venue_visit(
  p_client_id uuid,
  p_venue_id uuid,
  p_requested_date date,
  p_enquiry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into venue_visit_requests (client_id, enquiry_id, venue_id, requested_date)
  values (p_client_id, p_enquiry_id, p_venue_id, p_requested_date)
  returning id into v_id;

  if p_enquiry_id is not null then
    perform log_visit_request(p_enquiry_id, p_venue_id, to_char(p_requested_date, 'DD Mon YYYY'));
  end if;

  return v_id;
end;
$$;

revoke all on function request_venue_visit(uuid, uuid, date, uuid) from public, anon;
grant execute on function request_venue_visit(uuid, uuid, date, uuid) to authenticated;
-- Anon needs this too: most couples browse before they ever sign in (see
-- 0014's anonymous bearer-token model), and "schedule a visit" is exactly
-- the kind of action that shouldn't require creating an account first.
grant execute on function request_venue_visit(uuid, uuid, date, uuid) to anon;

-- A couple's own visit list — anon-safe by client_id, same shape as
-- fetch_my_shortlisted_venue_ids.
create or replace function fetch_my_visit_requests(p_client_id uuid)
returns setof venue_visit_requests
language sql
stable
security definer
set search_path = public
as $$
  select * from venue_visit_requests where client_id = p_client_id order by requested_date;
$$;

revoke all on function fetch_my_visit_requests(uuid) from public;
grant execute on function fetch_my_visit_requests(uuid) to anon, authenticated;
