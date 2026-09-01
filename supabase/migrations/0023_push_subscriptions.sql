-- ============================================================================
-- 0023_push_subscriptions.sql
--
-- Storage for Web Push subscriptions, so a signed-in couple can be notified
-- ("push notifications like a real app") even when the site/app isn't open.
-- Run AFTER 0022.
--
-- Client flow: minimalist-muse calls Notification.requestPermission(), then
-- PushManager.subscribe() with the VAPID public key, and upserts the
-- resulting subscription (endpoint + keys) into this table directly via
-- supabase-js — same "client_id is a bearer token for the browser's own
-- rows" trust model as client_venue_shortlists/vision_statements (0009).
--
-- Server flow: sending a push is a service-role operation (ops-portal or a
-- Vercel function using the `web-push` package with the VAPID private key),
-- which bypasses RLS entirely — so the policies below only ever need to
-- cover what the COUPLE'S OWN BROWSER does: subscribe and unsubscribe.
-- Nothing client-side ever needs to read this table back (a subscription
-- object is write-once, useless to re-read), so unlike the fully-open
-- tables elsewhere in this schema, there is deliberately no SELECT policy
-- for anon/authenticated here — the sender is always the service role.
-- ============================================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (client_id, endpoint)
);

create index if not exists idx_push_subscriptions_client_id on push_subscriptions (client_id);

alter table push_subscriptions enable row level security;

-- A browser subscribing (or re-subscribing, e.g. after the push service
-- rotates the endpoint) upserts its own row.
drop policy if exists "client can subscribe own device" on push_subscriptions;
create policy "client can subscribe own device" on push_subscriptions
  for insert to anon, authenticated
  with check (true);

-- Needed for the upsert above to update-in-place on the (client_id,
-- endpoint) unique key instead of erroring, and for explicit unsubscribe.
drop policy if exists "client can update own subscription" on push_subscriptions;
create policy "client can update own subscription" on push_subscriptions
  for update to anon, authenticated
  using (true) with check (true);

drop policy if exists "client can remove own subscription" on push_subscriptions;
create policy "client can remove own subscription" on push_subscriptions
  for delete to anon, authenticated
  using (true);
