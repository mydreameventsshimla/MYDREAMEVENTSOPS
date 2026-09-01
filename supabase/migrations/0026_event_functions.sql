-- ============================================================================
-- 0026_event_functions.sql
--
-- The foundational gap: enquiries.event_date/confirmed_venue_name (0025) is
-- ONE date, ONE venue per enquiry. A destination wedding is almost never
-- one event — mehendi, haldi, sangeet, the wedding ceremony, the reception,
-- often 3-5 days, sometimes different venues, each with its own timing.
-- The data model couldn't represent that at all before this migration.
--
-- enquiries.event_date/confirmed_venue_* are NOT removed or replaced —
-- they stay the "headline" date (still set automatically when a proposal
-- is accepted, see 0025's respond_to_proposal()), useful as a single
-- quick-glance answer to "when's the main day". event_functions is the
-- real breakdown underneath that a manager builds out once a couple is
-- won: as many dated, timed, venued functions as this wedding actually
-- has. Nothing here changes 0025's RPC or its behavior.
--
-- Run AFTER 0025.
-- ============================================================================

create table if not exists event_functions (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  function_date date,
  start_time time,
  venue_id uuid references venues (id),
  venue_name text,
  guest_count_estimate integer,
  notes text,
  -- Manual ordering, not creation order or date order: a manager building
  -- this out mid-planning may not know every date yet (venue confirmed,
  -- date still pending) but still wants Mehendi listed before Sangeet.
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_functions_enquiry on event_functions (enquiry_id, display_order);

alter table event_functions enable row level security;

-- Staff side: identical planner-scoped shape as proposals/payments/tasks.
drop policy if exists "planner manages functions on own enquiries" on event_functions;
create policy "planner manages functions on own enquiries" on event_functions
  for all to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  )
  with check (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "admin full access event functions" on event_functions;
create policy "admin full access event functions" on event_functions
  for all to authenticated using (is_admin()) with check (is_admin());

-- Client side: read-only, same bearer-token model as proposals — this is
-- the couple's own wedding schedule, they should see it the moment a
-- manager builds it out, same as everything else couple-facing here.
drop policy if exists "client reads own event functions" on event_functions;
create policy "client reads own event functions" on event_functions
  for select to anon, authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_functions') then
    alter publication supabase_realtime add table event_functions;
  end if;
end $$;
