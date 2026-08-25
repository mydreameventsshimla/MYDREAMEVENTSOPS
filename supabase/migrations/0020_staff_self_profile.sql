-- ============================================================================
-- 0020_staff_self_profile.sql
--
-- Lets a staff member fix their own name and set their WhatsApp number the
-- moment they set their password -- not something an admin has to enter for
-- them by hand afterward, which is how 0019's chat button would otherwise
-- stay empty indefinitely for every planner already on the roster. Run
-- AFTER 0019. Additive only.
--
-- WHY A SCOPED SELF-UPDATE POLICY, NOT JUST OPENING admin_users:
--
--   `admin_users` has exactly one write policy today -- "admin manages
--   admin_users", admin-only -- because the row's other fields (`role`,
--   `is_active`) are privilege-bearing: `role` decides whether RLS treats
--   someone as staff at all, and every other policy in the schema keys off
--   it. A plain `for update using (auth_user_id = auth.uid())` policy would
--   let a signed-in salesman PATCH their own `role` to `'admin'` through
--   the same request that fixes a typo in their name.
--
--   RLS alone can't express "this column but not that one" -- it decides
--   which ROWS a request may touch, not which COLUMNS within an allowed
--   row. So the policy below opens the row, and a trigger (mirroring
--   `vendor_listings_guard()` in 0015) closes every column back down except
--   the two this feature actually needs, on every non-admin write no matter
--   which policy let it through. An admin editing someone else's row via
--   the existing admin-only policy is unaffected -- the trigger only
--   restricts self-service writes.
-- ============================================================================

drop policy if exists "staff updates own contact info" on admin_users;
create policy "staff updates own contact info" on admin_users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create or replace function admin_users_self_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;
  end if;

  -- Self-service: only full_name and whatsapp_number may move. Everything
  -- else -- role, is_active, email, auth_user_id, meet_link -- snaps back
  -- to its prior value regardless of what the request body contained.
  new.email := old.email;
  new.role := old.role;
  new.is_active := old.is_active;
  new.auth_user_id := old.auth_user_id;
  new.meet_link := old.meet_link;
  return new;
end;
$$;

drop trigger if exists admin_users_self_update_guard_trg on admin_users;
create trigger admin_users_self_update_guard_trg
  before update on admin_users
  for each row execute function admin_users_self_update_guard();
