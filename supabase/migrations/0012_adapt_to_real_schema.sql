-- ============================================================================
-- 0012_adapt_to_real_schema.sql
--
-- SUPERSEDES 0010/0011 for this project. Your real database already has a
-- mature schema those two files knew nothing about: `admin_users` (role
-- checked against 'admin' | 'planner' | 'sales'), `enquiries.assigned_to` +
-- `enquiry_status_history`, and `vendor_applications` + the onboarding
-- promotion functions. This migration builds ops-portal on TOP of that
-- real schema instead of creating a competing parallel one.
--
-- Do NOT run 0010/0011 against this project — run this file instead, once,
-- after 0009 is not needed here either (your base schema already exists).
-- Safe to re-run if it fails partway through.
--
-- ----------------------------------------------------------------------------
-- SECURITY FIX (confirmed with the project owner before writing this):
--   1. is_admin() previously returned true for ANY row in admin_users,
--      regardless of role — meaning a future 'planner' or 'sales' user
--      would have silently inherited full admin access. Now checks
--      role = 'admin' specifically.
--   2. "Authenticated staff can read all clients" and "...update enquiry
--      status" were written as `using (true)` for role `authenticated` —
--      i.e. any signed-in person, including a bride signed into the
--      client site, could read every client's PII and edit any enquiry's
--      status. Both are replaced with role-scoped policies below.
-- Only 'admin' rows exist in admin_users today, so nothing that currently
-- has access loses it — this closes a gap that hadn't been hit yet.
-- ----------------------------------------------------------------------------
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. admin_users: add is_active FIRST — the role-helper functions below
--    reference it immediately, so this has to exist before they're created.
-- ----------------------------------------------------------------------------
alter table admin_users add column if not exists is_active boolean not null default true;

-- ----------------------------------------------------------------------------
-- 1. ROLE HELPERS
-- ----------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_users where auth_user_id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admin_users where auth_user_id = auth.uid() and is_active);
$$;

-- 'admin' | 'planner' | 'sales', or null if not staff / deactivated.
create or replace function my_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from admin_users where auth_user_id = auth.uid() and is_active;
$$;

-- This person's admin_users.id (the FK target used by enquiries.assigned_to,
-- enquiry_status_history.changed_by, vendor_applications.submitted_by,
-- etc — NOT the same as auth.uid()).
create or replace function my_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from admin_users where auth_user_id = auth.uid() and is_active;
$$;

-- ----------------------------------------------------------------------------
-- 2. admin_users RLS
-- ----------------------------------------------------------------------------
drop policy if exists "Admins can view admin_users" on admin_users;
drop policy if exists "staff can read roster" on admin_users;
create policy "staff can read roster" on admin_users
  for select to authenticated using (is_staff());

drop policy if exists "admin manages admin_users" on admin_users;
create policy "admin manages admin_users" on admin_users
  for all to authenticated using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 3. THE RLS FIX — replace the two over-broad "authenticated" policies with
--    proper role-scoped ones. Planners (managers) see enquiries/clients
--    assigned to them or unclaimed; sales agents see neither table at all;
--    admins keep full access via the existing is_admin()-gated policies.
-- ----------------------------------------------------------------------------
drop policy if exists "Authenticated staff can read all clients" on clients;
drop policy if exists "Authenticated staff can read all enquiries" on enquiries;
drop policy if exists "Authenticated staff can update enquiry status" on enquiries;

alter table enquiries add column if not exists claimed_at timestamptz;

drop policy if exists "planner reads own or unclaimed enquiries" on enquiries;
create policy "planner reads own or unclaimed enquiries" on enquiries
  for select to authenticated
  using (my_staff_role() = 'planner' and (assigned_to = my_staff_id() or assigned_to is null));

drop policy if exists "planner updates own enquiries" on enquiries;
create policy "planner updates own enquiries" on enquiries
  for update to authenticated
  using (my_staff_role() = 'planner' and assigned_to = my_staff_id())
  with check (my_staff_role() = 'planner' and assigned_to = my_staff_id());

drop policy if exists "planner reads clients behind their enquiries" on clients;
create policy "planner reads clients behind their enquiries" on clients
  for select to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (
      select 1 from enquiries e
      where e.client_id = clients.id and (e.assigned_to = my_staff_id() or e.assigned_to is null)
    )
  );

-- Atomic claim (avoids two planners racing for the same lead).
create or replace function claim_enquiry(p_enquiry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_count integer;
  v_my_id uuid;
begin
  if my_staff_role() <> 'planner' then
    raise exception 'only planners (managers) can claim enquiries';
  end if;
  v_my_id := my_staff_id();

  update enquiries
    set assigned_to = v_my_id, claimed_at = now(), status = 'contacted'
    where id = p_enquiry_id and assigned_to is null;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

create or replace function admin_assign_enquiry(p_enquiry_id uuid, p_manager_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only admins can reassign enquiries';
  end if;
  update enquiries
    set assigned_to = p_manager_id,
        claimed_at = coalesce(claimed_at, now()),
        status = case when status = 'new' then 'contacted' else status end
    where id = p_enquiry_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. ENQUIRY VENDOR PUSHES — genuinely missing from your live database (your
--    client app's own lib/api.ts already calls fetchMyPushes/markPushViewing/
--    subscribeToMyPushes against a table named exactly this that doesn't
--    exist yet, so that feature is currently broken on the client site too,
--    not just ops-portal). Creating this fixes both.
-- ----------------------------------------------------------------------------
create table if not exists enquiry_vendor_pushes (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  vendor_ref_table text not null check (vendor_ref_table in ('vendors', 'venues', 'decor_themes')),
  vendor_ref_id uuid not null,
  vendor_label text not null,
  status text not null default 'pushed' check (status in ('pushed', 'viewing', 'wishlist', 'skipped', 'quote')),
  created_at timestamptz not null default now()
);

create index if not exists idx_enquiry_vendor_pushes_enquiry_id on enquiry_vendor_pushes (enquiry_id);

alter table enquiry_vendor_pushes enable row level security;

drop policy if exists "admin full access pushes" on enquiry_vendor_pushes;
create policy "admin full access pushes" on enquiry_vendor_pushes for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "planner manages pushes on own enquiries" on enquiry_vendor_pushes;
create policy "planner manages pushes on own enquiries" on enquiry_vendor_pushes
  for all to authenticated
  using (my_staff_role() = 'planner' and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id()))
  with check (my_staff_role() = 'planner' and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id()));

-- Client-side read/react, same open "the enquiry_id is a bearer token"
-- model your existing schema already uses everywhere else (e.g. "Public
-- can update own client row on upsert").
drop policy if exists "public reads enquiry pushes" on enquiry_vendor_pushes;
create policy "public reads enquiry pushes" on enquiry_vendor_pushes
  for select to anon, authenticated using (true);

drop policy if exists "public updates enquiry push status" on enquiry_vendor_pushes;
create policy "public updates enquiry push status" on enquiry_vendor_pushes
  for update to anon, authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 5. VENDOR RECRUITMENT TARGETS — admin assigns "go find this vendor" work
--    to a sales agent. Complementary to (not a replacement for) your
--    existing vendor_applications: a target is outbound ("please recruit
--    X"), an application is the eventual inbound record once the agent
--    succeeds (submitted via the existing submit_vendor_application()).
-- ----------------------------------------------------------------------------
create table if not exists vendor_recruitment_targets (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  category text not null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  objective text,
  assigned_salesman_id uuid references admin_users (id),
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'negotiating', 'onboarded', 'rejected')),
  created_by uuid references admin_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vendor_recruitment_targets enable row level security;

drop policy if exists "admin full access recruitment targets" on vendor_recruitment_targets;
create policy "admin full access recruitment targets" on vendor_recruitment_targets for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "sales reads own targets" on vendor_recruitment_targets;
create policy "sales reads own targets" on vendor_recruitment_targets
  for select to authenticated using (my_staff_role() = 'sales' and assigned_salesman_id = my_staff_id());

drop policy if exists "sales updates own targets" on vendor_recruitment_targets;
create policy "sales updates own targets" on vendor_recruitment_targets
  for update to authenticated
  using (my_staff_role() = 'sales' and assigned_salesman_id = my_staff_id())
  with check (my_staff_role() = 'sales' and assigned_salesman_id = my_staff_id());

-- ----------------------------------------------------------------------------
-- 6. vendor_applications: track which sales agent submitted an application
--    (your existing table has no such column — applications are currently
--    anonymous). Additive only; existing public self-submission flow is
--    untouched.
-- ----------------------------------------------------------------------------
alter table vendor_applications add column if not exists submitted_by uuid references admin_users (id);

drop policy if exists "sales reads own submitted applications" on vendor_applications;
create policy "sales reads own submitted applications" on vendor_applications
  for select to authenticated using (my_staff_role() = 'sales' and submitted_by = my_staff_id());

-- ----------------------------------------------------------------------------
-- 7. ENQUIRY ACTIVITY LOG — the persisted "client history" timeline.
--    Complements (doesn't replace) your existing enquiry_status_history:
--    status transitions are written to BOTH (so any existing reporting
--    against enquiry_status_history keeps working), while this table also
--    carries free-text notes, vendor pushes, and client reactions that
--    enquiry_status_history's schema (old_status/new_status required)
--    can't represent.
-- ----------------------------------------------------------------------------
create table if not exists enquiry_activity_log (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  staff_id uuid references admin_users (id),
  type text not null check (type in ('note', 'status_change', 'claim', 'assignment', 'push', 'client_reaction')),
  content text,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table enquiry_activity_log enable row level security;

drop policy if exists "admin full access enquiry activity log" on enquiry_activity_log;
create policy "admin full access enquiry activity log" on enquiry_activity_log for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "planner reads activity on own enquiries" on enquiry_activity_log;
create policy "planner reads activity on own enquiries" on enquiry_activity_log
  for select to authenticated
  using (my_staff_role() = 'planner' and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id()));

drop policy if exists "planner inserts notes on own enquiries" on enquiry_activity_log;
create policy "planner inserts notes on own enquiries" on enquiry_activity_log
  for insert to authenticated
  with check (
    my_staff_role() = 'planner' and type = 'note' and staff_id = my_staff_id()
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

-- ----------------------------------------------------------------------------
-- 8. Auto-logging triggers
-- ----------------------------------------------------------------------------
create or replace function log_enquiry_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into enquiry_status_history (enquiry_id, changed_by, old_status, new_status, note)
    values (new.id, my_staff_id(), null, new.status, 'Enquiry received via ' || coalesce(new.source, 'unknown source'));
  insert into enquiry_activity_log (enquiry_id, type, content)
    values (new.id, 'status_change', 'Enquiry received via ' || coalesce(new.source, 'unknown source'));
  return new;
end;
$$;

drop trigger if exists trg_log_enquiry_created on enquiries;
create trigger trg_log_enquiry_created
  after insert on enquiries
  for each row execute function log_enquiry_created();

create or replace function log_enquiry_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := my_staff_id();
begin
  if new.status is distinct from old.status then
    insert into enquiry_status_history (enquiry_id, changed_by, old_status, new_status)
      values (new.id, v_actor, old.status, new.status);
    insert into enquiry_activity_log (enquiry_id, staff_id, type, content, meta)
      values (new.id, v_actor, 'status_change', 'Status moved from ' || old.status || ' to ' || new.status,
              jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into enquiry_activity_log (enquiry_id, staff_id, type, content, meta)
      values (
        new.id, v_actor,
        case when old.assigned_to is null then 'claim' else 'assignment' end,
        case when old.assigned_to is null then 'Lead claimed' else 'Lead reassigned' end,
        jsonb_build_object('assigned_to', new.assigned_to)
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_enquiry_changes on enquiries;
create trigger trg_log_enquiry_changes
  after update on enquiries
  for each row execute function log_enquiry_changes();

create or replace function log_vendor_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into enquiry_activity_log (enquiry_id, staff_id, type, content, meta)
    values (new.enquiry_id, my_staff_id(), 'push', 'Pushed "' || new.vendor_label || '" to client',
            jsonb_build_object('push_id', new.id, 'vendor_ref_table', new.vendor_ref_table));
  return new;
end;
$$;

drop trigger if exists trg_log_vendor_push on enquiry_vendor_pushes;
create trigger trg_log_vendor_push
  after insert on enquiry_vendor_pushes
  for each row execute function log_vendor_push();

create or replace function log_push_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('wishlist', 'skipped', 'quote') then
    insert into enquiry_activity_log (enquiry_id, type, content, meta)
      values (new.enquiry_id, 'client_reaction', 'Client marked "' || new.vendor_label || '" as ' || new.status,
              jsonb_build_object('push_id', new.id, 'status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_push_reaction on enquiry_vendor_pushes;
create trigger trg_log_push_reaction
  after update on enquiry_vendor_pushes
  for each row execute function log_push_reaction();

-- ----------------------------------------------------------------------------
-- 9. REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'enquiries') then
    alter publication supabase_realtime add table enquiries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'enquiry_vendor_pushes') then
    alter publication supabase_realtime add table enquiry_vendor_pushes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'vendor_recruitment_targets') then
    alter publication supabase_realtime add table vendor_recruitment_targets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'enquiry_activity_log') then
    alter publication supabase_realtime add table enquiry_activity_log;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'vendor_applications') then
    alter publication supabase_realtime add table vendor_applications;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 10. Bootstrap check — you already have an admin (your own account, since
--     you're the one running this). No manual insert needed here unlike
--     the old 0010: your existing admin_users row already has role='admin'.
--     Every manager ('planner') and sales agent from here on is added
--     through the ops-portal's Team & Invites tab.
-- ----------------------------------------------------------------------------
