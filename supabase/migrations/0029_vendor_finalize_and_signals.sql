-- ============================================================================
-- 0029_vendor_finalize_and_signals.sql
--
-- Closes the gap between what a couple actually does (shortlist, wishlist,
-- request a visit) and what a manager sees when booking a vendor. Before
-- this, a manager typed a vendor name into confirmed_vendors (0028) blind
-- — with zero visibility into what the client had shortlisted, and zero
-- staff read access to client_venue_shortlists at all (it was fully
-- revoked from authenticated in 0014, client-only via RPC).
--
-- Two pieces:
--   1. 'finalized' — a new enquiry_vendor_pushes status. 'wishlist' means
--      "we like this"; 'finalized' means "this is our pick", for any
--      vendor category (not just venues). The couple sets it themselves
--      from a wishlisted item.
--   2. Staff read access to client_venue_shortlists, scoped to a
--      planner's own clients — same shape as every other planner-scoped
--      policy in this schema. venue_visit_requests already has staff
--      read access (0022); this was the one signal actually missing it.
--
-- Run AFTER 0028.
-- ============================================================================

alter table enquiry_vendor_pushes drop constraint if exists enquiry_vendor_pushes_status_check;
alter table enquiry_vendor_pushes add constraint enquiry_vendor_pushes_status_check
  check (status in ('pushed', 'viewing', 'wishlist', 'skipped', 'quote', 'finalized'));

-- update_push_status (0014) has its OWN hardcoded validation list — a
-- write from the client goes through this RPC, not a direct UPDATE
-- (0014 revoked that grant), so widening the column constraint alone
-- would still reject 'finalized' here.
create or replace function update_push_status(p_push_id uuid, p_enquiry_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('viewing', 'wishlist', 'skipped', 'quote', 'finalized') then
    raise exception 'invalid push status %', p_status;
  end if;
  update enquiry_vendor_pushes
    set status = p_status
    where id = p_push_id and enquiry_id = p_enquiry_id;
end;
$$;

-- 0014 revoked table-level grants entirely (client reads only via
-- fetch_my_shortlisted_venue_ids); restoring SELECT here doesn't reopen
-- that — it's still gated by the RLS policy below, same "grant broadly at
-- the table level, narrow with RLS" shape as the rest of this schema uses
-- for `authenticated` (which covers both couples and staff, differentiated
-- only by policy logic, never by the grant itself).
grant select on client_venue_shortlists to authenticated;

drop policy if exists "planner reads shortlists for own clients" on client_venue_shortlists;
create policy "planner reads shortlists for own clients" on client_venue_shortlists
  for select to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.client_id = client_venue_shortlists.client_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "admin reads shortlists" on client_venue_shortlists;
create policy "admin reads shortlists" on client_venue_shortlists
  for select to authenticated using (is_admin());
