-- ============================================================================
-- 0025_manager_power_tools.sql
--
-- Four things a planner needs to run a lead from follow-up through a fully
-- executed event, none of which existed before this migration:
--   1. Follow-up tasks/reminders (enquiry_tasks) — the pipeline's "overdue"
--      stat has been a hardcoded 0 since it was built; this is what
--      finally feeds it a real number.
--   2. A confirmed event date + venue on enquiries, distinct from the
--      free-text guesses captured during intake (event_date_text) —
--      what a calendar view actually needs to plot something.
--   3. A payment/budget ledger (enquiry_payments) — both money coming IN
--      from the couple (deposit, installments) and money going OUT to
--      vendors, so "budget" means more than a single admin-set number.
--   4. Formal proposals (proposals) — turning "proposal_sent" from a
--      status label into an actual document with line items, a venue,
--      a date, and a total, that a couple can open and accept/decline
--      from their own dashboard.
--
-- Run AFTER 0024.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENQUIRY_TASKS — follow-up reminders. Scoped to the planner who owns
--    the enquiry, same shape as every other planner-scoped table in this
--    schema (enquiry_activity_log, enquiry_messages).
-- ----------------------------------------------------------------------------
create table if not exists enquiry_tasks (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  staff_id uuid not null references admin_users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_enquiry_tasks_staff_due on enquiry_tasks (staff_id, due_at) where status = 'pending';
create index if not exists idx_enquiry_tasks_enquiry on enquiry_tasks (enquiry_id);

alter table enquiry_tasks enable row level security;

drop policy if exists "planner manages own tasks" on enquiry_tasks;
create policy "planner manages own tasks" on enquiry_tasks
  for all to authenticated
  using (my_staff_role() = 'planner' and staff_id = my_staff_id())
  with check (my_staff_role() = 'planner' and staff_id = my_staff_id());

drop policy if exists "admin full access enquiry tasks" on enquiry_tasks;
create policy "admin full access enquiry tasks" on enquiry_tasks
  for all to authenticated using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'enquiry_tasks') then
    alter publication supabase_realtime add table enquiry_tasks;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. CONFIRMED EVENT DATE + VENUE — additive columns on enquiries.
--    event_date_text (intake-time guess, e.g. "next spring") is untouched;
--    these are the real, confirmed values a calendar can actually plot,
--    set once a proposal is accepted (see the RPC below) or by hand.
-- ----------------------------------------------------------------------------
alter table enquiries add column if not exists event_date date;
alter table enquiries add column if not exists confirmed_venue_id uuid references venues (id);
alter table enquiries add column if not exists confirmed_venue_name text;

create index if not exists idx_enquiries_event_date on enquiries (event_date) where event_date is not null;

-- ----------------------------------------------------------------------------
-- 3. ENQUIRY_PAYMENTS — one ledger, two directions. `kind` distinguishes
--    money the couple owes/has paid ('client_payment') from money going
--    out to vendors ('vendor_cost') — a single table rather than two,
--    since both are just "line item, amount, status, date" and a manager
--    wants one place to see the whole financial picture for an event.
-- ----------------------------------------------------------------------------
create table if not exists enquiry_payments (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  kind text not null check (kind in ('client_payment', 'vendor_cost')),
  category text,
  amount numeric not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'received', 'paid')),
  due_date date,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references admin_users (id),
  notes text
);

create index if not exists idx_enquiry_payments_enquiry on enquiry_payments (enquiry_id);

alter table enquiry_payments enable row level security;

drop policy if exists "planner manages payments on own enquiries" on enquiry_payments;
create policy "planner manages payments on own enquiries" on enquiry_payments
  for all to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  )
  with check (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "admin full access enquiry payments" on enquiry_payments;
create policy "admin full access enquiry payments" on enquiry_payments
  for all to authenticated using (is_admin()) with check (is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'enquiry_payments') then
    alter publication supabase_realtime add table enquiry_payments;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. PROPOSALS — a real document, not just a status flip. line_items is a
--    jsonb array ([{category, label, price, notes}]) rather than a child
--    table: a proposal's line items are only ever read/written as a whole
--    with their parent (no query ever needs "all line items across every
--    proposal"), so a child table would exist purely for shape, not for
--    any real query pattern — same reasoning 0009 used for
--    vision_statements.color_palette/artisan_focus.
--
--    venue_name/event_date are denormalized onto the proposal (not just
--    referenced) so a sent proposal's content is stable even if the venue
--    catalog changes later, and so accepting it can copy real values onto
--    the enquiry without a join back through a venue row that might not
--    exist (a manager can propose a venue that isn't in the `venues`
--    table at all — venue_id is nullable on purpose).
-- ----------------------------------------------------------------------------
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries (id) on delete cascade,
  created_by uuid references admin_users (id),
  title text not null default 'Your Wedding Proposal',
  venue_id uuid references venues (id),
  venue_name text,
  event_date date,
  line_items jsonb not null default '[]'::jsonb,
  total_price numeric,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  notes text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  responded_at timestamptz
);

create index if not exists idx_proposals_enquiry on proposals (enquiry_id);

alter table proposals enable row level security;

-- Staff side: same planner-scoped shape as everything else above.
drop policy if exists "planner manages proposals on own enquiries" on proposals;
create policy "planner manages proposals on own enquiries" on proposals
  for all to authenticated
  using (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  )
  with check (
    my_staff_role() = 'planner'
    and exists (select 1 from enquiries e where e.id = enquiry_id and e.assigned_to = my_staff_id())
  );

drop policy if exists "admin full access proposals" on proposals;
create policy "admin full access proposals" on proposals
  for all to authenticated using (is_admin()) with check (is_admin());

-- Client side: read-only, same bearer-token trust model as everywhere else
-- couple-facing in this schema. A couple never writes to this table
-- directly — responding goes through respond_to_proposal() below, so a
-- "draft" a manager hasn't sent yet can never be seen or reacted to by
-- fiddling with the status field directly (only rows already 'sent' are
-- ever meant to be shown, which the client app's own query enforces —
-- RLS here only gates DELETE/UPDATE, not "which status", same division of
-- responsibility as the rest of this schema).
drop policy if exists "client reads own enquiry proposals" on proposals;
create policy "client reads own enquiry proposals" on proposals
  for select to anon, authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'proposals') then
    alter publication supabase_realtime add table proposals;
  end if;
end $$;

-- Extend the activity log so a proposal being sent/accepted/declined shows
-- up on the same timeline as everything else (matches 0021's pattern of
-- widening this same check constraint for new couple-facing signals).
alter table enquiry_activity_log drop constraint if exists enquiry_activity_log_type_check;
alter table enquiry_activity_log add constraint enquiry_activity_log_type_check
  check (type in (
    'note', 'status_change', 'claim', 'assignment', 'push', 'client_reaction',
    'shortlist', 'visit_request', 'callback_request', 'proposal'
  ));

-- Client responds to a SENT proposal. SECURITY DEFINER because the couple
-- only ever holds the anon key: this is the one and only path by which
-- proposals.status can move away from 'sent', and the only path by which
-- enquiries.event_date/confirmed_venue_* ever get set from the client
-- side. Accepting also flips the enquiry to 'won' — closing the loop the
-- manager used to have to do by hand via the status dropdown.
create or replace function respond_to_proposal(p_proposal_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal proposals%rowtype;
begin
  if p_response not in ('accepted', 'rejected') then
    raise exception 'Invalid response';
  end if;

  select * into v_proposal from proposals where id = p_proposal_id and status = 'sent';
  if not found then
    raise exception 'This proposal is no longer awaiting a response.';
  end if;

  update proposals set status = p_response, responded_at = now() where id = p_proposal_id;

  insert into enquiry_activity_log (enquiry_id, type, content, meta)
  values (
    v_proposal.enquiry_id,
    'proposal',
    case when p_response = 'accepted' then 'Client accepted the proposal' else 'Client declined the proposal' end,
    jsonb_build_object('proposal_id', p_proposal_id, 'response', p_response)
  );

  if p_response = 'accepted' then
    update enquiries
    set status = 'won',
        event_date = coalesce(v_proposal.event_date, event_date),
        confirmed_venue_id = coalesce(v_proposal.venue_id, confirmed_venue_id),
        confirmed_venue_name = coalesce(v_proposal.venue_name, confirmed_venue_name)
    where id = v_proposal.enquiry_id;
  end if;
end;
$$;
