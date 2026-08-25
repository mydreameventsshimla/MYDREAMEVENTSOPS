-- ============================================================================
-- 0018_admin_takedown.sql
--
-- Gives an admin the two things they had no way to do: take a live listing
-- off the public site, and delete a listing outright. Run AFTER 0017.
--
-- THE HAZARD THIS EXISTS TO CLOSE:
--
--   `venues` / `vendors` hold a MIRROR ROW sharing the listing's id (0015 §8),
--   but nothing links them back the other way — there is no foreign key from
--   `venues` to `vendor_listings`. So `delete from vendor_listings` removes
--   the listing and leaves the mirror row sitting there with
--   `is_active = true`, and the client site reads exactly
--   `venues where is_active = true`. The venue stays live on the public site
--   with its record deleted: nothing left in the portal to find it by, and no
--   way to take it down except hand-written SQL.
--
--   Both RPCs below therefore always deal with the mirror FIRST. That
--   ordering is the entire point of doing this in the database rather than
--   as two client calls that can be interrupted between them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UNPUBLISH — off the public site, back into the agent's hands.
--
--    Reuses the `rejected` state rather than adding an `unpublished` one:
--    the meaning an agent needs ("it's not live, here's why, you can edit and
--    resubmit") is identical, and the whole submit/review loop already
--    handles it. `published_at` is deliberately left set, so the fact it was
--    once live isn't erased, and the slug is kept so republishing lands on
--    the same URL anyone may already have shared.
-- ----------------------------------------------------------------------------
create or replace function unpublish_vendor_listing(
  p_listing_id uuid,
  p_reason text
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
    raise exception 'Only an admin can take a listing down' using errcode = '42501';
  end if;

  select * into v_listing from vendor_listings where id = p_listing_id;
  if not found then
    raise exception 'Listing not found';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason — the agent has to know why it came down';
  end if;

  -- Mirror first: if anything below fails, the listing is already off the
  -- public site, which is the safe direction to fail in.
  update venues set is_active = false where id = p_listing_id;
  update vendors set is_active = false where id = p_listing_id;

  perform set_config('app.listing_privileged', 'on', true);
  update vendor_listings
    set status = 'rejected',
        rejection_reason = p_reason,
        reviewed_by = my_staff_id(),
        reviewed_at = now()
  where id = p_listing_id;
  perform set_config('app.listing_privileged', 'off', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. DELETE — remove the listing and its mirror together.
--
--    Deleting the `venues` row cascades `client_venue_shortlists` (0009:156),
--    which is intended: a shortlist entry pointing at a venue that no longer
--    exists is not worth preserving. `enquiry_vendor_pushes` stores
--    `vendor_label` as text alongside the id, so a planner's past activity
--    still reads correctly after the vendor is gone.
--
--    Cloudinary assets are NOT handled here — Postgres can't call it. The
--    caller destroys those through /api/cloudinary-destroy BEFORE calling
--    this, while the listing row still exists for the permission check to
--    pass. See deleteListingAndMedia() in src/lib/listingActions.ts.
-- ----------------------------------------------------------------------------
create or replace function admin_delete_vendor_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only an admin can delete a published listing' using errcode = '42501';
  end if;

  delete from venues where id = p_listing_id;
  delete from vendors where id = p_listing_id;
  delete from vendor_listings where id = p_listing_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. The same mirror hazard applies to an AGENT deleting their own draft.
--
--    A draft has no mirror row (one is only written on publish), so in
--    practice there is nothing to clean up — but a listing that was live,
--    got unpublished to `rejected`, and is then deleted by its owner WOULD
--    leave a stale `venues` row behind. Belt and braces: a trigger that
--    clears the mirror however the listing goes away, including by routes
--    added later that forget about it.
-- ----------------------------------------------------------------------------
create or replace function vendor_listings_clear_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from venues where id = old.id;
  delete from vendors where id = old.id;
  return old;
end;
$$;

drop trigger if exists vendor_listings_clear_mirror_trg on vendor_listings;
create trigger vendor_listings_clear_mirror_trg
  after delete on vendor_listings
  for each row execute function vendor_listings_clear_mirror();

-- ----------------------------------------------------------------------------
-- 4. GRANTS
-- ----------------------------------------------------------------------------
revoke all on function unpublish_vendor_listing(uuid, text) from public, anon;
revoke all on function admin_delete_vendor_listing(uuid) from public, anon;
grant execute on function unpublish_vendor_listing(uuid, text) to authenticated;
grant execute on function admin_delete_vendor_listing(uuid) to authenticated;
