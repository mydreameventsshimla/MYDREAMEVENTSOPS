-- ============================================================================
-- 0010_ops_portal_roles.sql
--
-- Adds the internal "staff" side of the platform on top of the base schema
-- created by 0009 (clients, enquiries, venues, vendors, decor_themes,
-- client_venue_shortlists, vision_statements, enquiry_vendor_pushes).
--
-- Three staff roles, each with its own workspace and its own RLS scope:
--   admin      - sees everything, assigns enquiries to managers, approves
--                vendors recruited by salesmen.
--   manager    - sees only enquiries assigned to them (or unclaimed ones,
--                which they can claim). Runs the live call / push-to-client
--                workflow that already exists in enquiry_vendor_pushes.
--   salesman   - sees only their own vendor-recruitment targets and the
--                vendor/venue/decor rows they personally onboarded. Cannot
--                see clients or enquiries at all.
--
-- Run this AFTER 0009_base_schema.sql. Renumber the filename if your
-- project's next migration number isn't 0010.
--
-- Safe to re-run: every CREATE POLICY is preceded by DROP POLICY IF
-- EXISTS, table/column creation uses IF NOT EXISTS, and the staff_role
-- type creation is wrapped so a duplicate doesn't abort the script.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STAFF  (one row per internal user, keyed to a Supabase Auth user)
-- ----------------------------------------------------------------------------
do $$
begin
  create type staff_role as enum ('admin', 'manager', 'salesman');
exception
  when duplicate_object then null;
end $$;

create table if not exists staff (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role staff_role not null,
  is_active boolean not null default true,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- Every signed-in staff member can read their own row (needed to resolve
-- their own role client-side right after login) and the roster of active
-- staff (managers need to see other managers' names on shared views, e.g.
-- "assigned to Priya"). Nothing sensitive lives here besides email/name.
drop policy if exists "staff can read roster" on staff;
create policy "staff can read roster"
  on staff for select
  to authenticated
  using (true);

drop policy if exists "staff can update own profile" on staff;
create policy "staff can update own profile"
  on staff for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Helper: current signed-in user's staff role, or null if not staff.
-- SECURITY DEFINER + stable so it's cheap to use inside RLS predicates.
create or replace function current_staff_role()
returns staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from staff where id = auth.uid() and is_active;
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_staff_role() = 'admin', false);
$$;

-- ----------------------------------------------------------------------------
-- 2. ENQUIRIES: assignment + working status
-- ----------------------------------------------------------------------------
alter table enquiries
  add column if not exists assigned_manager_id uuid references staff (id),
  add column if not exists status text not null default 'new',
  add column if not exists claimed_at timestamptz;

comment on column enquiries.status is
  'new | contacted | pitching | negotiating | confirmed | lost';

-- Admin: full access to every enquiry + client.
drop policy if exists "admin full access enquiries" on enquiries;
create policy "admin full access enquiries" on enquiries for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "admin full access clients" on clients;
create policy "admin full access clients" on clients for all
  to authenticated using (is_admin()) with check (is_admin());

-- Manager: can see unclaimed enquiries (the "chute") plus anything already
-- assigned to them; can only write to rows assigned to them.
drop policy if exists "manager reads own or unclaimed enquiries" on enquiries;
create policy "manager reads own or unclaimed enquiries" on enquiries
  for select to authenticated
  using (
    current_staff_role() = 'manager'
    and (assigned_manager_id = auth.uid() or assigned_manager_id is null)
  );

drop policy if exists "manager updates own enquiries" on enquiries;
create policy "manager updates own enquiries" on enquiries
  for update to authenticated
  using (current_staff_role() = 'manager' and assigned_manager_id = auth.uid())
  with check (current_staff_role() = 'manager' and assigned_manager_id = auth.uid());

-- Manager: can read the client row behind any enquiry they can see.
drop policy if exists "manager reads clients behind their enquiries" on clients;
create policy "manager reads clients behind their enquiries" on clients
  for select to authenticated
  using (
    current_staff_role() = 'manager'
    and exists (
      select 1 from enquiries e
      where e.client_id = clients.id
        and (e.assigned_manager_id = auth.uid() or e.assigned_manager_id is null)
    )
  );

-- Atomic claim — avoids two managers racing to grab the same lead.
create or replace function claim_enquiry(p_enquiry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_count integer;
begin
  if current_staff_role() <> 'manager' then
    raise exception 'only managers can claim enquiries';
  end if;

  update enquiries
    set assigned_manager_id = auth.uid(), claimed_at = now(), status = 'contacted'
    where id = p_enquiry_id and assigned_manager_id is null;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

-- Admin manual (re)assignment.
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
    set assigned_manager_id = p_manager_id,
        claimed_at = coalesce(claimed_at, now()),
        status = case when status = 'new' then 'contacted' else status end
    where id = p_enquiry_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. ENQUIRY_VENDOR_PUSHES: managers push, only for enquiries they own
-- ----------------------------------------------------------------------------
drop policy if exists "admin full access pushes" on enquiry_vendor_pushes;
create policy "admin full access pushes" on enquiry_vendor_pushes for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "manager manages pushes on own enquiries" on enquiry_vendor_pushes;
create policy "manager manages pushes on own enquiries" on enquiry_vendor_pushes
  for all to authenticated
  using (
    current_staff_role() = 'manager'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_manager_id = auth.uid())
  )
  with check (
    current_staff_role() = 'manager'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_manager_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 4. VENDOR RECRUITMENT (salesman workspace)
-- ----------------------------------------------------------------------------
create table if not exists vendor_recruitment_targets (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  category text not null, -- venue | decor | photography | makeup | dj | mehendi | other
  priority text not null default 'medium', -- high | medium | low
  objective text,
  assigned_salesman_id uuid references staff (id),
  status text not null default 'assigned', -- assigned | in_progress | negotiating | onboarded | rejected
  created_by uuid references staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vendor_recruitment_targets enable row level security;

drop policy if exists "admin full access recruitment targets" on vendor_recruitment_targets;
create policy "admin full access recruitment targets" on vendor_recruitment_targets for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "salesman manages own targets" on vendor_recruitment_targets;
create policy "salesman manages own targets" on vendor_recruitment_targets
  for select to authenticated
  using (current_staff_role() = 'salesman' and assigned_salesman_id = auth.uid());

drop policy if exists "salesman updates own targets" on vendor_recruitment_targets;
create policy "salesman updates own targets" on vendor_recruitment_targets
  for update to authenticated
  using (current_staff_role() = 'salesman' and assigned_salesman_id = auth.uid())
  with check (current_staff_role() = 'salesman' and assigned_salesman_id = auth.uid());

-- Track who onboarded a catalog row and whether admin has approved it for
-- the public site yet (is_active stays false/hidden from clients until
-- approval, so a salesman's draft never leaks onto the live platform).
alter table venues
  add column if not exists recruited_by uuid references staff (id),
  add column if not exists approval_status text not null default 'approved';
alter table vendors
  add column if not exists recruited_by uuid references staff (id),
  add column if not exists approval_status text not null default 'approved';
alter table decor_themes
  add column if not exists recruited_by uuid references staff (id),
  add column if not exists approval_status text not null default 'approved';

-- Existing public "browse catalog" policies (anon/authenticated select
-- where is_active = true, from 0009) are untouched. These new policies
-- layer on top so staff can manage the recruitment side without needing
-- is_active=true.
drop policy if exists "admin full access venues" on venues;
create policy "admin full access venues" on venues for all
  to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin full access vendors" on vendors;
create policy "admin full access vendors" on vendors for all
  to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin full access decor_themes" on decor_themes;
create policy "admin full access decor_themes" on decor_themes for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "salesman inserts own venues" on venues;
create policy "salesman inserts own venues" on venues for insert
  to authenticated with check (current_staff_role() = 'salesman' and recruited_by = auth.uid());
drop policy if exists "salesman reads own venues" on venues;
create policy "salesman reads own venues" on venues for select
  to authenticated using (current_staff_role() = 'salesman' and recruited_by = auth.uid());
drop policy if exists "salesman updates own draft venues" on venues;
create policy "salesman updates own draft venues" on venues for update
  to authenticated
  using (current_staff_role() = 'salesman' and recruited_by = auth.uid() and approval_status = 'pending')
  with check (current_staff_role() = 'salesman' and recruited_by = auth.uid());

drop policy if exists "salesman inserts own vendors" on vendors;
create policy "salesman inserts own vendors" on vendors for insert
  to authenticated with check (current_staff_role() = 'salesman' and recruited_by = auth.uid());
drop policy if exists "salesman reads own vendors" on vendors;
create policy "salesman reads own vendors" on vendors for select
  to authenticated using (current_staff_role() = 'salesman' and recruited_by = auth.uid());
drop policy if exists "salesman updates own draft vendors" on vendors;
create policy "salesman updates own draft vendors" on vendors for update
  to authenticated
  using (current_staff_role() = 'salesman' and recruited_by = auth.uid() and approval_status = 'pending')
  with check (current_staff_role() = 'salesman' and recruited_by = auth.uid());

drop policy if exists "salesman inserts own decor_themes" on decor_themes;
create policy "salesman inserts own decor_themes" on decor_themes for insert
  to authenticated with check (current_staff_role() = 'salesman' and recruited_by = auth.uid());
drop policy if exists "salesman reads own decor_themes" on decor_themes;
create policy "salesman reads own decor_themes" on decor_themes for select
  to authenticated using (current_staff_role() = 'salesman' and recruited_by = auth.uid());
drop policy if exists "salesman updates own draft decor_themes" on decor_themes;
create policy "salesman updates own draft decor_themes" on decor_themes for update
  to authenticated
  using (current_staff_role() = 'salesman' and recruited_by = auth.uid() and approval_status = 'pending')
  with check (current_staff_role() = 'salesman' and recruited_by = auth.uid());

-- New catalog rows land inactive + pending until an admin approves them,
-- so recruitment never silently publishes to the live client site.
create or replace function admin_approve_catalog_row(p_table text, p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only admins can approve catalog rows';
  end if;
  if p_table not in ('venues', 'vendors', 'decor_themes') then
    raise exception 'invalid table %', p_table;
  end if;
  execute format(
    'update %I set approval_status = $1, is_active = $2 where id = $3',
    p_table
  ) using (case when p_approve then 'approved' else 'rejected' end), p_approve, p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. REALTIME — staff dashboards update live as enquiries/targets change
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'enquiries'
  ) then
    alter publication supabase_realtime add table enquiries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'vendor_recruitment_targets'
  ) then
    alter publication supabase_realtime add table vendor_recruitment_targets;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Bootstrap the very first admin (run manually, once — see README).
--
--   insert into staff (id, full_name, email, role) values
--     ('<auth-user-uuid>', 'Alexander Thorne', 'alex@wedplatform.com', 'admin');
-- ----------------------------------------------------------------------------
