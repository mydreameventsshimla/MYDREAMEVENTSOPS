-- ============================================================================
-- 0019_planner_contact.sql
--
-- Lets a couple reach their assigned planner directly from the client app:
-- a WhatsApp chat link, a Google Meet link, and the plain phone number. Run
-- AFTER 0018. Additive only.
--
-- WHY TWO NEW COLUMNS ON admin_users, NOT A NEW TABLE:
--
--   Every planner has at most one WhatsApp number and one standing Meet
--   room -- this is staff contact info, the same shape and lifecycle as
--   `full_name`/`email` already on the row. A join table would exist only
--   to hold a 1:1 relationship no other query ever needs to traverse.
--
-- WHY A NEW RPC RATHER THAN A DIRECT admin_users GRANT:
--
--   `admin_users` has exactly one read policy -- "staff can read roster",
--   gated on `is_staff()` -- because it is the staff directory: every
--   planner's name and email, visible to every other staff member. A couple
--   is never staff, so today they cannot read a single row of it, which is
--   correct. Opening a second policy on the table for anon/authenticated
--   would need to reimplement that same "only your own assigned planner,
--   only the three contact fields, nothing else on the row" scoping as a
--   policy predicate; an RPC says it once, directly, and returns nothing
--   else no matter what a caller passes in.
--
--   Scoped by `enquiry_id`, matching every other couple-facing RPC in this
--   schema (`fetch_my_guest_admin_token`, `add_guest`, ...) rather than
--   `client_id`: a client can end up with more than one enquiry (a second
--   venue search with a different budget or date range is a second
--   enquiry, not a second client), and each enquiry carries its own
--   `assigned_to`. Scoping here by enquiry rather than client means a
--   future second enquiry for the same couple already resolves to the
--   right planner with no rework -- the FK this reads (`assigned_to`) is
--   already per-enquiry today.
-- ============================================================================

alter table admin_users add column if not exists whatsapp_number text;
alter table admin_users add column if not exists meet_link text;

-- Loose on purpose: real WhatsApp numbers are entered by hand by an admin
-- across several countries' dialing conventions, and rejecting a valid one
-- over formatting is worse than accepting a slightly odd one. This only
-- catches obvious garbage (letters, an empty string that isn't null).
alter table admin_users drop constraint if exists admin_users_whatsapp_shape;
alter table admin_users add constraint admin_users_whatsapp_shape
  check (whatsapp_number is null or whatsapp_number ~ '^\+?[0-9 ()-]{7,20}$');

-- Required to start with https:// -- this value is later handed straight to
-- `window.open()`/rendered as a link href in the client app. Without this,
-- a `javascript:` or other non-http scheme typed into the field (by
-- mistake or otherwise) would execute in a couple's browser session the
-- moment they clicked "Video call".
alter table admin_users drop constraint if exists admin_users_meet_link_shape;
alter table admin_users add constraint admin_users_meet_link_shape
  check (meet_link is null or meet_link like 'https://%');

-- Single-row lookup: this enquiry's assigned planner's contact fields, or no
-- rows at all if the enquiry has no planner assigned yet (a fresh, unclaimed
-- lead) or the assigned staff member has since been deactivated -- both
-- states the client app renders as "a planner will be with you shortly"
-- rather than a broken chat button pointed at someone no longer working
-- here.
create or replace function fetch_my_planner(p_enquiry_id uuid)
returns table (
  full_name text,
  email text,
  whatsapp_number text,
  meet_link text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.full_name, a.email, a.whatsapp_number, a.meet_link
  from enquiries e
  join admin_users a on a.id = e.assigned_to
  where e.id = p_enquiry_id and a.is_active;
$$;
