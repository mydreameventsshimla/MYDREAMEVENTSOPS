-- ============================================================================
-- 0024_planner_chat.sql
--
-- In-app text chat between a couple and their assigned planner. Run AFTER
-- 0023 (minimalist-muse's push_subscriptions migration — independent of
-- this one, but keeping migration numbers in one sequence across both apps
-- avoids two "0023"s existing in the wild).
--
-- Video calling is NOT part of this migration — that already shipped in
-- 0019 (admin_users.meet_link + fetch_my_planner()) and has worked in the
-- client app since. The one thing 0019/0020 left unfinished is what this
-- migration's first half fixes: there was no way for a planner to ever SET
-- meet_link themselves, only whatsapp_number.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LET A PLANNER SET THEIR OWN MEET LINK
--
--    0020's self-update guard explicitly snapped meet_link back to its old
--    value on every self-service write, alongside genuinely privilege-
--    bearing columns (role, is_active). meet_link isn't privilege-bearing —
--    it's contact info with the same shape and stakes as whatsapp_number,
--    which the same trigger already allows. That was conservative-by-
--    default rather than a deliberate restriction, and the practical effect
--    was that meet_link could only ever be set by hand in the SQL editor,
--    for every planner, forever. Widening the trigger to also pass through
--    meet_link is the actual fix; the https:// check constraint from 0019
--    still guards against anything unsafe landing in it.
-- ----------------------------------------------------------------------------
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

  -- Self-service: only full_name, whatsapp_number, and meet_link may move.
  -- Everything else -- role, is_active, email, auth_user_id -- snaps back
  -- to its prior value regardless of what the request body contained.
  new.email := old.email;
  new.role := old.role;
  new.is_active := old.is_active;
  new.auth_user_id := old.auth_user_id;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. ENQUIRY_MESSAGES — the chat thread itself.
--
--    sender_name is denormalized onto the row (captured at insert time),
--    same call as enquiry_vendor_pushes.vendor_label in 0009: the anon key
--    that renders this thread in the client app cannot join into
--    admin_users (that table's only anon-visible surface is the narrow
--    fetch_my_planner() RPC), so the planner's display name has to travel
--    with the message rather than be looked up per-render.
-- ----------------------------------------------------------------------------
create table if not exists enquiry_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  sender text not null check (sender in ('client', 'staff')),
  sender_name text not null,
  staff_id uuid references admin_users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists idx_enquiry_messages_enquiry_id on enquiry_messages (enquiry_id, created_at);

alter table enquiry_messages enable row level security;

-- Client side: same bearer-token trust model as every other couple-facing
-- table in this schema (enquiry_id is the credential, not a secret) — see
-- 0014's write-up. A client can read the whole thread and post as
-- themselves, never as 'staff'.
drop policy if exists "client reads own enquiry messages" on enquiry_messages;
create policy "client reads own enquiry messages" on enquiry_messages
  for select to anon, authenticated using (true);

drop policy if exists "client sends messages on own enquiry" on enquiry_messages;
create policy "client sends messages on own enquiry" on enquiry_messages
  for insert to anon, authenticated
  with check (sender = 'client' and staff_id is null);

-- Staff side: matches enquiry_activity_log's existing planner-scoped
-- policies exactly (0012) — a planner only ever touches messages on
-- enquiries assigned to them; an admin can see everything.
drop policy if exists "planner reads messages on own enquiries" on enquiry_messages;
create policy "planner reads messages on own enquiries" on enquiry_messages
  for select to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "planner sends messages on own enquiries" on enquiry_messages;
create policy "planner sends messages on own enquiries" on enquiry_messages
  for insert to authenticated
  with check (
    my_staff_role() = 'planner' and sender = 'staff' and staff_id = my_staff_id()
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "admin full access enquiry messages" on enquiry_messages;
create policy "admin full access enquiry messages" on enquiry_messages
  for all to authenticated using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'enquiry_messages'
  ) then
    alter publication supabase_realtime add table enquiry_messages;
  end if;
end $$;
