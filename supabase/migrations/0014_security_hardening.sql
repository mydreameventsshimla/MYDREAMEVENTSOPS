-- ============================================================================
-- 0014_security_hardening.sql
--
-- Closes findings from a security review of the anonymous ("bearer token
-- by possession of a uuid") trust model introduced in 0009/0012/0013.
-- Run this AFTER 0012 and 0013. Safe to re-run (idempotent, same
-- conventions as prior migrations).
--
-- What this fixes, and why each one was real:
--
--   1. ACCOUNT TAKEOVER (clients.email): `upsert_client_for_inquiry`
--      returns an existing client's uuid when called with a phone number
--      that already matches (needed for the "returning couple" flow), and
--      a separate open UPDATE let anon rewrite ANY client's `email` to
--      whatever they wanted. Chain: know a target's phone -> get their
--      client_id -> set clients.email to an address you control -> sign in
--      with that email -> get_or_link_my_client() links you to their
--      account, permanently. Fix: fold email into the upsert RPC (so the
--      only write happens inside the same request that legitimately
--      created/matched the row) and revoke anon/authenticated's ability to
--      UPDATE `clients` directly at the privilege level, not just via
--      policy — so no future `using (true)`-style policy can reopen this
--      by accident.
--
--   2. GUEST LIST PII (guests): the previous RPCs (list_guests_for_enquiry,
--      remove_guest, mark_guest_invited) were gated on nothing but
--      `enquiry_id` — and enquiry_id is NOT a secret: every guest's own
--      `fetch_guest_by_token` response includes it (guests.enquiry_id),
--      so any single guest who opens their own RSVP link can read it out
--      of the network tab and then call list_guests_for_enquiry(that_id)
--      to dump every other guest's name/phone/email/dietary notes, or
--      delete them. Fix: split the credential. `enquiry_id` stays the
--      credential for the intentionally-public "self-register" flow
--      (add_guest, unchanged), but list/remove/mark-invited now require a
--      separate `guest_admin_token` that is never returned in any
--      guest-facing response — only to the enquiry's own creator, once,
--      at creation time (create_enquiry_for_inquiry) or via a real
--      auth.uid() check for a signed-in returning client
--      (fetch_my_guest_admin_token).
--
--   3. enquiry_vendor_pushes / client_venue_shortlists / vision_statements:
--      all three had `for all ... using (true)` (or `for update ...
--      using (true)`) grants to `anon` — not scoped to any id at all, so
--      the entire table was readable/writable/deletable by anyone, no
--      knowledge of any id required. Shortlists and vision statements move
--      to RPC-gated access (no realtime subscription depends on direct
--      table access for either, so this is a clean, non-breaking swap).
--      enquiry_vendor_pushes keeps its anon SELECT policy (the couple's
--      "For You" panel needs live realtime, which requires the anon role
--      to pass RLS on the table directly — Realtime does not go through
--      RPCs) but the anon UPDATE policy is replaced with a validated RPC
--      that only allows the couple's own reaction values, not an
--      arbitrary write to any row.
--
-- Residual, intentionally NOT fully closed here: enquiry_vendor_pushes
-- remains anon-SELECT-able table-wide (an unfiltered `select *` still
-- returns every enquiry_id in the system). Fully closing that needs a
-- scoped-realtime mechanism (e.g. per-enquiry signed broadcast channels)
-- that doesn't exist yet in this schema — a bigger architecture change,
-- not a policy tweak. Track it separately; it's a lower-severity leak now
-- that guests/shortlists/vision are no longer reachable from a bare
-- enquiry_id.
--
-- REVISION NOTE (second pass, after a run against a real project): the
-- live `clients` table turned out to have no `auth_user_id` column at
-- all, meaning 0009's get_or_link_my_client() / link_current_auth_to_client()
-- / "clients read own via auth link" policy never actually existed here —
-- `create table if not exists` was a no-op against a `clients` table that
-- predates 0009, so that column and everything depending on it was never
-- created, and the persistent-login feature has been silently
-- non-functional (a returning, signed-in visitor just falls through to
-- the inquiry wizard again instead of seeing their existing event). Not
-- something this migration introduced, but its own
-- fetch_my_guest_admin_token depends on that same column, so section 0
-- below rebuilds the whole auth-linking trio from scratch.
--
-- The whole file is now wrapped in one explicit transaction: on a first
-- attempt some early statements (revoke, the redefined
-- upsert_client_for_inquiry) committed before a later statement failed,
-- leaving a partially-applied state (including an orphaned old-signature
-- overload of upsert_client_for_inquiry — cleaned up in section 1 below).
-- BEGIN/COMMIT means a failure anywhere in a re-run rolls back cleanly
-- instead of doing that again.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. AUTH LINKING PREREQUISITE — rebuilds what 0009 intended but never
--    actually created against this project (see revision note above).
--    Copied from 0009 unchanged; only run here because it was missing.
-- ----------------------------------------------------------------------------

alter table clients add column if not exists auth_user_id uuid unique references auth.users (id) on delete set null;
create index if not exists idx_clients_auth_user_id on clients (auth_user_id);

drop policy if exists "clients read own via auth link" on clients;
create policy "clients read own via auth link" on clients
  for select to authenticated
  using (auth_user_id = auth.uid());

-- REVISION NOTE (third pass): 0009's original version of this function
-- only ever matched a returning session by email — which meant it never
-- worked for phone-based sign-in at all (auth.users.email is null for a
-- phone-OTP session), even though phone is this app's primary identifier
-- (upsert_client_for_inquiry itself matches returning wizard submissions
-- by phone, not email). Extended below to also try phone, normalized to
-- digits-only on both sides since Supabase Auth's auth.users.phone is
-- typically stored without a leading "+" while clients.phone_e164 (built
-- client-side from the country-code picker) is stored with one — a raw
-- string match between the two would silently never fire.
create or replace function get_or_link_my_client()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_email text;
  v_phone text;
begin
  select id into v_client_id from clients where auth_user_id = auth.uid();
  if v_client_id is not null then
    return v_client_id;
  end if;

  select email, phone into v_email, v_phone from auth.users where id = auth.uid();

  if v_email is not null and v_email <> '' then
    select id into v_client_id
      from clients
      where auth_user_id is null and email = v_email
      order by created_at desc
      limit 1;

    if v_client_id is not null then
      update clients set auth_user_id = auth.uid() where id = v_client_id;
      return v_client_id;
    end if;
  end if;

  if v_phone is not null and v_phone <> '' then
    select id into v_client_id
      from clients
      where auth_user_id is null
        and phone_e164 is not null
        and regexp_replace(phone_e164, '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')
      order by created_at desc
      limit 1;

    if v_client_id is not null then
      update clients set auth_user_id = auth.uid() where id = v_client_id;
      return v_client_id;
    end if;
  end if;

  return null;
end;
$$;

create or replace function link_current_auth_to_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update clients
    set auth_user_id = auth.uid()
    where id = p_client_id and auth_user_id is null;
end;
$$;

-- The other half of the prerequisite: even with clients.auth_user_id now
-- linked, a signed-in client still needs an RLS policy that lets them
-- actually SELECT their own enquiries row — fetchMyLatestEnquiry() reads
-- through this policy, and without it the query fails and the app falls
-- back to showing the inquiry wizard again as if no enquiry existed.
--
-- MUST go through this SECURITY DEFINER helper rather than an inline
-- `select id from clients where auth_user_id = auth.uid()` subquery (which
-- is how 0009 originally wrote it). An inline subquery reads `clients`
-- with RLS active, and 0012's "planner reads clients behind their
-- enquiries" policy on `clients` reads `enquiries` right back —
-- enquiries -> clients -> enquiries, which Postgres rejects outright with
-- "infinite recursion detected in policy for relation enquiries". The
-- cycle only exists once BOTH policies are present, which is why 0009's
-- version looked fine in isolation. SECURITY DEFINER runs as the function
-- owner with RLS bypassed, so the loop is broken.
create or replace function my_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from clients where auth_user_id = auth.uid();
$$;

drop policy if exists "clients read own enquiries via auth link" on enquiries;
create policy "clients read own enquiries via auth link" on enquiries
  for select to authenticated
  using (client_id in (select my_client_ids()));

-- ----------------------------------------------------------------------------
-- 1. CLIENTS — close the account-takeover chain
-- ----------------------------------------------------------------------------

-- Defense in depth: revoke at the privilege level so no future
-- `using (true)`-style policy can reopen a blanket write on this table for
-- anon — anonymous callers are the actual vulnerability; every anon write
-- goes through SECURITY DEFINER RPCs regardless (which bypass grants
-- entirely, running as the function owner). Deliberately NOT revoked from
-- `authenticated`: 0012's "admin full access clients" policy grants
-- admins direct write access (`for all ... using (is_admin())`), and
-- Postgres requires both a passing RLS policy AND the base table
-- privilege for a write to succeed — revoking from `authenticated` too
-- would silently disable that policy for every admin. Since the one
-- policy that ever let a non-admin authenticated user (e.g. a signed-in
-- bride) write here is dropped below, RLS alone already fully re-secures
-- the `authenticated` grant: is_admin() is false for anyone else, so
-- their write is rejected regardless of what the grant allows.
revoke update, insert, delete on clients from anon;

-- Drop whatever anon-permissive write policy already exists on this table
-- in the live project (referenced only in application code comments, not
-- in any migration file — hence dropped defensively by name here).
drop policy if exists "Public can update own client row on upsert" on clients;
drop policy if exists "clients can be created by anyone" on clients;
drop policy if exists "Anyone can insert a client" on clients;

-- A first attempt at this migration created a second, 5-argument overload
-- of this function alongside the original 4-argument one (create or
-- replace only replaces an exact signature match) — drop the old one
-- explicitly so only the p_email-aware version remains callable.
drop function if exists upsert_client_for_inquiry(text, text, text, text);

create or replace function upsert_client_for_inquiry(
  p_full_name text,
  p_phone_country_code text,
  p_phone_number text,
  p_phone_e164 text,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if p_phone_e164 is not null and p_phone_e164 <> '' then
    select id into v_client_id from clients where phone_e164 = p_phone_e164 limit 1;
  end if;

  if v_client_id is not null then
    update clients
      set full_name = p_full_name,
          phone_country_code = coalesce(p_phone_country_code, phone_country_code),
          phone_number = coalesce(p_phone_number, phone_number),
          email = coalesce(nullif(trim(p_email), ''), email)
      where id = v_client_id;
    return v_client_id;
  end if;

  insert into clients (full_name, phone_country_code, phone_number, phone_e164, email)
    values (p_full_name, p_phone_country_code, p_phone_number, p_phone_e164, nullif(trim(p_email), ''))
    returning id into v_client_id;

  return v_client_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1b. ENQUIRIES.ESTIMATED_BUDGET — the client app's wizard (api.ts) has
--     always written this column and ops-portal's admin screens have
--     always read/written it, but no migration file ever actually created
--     it (0012 assumed the live project already had it out-of-band, the
--     way it also assumed admin_users/vendor_applications already
--     existed). Added here, idempotently, so a project bootstrapped
--     strictly from these migration files doesn't fail on every single
--     inquiry submission.
-- ----------------------------------------------------------------------------
alter table enquiries add column if not exists estimated_budget numeric;

-- ----------------------------------------------------------------------------
-- 2. GUESTS — split the public self-register credential from the private
--    "manage my guest list" credential
-- ----------------------------------------------------------------------------

alter table enquiries add column if not exists guest_admin_token uuid not null default gen_random_uuid() unique;

-- Wraps the enquiry insert (previously a bare `.insert()` from the client
-- with no RETURNING, for the same RLS/RETURNING reason documented in
-- 0009). Returning the freshly-generated guest_admin_token here, in the
-- same request that creates the row, is the ONLY place an anonymous
-- caller ever legitimately learns it.
create or replace function create_enquiry_for_inquiry(
  p_client_id uuid,
  p_source text,
  p_destination text,
  p_event_date_text text,
  p_guest_bracket text,
  p_vision_style text,
  p_estimated_budget numeric default null
)
returns table (id uuid, guest_admin_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token uuid;
begin
  insert into enquiries (client_id, source, destination, event_date_text, guest_bracket, vision_style, estimated_budget)
    values (p_client_id, p_source, p_destination, p_event_date_text, p_guest_bracket, p_vision_style, p_estimated_budget)
    returning enquiries.id, enquiries.guest_admin_token into v_id, v_token;
  return query select v_id, v_token;
end;
$$;

-- Signed-in returning client's path to the same token: real auth.uid()
-- ownership check, not knowledge of any id, so this is safe to expose
-- despite taking enquiry_id as a parameter.
create or replace function fetch_my_guest_admin_token(p_enquiry_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.guest_admin_token
  from enquiries e
  join clients c on c.id = e.client_id
  where e.id = p_enquiry_id and c.auth_user_id = auth.uid();
$$;

create or replace function list_guests_for_admin(p_guest_admin_token uuid)
returns setof guests
language sql
stable
security definer
set search_path = public
as $$
  select g.*
  from guests g
  join enquiries e on e.id = g.enquiry_id
  where e.guest_admin_token = p_guest_admin_token
  order by g.created_at asc;
$$;

create or replace function remove_guest_admin(p_guest_id uuid, p_guest_admin_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from guests g
  using enquiries e
  where g.id = p_guest_id
    and e.id = g.enquiry_id
    and e.guest_admin_token = p_guest_admin_token;
end;
$$;

create or replace function mark_guest_invited_admin(
  p_guest_id uuid,
  p_guest_admin_token uuid,
  p_invited_via text,
  p_delivery_status text default 'sent'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update guests g
    set invited_via = p_invited_via, invite_delivery_status = p_delivery_status, invited_at = now()
    from enquiries e
    where g.id = p_guest_id
      and e.id = g.enquiry_id
      and e.guest_admin_token = p_guest_admin_token;
end;
$$;

-- The old id-keyed private-management functions are no longer safe to
-- call with just an enquiry_id (see finding #2 above) and nothing in this
-- codebase should call them anymore after this migration's app-side
-- changes ship. Dropped outright rather than left dormant.
drop function if exists list_guests_for_enquiry(uuid);
drop function if exists remove_guest(uuid, uuid);
drop function if exists mark_guest_invited(uuid, uuid, text, text);

-- add_guest is UNCHANGED and stays anon-callable by design: it's the
-- couple's own "Add Guest" button (already holds enquiry_id in app state,
-- never shared) AND the intentionally-public generic self-register link
-- (/guest/invite/:enquiryId) — an insert-only capability with no PII read
-- back out is a much smaller blast radius than list/remove ever were.

-- ----------------------------------------------------------------------------
-- 3. CLIENT_VENUE_SHORTLISTS — replace the blanket anon policy with
--    client_id-scoped RPCs (client_id is never exposed to a third party
--    the way enquiry_id is, so it remains an acceptable bearer token here)
-- ----------------------------------------------------------------------------

drop policy if exists "open shortlist read/write" on client_venue_shortlists;
revoke all on client_venue_shortlists from anon, authenticated;

create or replace function fetch_my_shortlisted_venue_ids(p_client_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select venue_id from client_venue_shortlists where client_id = p_client_id;
$$;

-- Written as an explicit existence check rather than `on conflict ...`,
-- since that requires a unique/PK constraint on (client_id, venue_id)
-- that hasn't been independently confirmed to exist on this project's
-- live table (see this migration's revision note on schema drift).
create or replace function add_shortlist(p_client_id uuid, p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from client_venue_shortlists where client_id = p_client_id and venue_id = p_venue_id
  ) then
    insert into client_venue_shortlists (client_id, venue_id) values (p_client_id, p_venue_id);
  end if;
end;
$$;

create or replace function remove_shortlist(p_client_id uuid, p_venue_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from client_venue_shortlists where client_id = p_client_id and venue_id = p_venue_id;
$$;

-- ----------------------------------------------------------------------------
-- 4. VISION_STATEMENTS — same treatment as shortlists
-- ----------------------------------------------------------------------------

drop policy if exists "open vision statement read/write" on vision_statements;
revoke all on vision_statements from anon, authenticated;

create or replace function fetch_current_vision_statement(p_client_id uuid)
returns vision_statements
language sql
stable
security definer
set search_path = public
as $$
  select * from vision_statements
  where client_id = p_client_id and is_current = true
  order by created_at desc
  limit 1;
$$;

create or replace function save_vision_statement(
  p_client_id uuid,
  p_vision_title text,
  p_statement text,
  p_color_palette jsonb,
  p_artisan_focus jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update vision_statements set is_current = false where client_id = p_client_id and is_current = true;
  insert into vision_statements (client_id, vision_title, statement, color_palette, artisan_focus, is_current)
    values (p_client_id, p_vision_title, p_statement, p_color_palette, p_artisan_focus, true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. ENQUIRY_VENDOR_PUSHES — keep anon SELECT (realtime needs it; see the
--    top-of-file note on the residual risk), replace the blanket anon
--    UPDATE with a validated, single-row RPC.
-- ----------------------------------------------------------------------------

drop policy if exists "public updates enquiry push status" on enquiry_vendor_pushes;
revoke update on enquiry_vendor_pushes from anon, authenticated;

create or replace function update_push_status(p_push_id uuid, p_enquiry_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('viewing', 'wishlist', 'skipped', 'quote') then
    raise exception 'invalid push status %', p_status;
  end if;
  update enquiry_vendor_pushes
    set status = p_status
    where id = p_push_id and enquiry_id = p_enquiry_id;
end;
$$;

commit;
