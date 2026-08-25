-- ============================================================================
-- 0017_sales_delete_applications.sql
--
-- Lets a sales agent remove a vendor application they submitted. Run AFTER
-- 0016. Additive — one policy, nothing else touched.
--
-- WHY THIS WAS MISSING AND WHY IT MATTERS:
--
--   0012 gave sales SELECT on their own applications and 0015 gave them
--   INSERT. Neither gave them DELETE, so an agent who captured a lead by
--   mistake — wrong vendor, duplicate, a deal that fell through — had no way
--   to take it back.
--
--   That gap became visible through the listing editor. Deleting a listing
--   built from an application leaves the application behind, and because the
--   Vendor Listings screen surfaces "approved applications with no profile
--   yet" as an action card, the deleted vendor immediately reappears as a
--   *Build profile* prompt. The agent's reasonable reading of that is "the
--   delete didn't work" — the listing really was gone, but the only visible
--   evidence said otherwise.
--
--   Scoped to `submitted_by = my_staff_id()`: an agent can withdraw their own
--   lead, and nobody else's. Public self-submissions (submitted_by is null)
--   stay admin-only, since no sales agent owns those.
--
--   `vendor_listings.application_id` is `on delete set null` (0015), so
--   deleting an application never cascades into a listing built from it — a
--   published venue does not vanish because someone tidied up a lead.
-- ============================================================================

drop policy if exists "sales deletes own applications" on vendor_applications;
create policy "sales deletes own applications" on vendor_applications
  for delete to authenticated
  using (
    my_staff_role() = 'sales'
    and submitted_by is not null
    and submitted_by = my_staff_id()
  );
