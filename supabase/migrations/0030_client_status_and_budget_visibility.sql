-- ============================================================================
-- 0030_client_status_and_budget_visibility.sql
--
-- Two more manager-only tables were, on reflection, wrong to keep hidden
-- from the couple:
--
--   1. confirmed_vendors (0028) was built "manager-only, a couple already
--      knows who they've booked" — true only if the couple is in the loop
--      on every call. Direct feedback: they have no way to see what's
--      actually locked in vs. still just wishlisted/discussed. Read-only,
--      same bearer-token trust model as proposals/event_functions.
--
--   2. enquiry_payments (0025) mixes money coming IN from the couple
--      ('client_payment') with money going OUT to vendors ('vendor_cost')
--      — the latter is the agency's internal cost/margin data and must
--      never reach the client. This policy exposes ONLY client_payment
--      rows; the `kind = 'client_payment'` check is enforced by the
--      policy itself, not just by the query the client app happens to
--      write, so a vendor_cost row is structurally unreachable by anon.
--
-- Run AFTER 0029.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. FETCH_ENQUIRY_STATUS — enquiries.select was locked to `authenticated`
--    in 0014 (own client_id via auth.uid()), because the full row carries
--    real PII (contact_raw, dream_text, estimated_budget). Most couples
--    never sign in at all — they use the plain anon bearer-token model
--    every other client-facing table here uses (event_functions,
--    proposals, confirmed_vendors: `to anon, authenticated using (true)`).
--    Widening the whole table's grant to match would leak that PII to
--    anon; instead, same shape as fetch_my_planner (0019), a narrow
--    SECURITY DEFINER RPC exposes only the three fields a status display
--    actually needs.
-- ----------------------------------------------------------------------------
create or replace function fetch_enquiry_status(p_enquiry_id uuid)
returns table (
  status text,
  event_date date,
  confirmed_venue_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.status, e.event_date, e.confirmed_venue_name
  from enquiries e
  where e.id = p_enquiry_id;
$$;

drop policy if exists "client reads own confirmed vendors" on confirmed_vendors;
create policy "client reads own confirmed vendors" on confirmed_vendors
  for select to anon, authenticated using (true);

drop policy if exists "client reads own client payments" on enquiry_payments;
create policy "client reads own client payments" on enquiry_payments
  for select to anon, authenticated using (kind = 'client_payment');
