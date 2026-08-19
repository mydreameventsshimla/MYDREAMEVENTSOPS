<div align="center">

# MyDreamEvents

Internal staff app for **Manager**, **Admin**, and **Sales Agent** (vendor recruiter) workspaces.

</div>

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4 + `@supabase/supabase-js`, matching your client app's stack exactly. Not Next.js. There's one small Express server (`server.ts`) — same pattern as the client app's server.ts — that serves the built app and hosts two privileged API routes that need a Supabase *service role* key (invite/deactivate staff). Everything else talks directly to Supabase from the browser like the client app does.

It is a **separate deployable** from the client-facing wedding site, connected only by sharing the same Supabase project (Postgres + Auth + Realtime). Neither app imports code from the other, so a bug or deploy in one can never break the other.

## Is this fully functional — just run the SQL, unzip, install, run?

Yes, with one extra step beyond that: you also need to put your Supabase **service role key** in `.env.local` (server-side only, never shipped to the browser) so the admin's "invite staff" button can actually create logins. Full steps:

1. `npm install`
2. Copy `.env.example` → `.env.local`, fill in:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — same values as the client app's `.env.local`.
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase Dashboard → Project Settings → API → `service_role` key. **Never** prefix this with `VITE_` (that would ship it to the browser), and never commit `.env.local` — see `.gitignore`.
   - `SITE_URL` — where this app is reachable (`http://localhost:3001` for local dev).
3. Run the SQL migrations in `supabase/migrations/` against your Supabase project, **in this order**: `0009` → `0012` → `0013` → `0014`. Do **not** run anything under `supabase/migrations/archive/` — those are superseded and actively conflict with `0012` (see `archive/README.md` for why).
4. In Supabase Dashboard → Authentication → URL Configuration, add `{SITE_URL}/set-password` to the allowed redirect URLs (needed for invite emails to work).
5. `npm run dev` → open `http://localhost:3001`.
6. Sign in as **yourself** for the first time. Staff live in `admin_users` (not a `staff` table), keyed by `auth_user_id` — bootstrap your own row once:
   ```sql
   insert into admin_users (auth_user_id, full_name, email, role, is_active) values
     ('<your-auth-user-uuid>', 'Your Name', 'you@wedplatform.com', 'admin', true);
   ```
   After that, **every other staff member is added through the app itself** — see below. This one-time manual step only exists because the first admin has to be created by *someone*; there's no bootstrapping problem after that.

## How login actually works (the flow you asked about)

Nobody can sign in to any workspace without an active `admin_users` row — that's enforced at the database level (RLS checks `admin_users.role` + `is_active` via the `is_admin()`/`is_staff()`/`my_staff_role()` helpers in migration `0012`), not just hidden in the UI. Getting that row created works like this:

1. **Admin → Team & Invites tab** → fills in name, email, role (Manager / Sales Agent / Admin) → clicks *Send Invite*.
2. That call hits `POST /api/invite-staff` on the server, which (a) calls Supabase's admin API to create the auth user and email them an invite link, and (b) creates their `admin_users` row with the chosen role — both in the same request, so there's no window where the account exists but has no role.
3. They click the link in the email → land on `/set-password` → set a password → they're immediately signed in and dropped into the workspace matching their role.
4. From then on, they just sign in at the normal login screen with **email + password** — no separate admin step needed again.
5. If an admin needs to revoke someone, the same Team tab has a **Deactivate** toggle. Deactivating flips `admin_users.is_active = false`, which the RLS helper functions treat as "not staff" everywhere — an instant, backend-enforced lockout, not just a hidden UI element.

This is exactly the flow you described: admin adds a manager/salesman → invite email → they set a password → email+password login from then on.

## Client history — how it's actually stored now

Originally the "Live Call Notes" box was a scratch pad that saved nothing. That's fixed: there is now a real `enquiry_activity_log` table (migration `0012`), one row per event, and a full timeline screen (`/manager/history/:enquiryId`, reachable from the client list or the event workspace).

Entries are written two ways:
- **Automatically**, via Postgres triggers: enquiry received, status changes, claims/reassignments, every vendor push, and the client's own reaction to a push (wishlist/skip/quote) — so the timeline builds itself as the normal workflow happens, nobody has to remember to log anything.
- **Manually**: a manager can type a note (from the live-call textarea's "Save Note" button, or directly on the history screen) which is inserted as a `note`-type row.

RLS scopes it exactly like enquiries: a manager only sees history for enquiries assigned to them; admins see everything.

## Everything the flow connects to

- Bride submits the inquiry wizard on the client site → new `enquiries` row → appears live (Supabase Realtime, no refresh) in every manager's chute and the admin's unassigned queue.
- Manager claims it (atomic RPC — two managers can't grab the same lead) or admin assigns it.
- Inside the claimed lead's Event Workspace, the manager searches the real venue/vendor/decor catalog and pushes listings — written into the same `enquiry_vendor_pushes` table the client dashboard's "For You" section already reads from in real time.
- Admin sees today's/all-time enquiry counts, unassigned queue, per-manager load, vendor approval queue, and now the Team tab for staff management.
- Sales agents work admin-assigned recruitment targets or onboard vendors independently; new listings land as hidden drafts (`is_active=false`, `approval_status='pending'`) until an admin approves them from the Vendor Approvals tab — nothing a salesman adds reaches the live client site unreviewed.

## Project layout

```
server.ts                          — Express: serves the app + /api/invite-staff, /api/deactivate-staff
src/
  lib/
    supabase.ts   — Supabase client (anon key, same project as client app)
    auth.ts       — staff email/password auth, password-set, access token
    api.ts        — every query/mutation, grouped by workspace
  context/StaffContext.tsx — who's signed in, their role, loading state
  components/Shell.tsx     — sidebar, header, stat tiles, status badges
  pages/
    AuthGateway.tsx          — email+password login screen
    SetPassword.tsx          — invite-link landing page
    manager/  ManagerPipeline, ManagerClients, EventWorkspace, ClientHistory
    admin/    AdminOverview, AdminEnquiries, AdminManagers,
              AdminVendorApprovals, AdminSalesTeam, AdminTeam
    salesman/ SalesmanTargets, SalesmanOnboard, SalesmanPipeline
supabase/migrations/
  0009_base_schema.sql             — clients/enquiries/venues/vendors/decor_themes, anon lead-capture RPCs
  0012_adapt_to_real_schema.sql    — admin_users roles, enquiry assignment, enquiry_activity_log, RLS fixes
  0013_locations_and_guests.sql    — locations, guests/RSVP
  0014_security_hardening.sql      — closes the account-takeover and guest-PII-leak paths found in review;
                                       see the file header for the full write-up
  archive/                         — 0010/0011, superseded by 0012 — do not run
```

## Verified in this session

- `tsc --noEmit` clean for both the app and `server.ts`.
- `npm run build` succeeds (Vite bundle + esbuild server bundle), `npm run dev` boots the server.
- **Not** tested against a live Supabase project (no real credentials available in this session) — the query/RLS/RPC logic follows the exact patterns already proven in your client app's `lib/api.ts` and `auth.ts`. Run through the setup steps above against your real project and try one full loop (invite → set password → log in → claim a lead → push a vendor → check history) before rolling it out to your team.
- Before running `0014` against a project that already has real data: check what RLS actually looks like live first — `select tablename, policyname, roles, cmd, qual from pg_policies where schemaname = 'public' order by tablename, policyname;` — since this project's migrations have a documented history of assuming schema that isn't fully captured in the files (see `0012`'s own header).

## Not built yet

- ⌘K-style global search overlay (present as a thumbnail in your design reference, not implemented).
- Scoped realtime for `enquiry_vendor_pushes` — the anon SELECT policy that lets the couple's "For You" panel update live also means the table is enumerable table-wide by anyone (documented in `0014`'s header). Properly closing it needs a per-enquiry realtime auth mechanism (e.g. signed broadcast channels) that doesn't exist in this schema yet.
