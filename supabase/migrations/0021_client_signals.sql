-- ============================================================================
-- 0021_client_signals.sql
--
-- Three things a couple does on the public/client site that a manager
-- currently has no way to see: shortlisting a venue, asking to visit one,
-- and requesting a callback from any other vendor. Run AFTER 0020.
--
-- WHY enquiry_activity_log AND NOT NEW TABLES:
--
--   The manager-facing timeline for exactly this purpose already exists —
--   `enquiry_activity_log` (0012), realtime-subscribed, rendered on
--   Client History today. A "visit request" or "callback request" needs
--   nothing structurally different from the `push`/`client_reaction` rows
--   already flowing through it: an enquiry_id, a type, a human-readable
--   line, and a `meta` jsonb bag for the specifics (which venue, what date).
--   A dedicated table per event kind would mean a dedicated manager view
--   per event kind too, for no benefit — the timeline is exactly where a
--   manager already looks for "what has this couple been doing".
--
-- SCOPING: same anon trust model as every other couple-facing write in this
-- schema (add_guest, submit_guest_rsvp, ...) — knowledge of `enquiry_id`
-- is the credential. That is a deliberate, already-accepted tradeoff here
-- (see 0014's write-up on why enquiry_id isn't treated as a secret for
-- low-sensitivity, couple-initiated writes), not a new one introduced by
-- this migration.
--
-- NOT DONE HERE: nothing in either app calls `log_visit_request` or
-- `log_callback_request` yet. Visit-scheduling needs a date picker on a
-- venue page that doesn't exist until Phase 7, and callback requests need
-- vendor-category directory pages that don't exist until Phase 10. Both
-- RPCs are shipped now so that work has something ready to call the moment
-- it exists, and neither wiring nor UI is silently half-built here.
--
-- DONE HERE: shortlisting. That UI already exists and already works today
-- (VendorDirectoryModal's shortlist button, via add_shortlist/
-- remove_shortlist), so this migration wires it straight through — a
-- manager sees "Client shortlisted Wildflower Hall" on Client History the
-- moment a couple clicks the heart icon, no Phase 7 dependency.
-- ============================================================================

alter table enquiry_activity_log drop constraint if exists enquiry_activity_log_type_check;
alter table enquiry_activity_log add constraint enquiry_activity_log_type_check
  check (type in (
    'note', 'status_change', 'claim', 'assignment', 'push', 'client_reaction',
    'shortlist', 'visit_request', 'callback_request'
  ));

-- ----------------------------------------------------------------------------
-- 1. SHORTLIST — extends the existing RPC with an optional enquiry_id.
--
--    A default of null keeps every existing caller working unchanged
--    (PostgREST RPC calls are named-parameter, so a caller that still only
--    sends p_client_id/p_venue_id is unaffected). Only logs on ADD, not
--    remove — a couple un-shortlisting something isn't a signal a manager
--    needs to act on, and logging both would double the noise on the
--    timeline for half the value.
-- ----------------------------------------------------------------------------
create or replace function add_shortlist(
  p_client_id uuid,
  p_venue_id uuid,
  p_enquiry_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
  v_name text;
begin
  select exists (
    select 1 from client_venue_shortlists where client_id = p_client_id and venue_id = p_venue_id
  ) into v_already;

  if not v_already then
    insert into client_venue_shortlists (client_id, venue_id) values (p_client_id, p_venue_id);

    if p_enquiry_id is not null then
      select name into v_name from vendor_listings where id = p_venue_id;
      insert into enquiry_activity_log (enquiry_id, type, content, meta)
      values (
        p_enquiry_id,
        'shortlist',
        'Client shortlisted ' || coalesce(v_name, 'a venue'),
        jsonb_build_object('venue_id', p_venue_id, 'venue_name', v_name)
      );
    end if;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. VISIT REQUEST — "client asked for a visit". Not wired to any UI yet
--    (see header); the venue page that would call this is Phase 7.
-- ----------------------------------------------------------------------------
create or replace function log_visit_request(
  p_enquiry_id uuid,
  p_venue_id uuid,
  p_preferred_date text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from vendor_listings where id = p_venue_id;
  insert into enquiry_activity_log (enquiry_id, type, content, meta)
  values (
    p_enquiry_id,
    'visit_request',
    'Client asked to visit ' || coalesce(v_name, 'a venue')
      || case when p_preferred_date is not null then ' — preferred date: ' || p_preferred_date else '' end,
    jsonb_build_object('venue_id', p_venue_id, 'venue_name', v_name, 'preferred_date', p_preferred_date)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. CALLBACK REQUEST — "client requested a call with this vendor". Not
--    wired to any UI yet (see header); needs the Phase 10 vendor directory
--    pages, which are what "Request a callback" will live on.
-- ----------------------------------------------------------------------------
create or replace function log_callback_request(
  p_enquiry_id uuid,
  p_listing_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_category text;
begin
  select name, category into v_name, v_category from vendor_listings where id = p_listing_id;
  insert into enquiry_activity_log (enquiry_id, type, content, meta)
  values (
    p_enquiry_id,
    'callback_request',
    'Client requested a callback from ' || coalesce(v_name, 'a vendor'),
    jsonb_build_object('listing_id', p_listing_id, 'vendor_name', v_name, 'category', v_category)
  );
end;
$$;
