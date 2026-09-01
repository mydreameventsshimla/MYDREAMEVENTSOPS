-- ============================================================================
-- 0027_guest_travel.sql
--
-- For a destination wedding, "who's coming and how many" (already solved)
-- is the easy half — "who's arriving when, and who needs a hotel room or
-- an airport pickup" is the part a manager was completely blind to before
-- this migration. Two pieces:
--
--   1. Travel fields added to `guests` directly, collected at RSVP time
--      (the guest is the source of truth for their own travel plans, not
--      the couple or the manager) — same table, same self-service RSVP
--      flow (submit_guest_rsvp), just a few more optional questions.
--   2. guest_accommodations — the manager's own room-block/assignment
--      tool: which guest is in which hotel, which room, for which dates.
--      Manager-only for now (not guest-visible) — a guest already knows
--      their own booking; the gap this closes is the MANAGER's
--      visibility and ability to coordinate, not the guest's.
--
-- Run AFTER 0026.
-- ============================================================================

alter table guests add column if not exists arrival_date date;
alter table guests add column if not exists arrival_time time;
alter table guests add column if not exists departure_date date;
alter table guests add column if not exists needs_accommodation boolean not null default false;
alter table guests add column if not exists needs_transport boolean not null default false;
alter table guests add column if not exists travel_notes text;

create index if not exists idx_guests_arrival_date on guests (enquiry_id, arrival_date) where arrival_date is not null;

-- Widened, not replaced — PostgREST RPC calls are named-parameter (see
-- 0021's write-up on this same pattern), so existing callers that only
-- send the original params are unaffected by these new optional ones.
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
  p_email text,
  p_arrival_date date default null,
  p_arrival_time time default null,
  p_departure_date date default null,
  p_needs_accommodation boolean default null,
  p_needs_transport boolean default null,
  p_travel_notes text default null
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
    arrival_date = p_arrival_date,
    arrival_time = p_arrival_time,
    departure_date = p_departure_date,
    needs_accommodation = coalesce(p_needs_accommodation, needs_accommodation),
    needs_transport = coalesce(p_needs_transport, needs_transport),
    travel_notes = p_travel_notes,
    responded_at = now()
  where invite_token = p_token
  returning * into v_row;
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- GUEST_ACCOMMODATIONS — the manager's room-block tool.
-- ----------------------------------------------------------------------------
create table if not exists guest_accommodations (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests (id) on delete cascade,
  hotel_name text,
  room_type text,
  room_number text,
  check_in date,
  check_out date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_guest_accommodations_guest on guest_accommodations (guest_id);

alter table guest_accommodations enable row level security;

drop policy if exists "planner manages accommodations for own guests" on guest_accommodations;
create policy "planner manages accommodations for own guests" on guest_accommodations
  for all to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (
      select 1 from guests g join enquiries e on e.id = g.enquiry_id
      where g.id = guest_id and e.assigned_to = my_staff_id()
    )
  )
  with check (
    my_staff_role() = 'planner'
    and exists (
      select 1 from guests g join enquiries e on e.id = g.enquiry_id
      where g.id = guest_id and e.assigned_to = my_staff_id()
    )
  );

drop policy if exists "admin full access guest accommodations" on guest_accommodations;
create policy "admin full access guest accommodations" on guest_accommodations
  for all to authenticated using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'guest_accommodations') then
    alter publication supabase_realtime add table guest_accommodations;
  end if;
end $$;
