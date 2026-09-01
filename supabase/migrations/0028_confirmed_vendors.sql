-- ============================================================================
-- 0028_confirmed_vendors.sql
--
-- enquiry_vendor_pushes (0009) tracks "suggested to the client" —
-- pushed/viewing/wishlist/skipped/quote — a discovery mechanism, not a
-- booking one. Nothing anywhere records which vendor is ACTUALLY locked in
-- for the wedding: no contact person, no agreed price, no confirmation
-- status. A manager wishlisting a caterer and a manager having signed a
-- contract with one look identical in the data today. This migration adds
-- that missing "confirmed & booked" state.
--
-- confirmed_vendors is deliberately NOT restricted to the vendor catalog
-- (vendors/venues/decor_themes) — catalog_ref_table/catalog_ref_id are
-- nullable — because a couple can (and often does) book someone outside
-- our curated catalog entirely; forcing every booking through a catalog
-- row would make this unusable for exactly the bookings a manager most
-- needs to track. function_id optionally ties a vendor to a specific
-- event_function (0026) — a caterer might only be booked for the
-- Reception, not the Mehendi.
--
-- Manager-only, like guest_accommodations (0027) — no client-facing
-- policy. This closes the MANAGER's coordination gap; a couple already
-- knows who they've booked.
--
-- Run AFTER 0027.
-- ============================================================================

create table if not exists confirmed_vendors (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  function_id uuid references event_functions (id) on delete set null,
  category text not null,
  vendor_name text not null check (char_length(vendor_name) between 1 and 200),
  contact_person text,
  contact_phone text,
  contact_email text,
  agreed_price numeric,
  status text not null default 'confirmed' check (status in ('contract_pending', 'confirmed', 'deposit_paid', 'cancelled')),
  catalog_ref_table text check (catalog_ref_table in ('vendors', 'venues', 'decor_themes')),
  catalog_ref_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_confirmed_vendors_enquiry on confirmed_vendors (enquiry_id);

alter table confirmed_vendors enable row level security;

drop policy if exists "planner manages confirmed vendors on own enquiries" on confirmed_vendors;
create policy "planner manages confirmed vendors on own enquiries" on confirmed_vendors
  for all to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  )
  with check (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "admin full access confirmed vendors" on confirmed_vendors;
create policy "admin full access confirmed vendors" on confirmed_vendors
  for all to authenticated using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'confirmed_vendors') then
    alter publication supabase_realtime add table confirmed_vendors;
  end if;
end $$;
