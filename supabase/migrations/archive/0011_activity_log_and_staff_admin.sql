-- ============================================================================
-- 0011_activity_log_and_staff_admin.sql
--
-- Two things migration 0010 was missing:
--  1. Admins couldn't manage the `staff` table from RLS's point of view
--     beyond their own row (invite/deactivate needs this).
--  2. There was nowhere to persist "client history" — notes, status
--     changes, claims, pushes. This adds client_activity_log plus triggers
--     that write to it automatically so managers don't have to remember to.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Admins can manage any staff row (deactivate someone, fix a typo'd name).
--    Row creation itself happens via the invite endpoint using the service
--    role key (bypasses RLS entirely), so no INSERT policy is needed here.
-- ----------------------------------------------------------------------------
drop policy if exists "admin manages staff" on staff;
create policy "admin manages staff" on staff
  for update to authenticated
  using (is_admin())
  with check (is_admin());

-- ----------------------------------------------------------------------------
-- 2. CLIENT ACTIVITY LOG — the persisted "client history timeline"
-- ----------------------------------------------------------------------------
create table if not exists client_activity_log (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  actor_staff_id uuid references staff (id),
  type text not null, -- 'note' | 'status_change' | 'claim' | 'assignment' | 'push' | 'client_reaction'
  content text,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table client_activity_log enable row level security;

drop policy if exists "admin full access activity log" on client_activity_log;
create policy "admin full access activity log" on client_activity_log for all
  to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "manager reads activity on own enquiries" on client_activity_log;
create policy "manager reads activity on own enquiries" on client_activity_log
  for select to authenticated
  using (
    current_staff_role() = 'manager'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_manager_id = auth.uid())
  );

drop policy if exists "manager inserts notes on own enquiries" on client_activity_log;
create policy "manager inserts notes on own enquiries" on client_activity_log
  for insert to authenticated
  with check (
    current_staff_role() = 'manager'
    and type = 'note'
    and actor_staff_id = auth.uid()
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_manager_id = auth.uid())
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'client_activity_log'
  ) then
    alter publication supabase_realtime add table client_activity_log;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Auto-logging triggers/RPC updates
-- ----------------------------------------------------------------------------

-- New enquiry -> "Enquiry received" entry.
create or replace function log_enquiry_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into client_activity_log (enquiry_id, type, content)
  values (new.id, 'status_change', 'Enquiry received via ' || coalesce(new.source, 'unknown source'));
  return new;
end;
$$;

drop trigger if exists trg_log_enquiry_created on enquiries;
create trigger trg_log_enquiry_created
  after insert on enquiries
  for each row execute function log_enquiry_created();

-- Status or assignment change -> log entry with old -> new.
create or replace function log_enquiry_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into client_activity_log (enquiry_id, actor_staff_id, type, content, meta)
    values (new.id, auth.uid(), 'status_change', 'Status moved from ' || old.status || ' to ' || new.status,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assigned_manager_id is distinct from old.assigned_manager_id then
    insert into client_activity_log (enquiry_id, actor_staff_id, type, content, meta)
    values (
      new.id,
      auth.uid(),
      case when old.assigned_manager_id is null then 'claim' else 'assignment' end,
      case
        when old.assigned_manager_id is null then 'Lead claimed'
        else 'Lead reassigned'
      end,
      jsonb_build_object('manager_id', new.assigned_manager_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_enquiry_changes on enquiries;
create trigger trg_log_enquiry_changes
  after update on enquiries
  for each row execute function log_enquiry_changes();

-- Vendor push -> log entry (manager side of the push).
create or replace function log_vendor_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into client_activity_log (enquiry_id, actor_staff_id, type, content, meta)
  values (new.enquiry_id, auth.uid(), 'push', 'Pushed "' || new.vendor_label || '" to client',
          jsonb_build_object('push_id', new.id, 'vendor_ref_table', new.vendor_ref_table));
  return new;
end;
$$;

drop trigger if exists trg_log_vendor_push on enquiry_vendor_pushes;
create trigger trg_log_vendor_push
  after insert on enquiry_vendor_pushes
  for each row execute function log_vendor_push();

-- Client reacting to a push (wishlist/skip/quote) -> log entry, so a
-- manager sees the client's live reaction in the same timeline.
create or replace function log_push_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('wishlist', 'skipped', 'quote') then
    insert into client_activity_log (enquiry_id, type, content, meta)
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
