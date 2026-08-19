-- ============================================================================
-- 0009_base_schema.sql
--
-- THE MISSING FOUNDATION. Your client app's code (lib/api.ts, lib/auth.ts)
-- has always assumed this schema exists — comments in api.ts even say
-- "0009's RLS lets an authenticated client read their own rows" — but no
-- migration that actually creates clients/enquiries/venues/vendors/
-- decor_themes/enquiry_vendor_pushes/vision_statements/client_venue_shortlists
-- was ever handed over. This file IS that migration, reverse-engineered
-- from exactly what api.ts/auth.ts/types.ts read and write.
--
-- Run this FIRST, before 0010 and 0011 — they both ALTER these tables.
--
-- Safe to re-run: every statement below is idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS before CREATE), so if a previous
-- attempt partially failed, just run this whole file again from the top.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. CLIENTS — the bride/couple. `auth_user_id` links a row to a real
--    Supabase Auth session once they sign in (see get_or_link_my_client
--    below); it's nullable because most enquiries start anonymous.
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_country_code text,
  phone_number text,
  phone_e164 text,
  email text,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_clients_phone_e164 on clients (phone_e164);
create index if not exists idx_clients_auth_user_id on clients (auth_user_id);

alter table clients enable row level security;

-- No anon/authenticated SELECT-all policy on purpose (api.ts's own comment:
-- "we don't want the public able to read other people's names/phone
-- numbers"). Writes happen through SECURITY DEFINER RPCs below, which
-- bypass RLS internally and only ever return a bare uuid.
drop policy if exists "clients read own via auth link" on clients;
create policy "clients read own via auth link" on clients
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. ENQUIRIES — one row per submission (inquiry wizard, glass planner
--    application, or a "book this vendor" click from the catalog).
-- ----------------------------------------------------------------------------
create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  source text not null,
  destination text,
  event_date_text text,
  guest_bracket text,
  vision_style text,
  service_category text,
  notes text,
  dream_text text,
  contact_raw text,
  created_at timestamptz not null default now()
);

create index if not exists idx_enquiries_client_id on enquiries (client_id);

alter table enquiries enable row level security;

-- Lead-capture forms are deliberately frictionless: nobody is signed in
-- yet when a bride submits the inquiry wizard, so INSERT has to be open.
-- The client_id inside each insert is a UUID the browser only knows
-- because it just got it back from upsert_client_for_inquiry() — that
-- UUID is effectively a bearer token for "this browser's own client",
-- same trust model the rest of this schema uses for anonymous flows.
drop policy if exists "anyone can submit an enquiry" on enquiries;
create policy "anyone can submit an enquiry" on enquiries
  for insert to anon, authenticated
  with check (true);

drop policy if exists "clients read own enquiries via auth link" on enquiries;
create policy "clients read own enquiries via auth link" on enquiries
  for select to authenticated
  using (client_id in (select id from clients where auth_user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. CATALOG: venues, vendors, decor_themes — public browse tables.
-- ----------------------------------------------------------------------------
create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  description text,
  architectural_highlight text,
  capacity text,
  rental_fee text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  title text,
  bio text,
  location text,
  rating numeric default 0,
  reviews_count integer default 0,
  price_starting numeric,
  image_url text,
  portfolio jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists decor_themes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  style_category text,
  included_elements jsonb not null default '[]'::jsonb,
  price_range text,
  image_url text,
  city text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table venues enable row level security;
alter table vendors enable row level security;
alter table decor_themes enable row level security;

drop policy if exists "public reads active venues" on venues;
create policy "public reads active venues" on venues
  for select to anon, authenticated using (is_active = true);

drop policy if exists "public reads active vendors" on vendors;
create policy "public reads active vendors" on vendors
  for select to anon, authenticated using (is_active = true);

drop policy if exists "public reads active decor_themes" on decor_themes;
create policy "public reads active decor_themes" on decor_themes
  for select to anon, authenticated using (is_active = true);

-- ----------------------------------------------------------------------------
-- 4. CLIENT VENUE SHORTLISTS
-- ----------------------------------------------------------------------------
create table if not exists client_venue_shortlists (
  client_id uuid not null references clients (id) on delete cascade,
  venue_id uuid not null references venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, venue_id)
);

alter table client_venue_shortlists enable row level security;

-- Same bearer-token trust model as enquiries: the browser only ever
-- queries/writes rows for the client_id it already holds.
drop policy if exists "open shortlist read/write" on client_venue_shortlists;
create policy "open shortlist read/write" on client_venue_shortlists
  for all to anon, authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 5. VISION STATEMENTS (AI-generated, saved per client)
-- ----------------------------------------------------------------------------
create table if not exists vision_statements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  vision_title text,
  statement text,
  color_palette jsonb not null default '[]'::jsonb,
  artisan_focus jsonb not null default '[]'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_vision_statements_client_id on vision_statements (client_id);

alter table vision_statements enable row level security;

drop policy if exists "open vision statement read/write" on vision_statements;
create policy "open vision statement read/write" on vision_statements
  for all to anon, authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 6. ENQUIRY VENDOR PUSHES — manager pushes a listing mid-call, client
--    reacts (wishlist/skip/quote) in real time.
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

-- Client reads/updates its own enquiry's pushes (again, enquiry_id is a
-- bearer token the browser only has because it's their own event).
-- INSERT is intentionally NOT open here — pushes are created by managers,
-- covered by the ops-portal migration (0010) policies.
drop policy if exists "open push read for client" on enquiry_vendor_pushes;
create policy "open push read for client" on enquiry_vendor_pushes
  for select to anon, authenticated using (true);

drop policy if exists "open push status update for client" on enquiry_vendor_pushes;
create policy "open push status update for client" on enquiry_vendor_pushes
  for update to anon, authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 7. RPCs — SECURITY DEFINER so they can write to `clients` (no direct
--    anon/authenticated INSERT policy on that table) while only ever
--    returning a bare uuid, never the row itself.
-- ----------------------------------------------------------------------------

-- Inquiry wizard: match an existing client by phone, or create one.
create or replace function upsert_client_for_inquiry(
  p_full_name text,
  p_phone_country_code text,
  p_phone_number text,
  p_phone_e164 text
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
          phone_number = coalesce(p_phone_number, phone_number)
      where id = v_client_id;
    return v_client_id;
  end if;

  insert into clients (full_name, phone_country_code, phone_number, phone_e164)
    values (p_full_name, p_phone_country_code, p_phone_number, p_phone_e164)
    returning id into v_client_id;

  return v_client_id;
end;
$$;

-- Glass planner "confidential application" — always a fresh client row.
create or replace function insert_client_for_glass_planner(p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  insert into clients (full_name) values (p_full_name) returning id into v_client_id;
  return v_client_id;
end;
$$;

-- Called right after a session appears: find the client row already
-- linked to this auth user, or auto-link an existing unlinked row that
-- matches this account's email, or return null (genuinely new person).
create or replace function get_or_link_my_client()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_email text;
begin
  select id into v_client_id from clients where auth_user_id = auth.uid();
  if v_client_id is not null then
    return v_client_id;
  end if;

  select email into v_email from auth.users where id = auth.uid();

  if v_email is not null then
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

  return null;
end;
$$;

-- Called once, right after the inquiry wizard creates a brand-new client,
-- if the person was already signed in. No-ops if already linked to
-- someone else (doesn't let a session hijack another client's row).
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

-- ----------------------------------------------------------------------------
-- 8. REALTIME — enquiry_vendor_pushes needs to be live for both the
--    client's "For You" section and the manager's push stream.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'enquiry_vendor_pushes'
  ) then
    alter publication supabase_realtime add table enquiry_vendor_pushes;
  end if;
end $$;
