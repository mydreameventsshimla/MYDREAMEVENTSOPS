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
3. Run the SQL migrations in `supabase/migrations/` against your Supabase project, **in this order**: `0009` → `0012` → `0013` → `0014` → `0015` → `0016` → `0017` → `0018` → `0019` → `0020` → `0021` → `0022`. Do **not** run anything under `supabase/migrations/archive/` — those are superseded and actively conflict with `0012` (see `archive/README.md` for why).
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
3. They click the link in the email → land on `/set-password`, which now also shows their name (editable — whoever invited them typed it, and typos happen) and, **for managers only**, a required WhatsApp number field (0019/0020) — the client app's "My Planner" tab has nothing to show a couple until that's set. Admins and sales agents see the same field but it's optional; neither role is ever `enquiries.assigned_to`, so nothing downstream reads it. They set a password → they're immediately signed in and dropped into the workspace matching their role. A manager resetting a forgotten password who already has a WhatsApp number on file isn't asked again.
4. From then on, they just sign in at the normal login screen with **email + password** — no separate admin step needed again.
5. If an admin needs to revoke someone, the same Team tab has a **Deactivate** toggle. Deactivating flips `admin_users.is_active = false`, which the RLS helper functions treat as "not staff" everywhere — an instant, backend-enforced lockout, not just a hidden UI element.

This is exactly the flow you described: admin adds a manager/salesman → invite email → they set a password → email+password login from then on.

## Vendor listings — application vs listing

Two different questions, two different queues, deliberately not merged:

- A **vendor application** (`vendor_applications`, *Add Vendor* → *Vendor Approvals*) answers **"should we work with this vendor at all"**. It's thirty seconds of typing in a hotel lobby with the owner waiting.
- A **vendor listing** (`vendor_listings`, *Vendor Listings* → listing editor) answers **"is this profile good enough to publish"**. It's the full profile — photos, halls, room types, per-plate pricing, amenities — built afterwards, at a desk.

**An application is optional — there is no forced double approval.** `create_vendor_listing()` takes `p_application_id` as a nullable argument, so an agent who already has the vendor's details starts the full profile directly and it passes **one** admin review, which covers both "do we work with them" and "is this good enough to publish". The two-step path exists for the opposite case: a name and a phone number captured in a lobby, where it's worth getting commercial sign-off *before* anyone spends an hour building a profile. Bulk Import is likewise single-gate.

An approved application with no listing behind it shows as a *Build profile* card at the top of the agent's Vendor Listings screen, since an approved vendor with no profile appears nowhere on the site.

**Editor flow:** `draft → pending_review → published`, with `rejected` looping back with a reason the agent sees at the top of the editor. A listing in `pending_review` or `published` is read-only to its author — enforced by RLS in migration `0015`, with the UI going read-only to match so nobody types into a field whose save is going to bounce.

Core fields save on an explicit **Save changes** button (an agent reading numbers off a rate card while the owner talks should not have half-typed prices streaming to the server); photos, halls, room types and packages persist immediately, since adding or removing one is already a deliberate act.

**Deleting.** An agent can delete their own listing while it's a draft or has been sent back — the bin icon on the Vendor Listings row, or in the editor header. It asks them to type the listing's name first, because the delete also removes the photos from Cloudinary and there is nothing left to restore from.

Deletion goes through `deleteListingAndMedia()` (`src/lib/listingActions.ts`), which destroys the Cloudinary assets **before** dropping the row — the destroy endpoint has to look the listing up to check permissions, so deleting the row first would make every photo delete fail with "Listing not found" and leave the files billing forever with nothing pointing at them. Child rows go by `on delete cascade`.

Deleting a listing that came from a vendor application asks whether to **withdraw the lead too**, ticked by default. Leaving it unticked keeps the vendor on the approved list, which means it reappears immediately as a *Build profile* card — correct if you're rebuilding the profile, and very confusing if you're not (it reads as though the delete silently failed). Approved leads also carry an × to withdraw them directly, without going near a listing.

For `pending_review` and `published` the option is replaced by a lock icon whose tooltip says why and what to do instead ("ask an admin to send it back", "an admin has to take it down first"). Those are the same conditions the RLS policy enforces, so the UI never offers a delete the database would refuse.

The completeness checklist on the Review step mirrors `submit_vendor_listing()`'s validation. The RPC is the enforcement — the checklist just means the agent finds out what's missing before pressing the button.

**Admin review** lives under *Vendors* (`/admin/vendors`), as the second of two tabs. Applications and listings are sequential stages of one pipeline — approving an application produces a listing — so splitting them across two sidebar entries meant two clicks and a mental map to answer one question, with nothing on screen saying the two were related. The Listing Review tab carries a count of what's actually waiting. `/admin/listings` redirects here.

Both the admin and sales listing screens use the same **searchable, category-grouped grid** (`src/components/listing/ListingGrid.tsx`), so a vendor looks the same to whoever is looking at it. Grouped by category because that's how people search — "which photographers do we have in Bengaluru", not "show me row 47" — with a search box matching name, city, locality and tagline, and category chips that only appear for categories that actually have listings.

The cards show each listing's cover photo rather than a text row — the thing being reviewed is a photograph of a venue plus a price, and a text row forces an admin to open every listing just to find out whether the photos are usable. Each card carries the cover, badges, status, photo count (highlighted amber at one photo, which is usually reason enough to send it back), per-plate price, capacity, the submitting agent and the date, so most triage happens without opening anything.

Clicking a card opens the full profile — it renders the listing the way a couple will see it — cover, gallery, halls, room types, packages — rather than a database form, because the question being answered is "is this good enough to publish", not "are the columns populated". Approve publishes it (generating the slug and writing the `venues`/`vendors` mirror row in the same RPC); *Send back* requires a reason, which the agent sees at the top of their editor.

**Taking a live listing down.** Opening a published listing gives an admin *Take down* (needs a reason; the listing leaves the public site immediately and returns to the agent as editable, keeping its slug so republishing lands on the same URL) and *Delete permanently*.

Both go through RPCs in `0018` rather than table writes, because of a hazard worth stating plainly: `venues`/`vendors` hold a mirror row sharing the listing's id, and **nothing links them back** — there is no foreign key from `venues` to `vendor_listings`. A plain `delete from vendor_listings` therefore leaves the mirror row with `is_active = true`, and the client site reads exactly `venues where is_active = true`. The venue would stay live with its record deleted: nothing in the portal to find it by, and no way to remove it short of hand-written SQL. Both RPCs deal with the mirror first, and an `after delete` trigger clears it however the listing goes away — including through routes added later that forget about it.

Badges (`MDE's Choice`, `Bestseller`, `Premium`, `Budget Friendly`), the `MDE Partner` flag, the offer ribbon and sort weight are set **only** on this screen. The guard trigger in `0015` blocks those columns for non-admins at the database level, so they cannot be set from the agent's editor even by crafting the request by hand. Ratings and review counts are not settable by anyone through the UI — they stay null until real client reviews exist.

The queue updates live: `vendor_listings` is in the `supabase_realtime` publication, so a submission from an agent in the field appears without the admin refreshing.

## Bulk import (`/salesman/import`)

A spreadsheet of vendors — optionally zipped with their photos — becomes many draft listings in one pass.

Three phases, and the middle one is the point: **parse and validate everything first**, show the agent exactly what will be created row by row with every problem named, and only then write. An importer that just runs and reports afterwards leaves someone with fifty half-right listings and no way to tell which ones need attention.

- **CSV alone**, or a **ZIP** containing the CSV plus `images/<ref>/…`, one folder per row matched on the `ref` column. Files sort by name, so `01-front.jpg` reliably becomes the cover.
- Messy input is expected and handled: `₹1,200/-` → `1200`, `100 - 600` → `capacity_min`/`capacity_max`, `Resort` → the `venue` category, `yes`/`no`/blank → the tri-state fields (blank stays **null**, since "nobody asked" is not "no").
- Multi-value cells use `;` between items and `|` between an item's fields — `Lawrence Hall|banquet|2799|112; Auckland Room|indoor|444|18`.
- Blocking errors (no name, unknown category, backwards capacity range) skip only that row. Warnings (no city, no photos, a duplicate you already own) still import.
- Capped at 200 rows per file.

**Everything lands as a draft, and there is deliberately no bulk approve.** The point of the review step is that a human looked at what goes in front of couples; an import that could push fifty unreviewed profiles live would quietly delete that guarantee. Bulk *submit for approval* is offered — an admin still opens each one.

Parsing lives in `src/lib/importParse.ts`, which imports nothing from `api.ts` or `cloudinary.ts` on purpose: those pull in the Supabase client, which reads `import.meta.env` at module load and so only exists inside Vite. Keeping them apart is what makes every parsing rule testable outside a browser. The writing half is `src/lib/bulkImport.ts`.

```bash
npx tsx scripts/test-csv.ts      # 19 tests — RFC 4180 parser
npx tsx scripts/test-import.ts   # 33 tests — coercion, validation, ZIP handling
```

## Vendor listing photos (Cloudinary)

Listing media is uploaded **straight from the agent's browser to Cloudinary**; the bytes never touch our server. What our server does is hand out a short-lived signature per file:

1. The editor calls `POST /api/cloudinary-sign` with a `listingId` and a file count.
2. The server checks the caller is an active `sales` or `admin` staff member **and** that the listing is one they may edit (owner + status `draft`/`rejected`, mirroring migration `0015`'s RLS — necessary because this route runs with the service-role key and so bypasses RLS).
3. It returns one signed slot per file, each pinned to a public_id we choose: `vendor-listings/<listingId>/<uuid>`.
4. The browser POSTs each file to Cloudinary, then writes the returned `public_id` / `version` / dimensions into `vendor_listing_media`.

**Why signed and not an unsigned preset:** an unsigned preset is a public write credential — the preset name travels in the request body, so anyone with devtools can upload anything into the account indefinitely. Signing also pins the `public_id`, which stops an upload from targeting and overwriting an asset that's already live (the landing page's hero video lives in this same Cloudinary account).

Removing a photo goes through `POST /api/cloudinary-destroy`, which deletes the Cloudinary asset and the DB row together — dropping only the row would leave the asset billable forever with nothing pointing at it.

We store the `public_id`, not a finished URL, so the same upload serves the grid card (`w_800,f_auto,q_auto`) and the full-size gallery without re-uploading. See `src/lib/cloudinary.ts`.

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
server.ts                          — Express: serves the app + /api/invite-staff, /api/deactivate-staff,
                                     /api/cloudinary-sign, /api/cloudinary-destroy
src/
  lib/
    supabase.ts   — Supabase client (anon key, same project as client app)
    auth.ts       — staff email/password auth, password-set, access token
    api.ts        — every query/mutation, grouped by workspace
    cloudinary.ts — signed browser->Cloudinary uploads + image URL building
    csv.ts        — RFC 4180 parser (tested: scripts/test-csv.ts)
    importParse.ts— bulk-import parsing/validation, no Supabase imports
    bulkImport.ts — bulk-import execution (creates drafts, uploads photos)
  context/StaffContext.tsx — who's signed in, their role, loading state
  components/Shell.tsx     — sidebar, header, stat tiles, status badges
  components/listing/      — Fields, MediaManager, RepeatableSection, ListingPreview,
                             ListingGrid (shared searchable grid), SafeImage, ConfirmDialog
  pages/
    AuthGateway.tsx          — email+password login screen
    SetPassword.tsx          — invite-link landing page
    manager/  ManagerPipeline, ManagerClients, EventWorkspace, ClientHistory
    admin/    AdminOverview, AdminEnquiries, AdminManagers, AdminVendors
              (= AdminVendorApprovals + AdminListings as tabs),
              AdminSalesTeam, AdminTeam
    salesman/ SalesmanTargets, SalesmanOnboard, SalesmanPipeline,
              SalesmanListings, ListingEditor, BulkImport
supabase/migrations/
  0009_base_schema.sql             — clients/enquiries/venues/vendors/decor_themes, anon lead-capture RPCs
  0012_adapt_to_real_schema.sql    — admin_users roles, enquiry assignment, enquiry_activity_log, RLS fixes
  0013_locations_and_guests.sql    — locations, guests/RSVP
  0014_security_hardening.sql      — closes the account-takeover and guest-PII-leak paths found in review;
                                       see the file header for the full write-up
  0015_vendor_listings.sql         — vendor_listings + media/spaces/rooms/packages, the draft→review→publish
                                       workflow, and the missing sales INSERT grant on vendor_applications
                                       (the cause of the dead "Add Vendor" button)
  0016_venue_type.sql              — venue_types[] (banquet hall / garden / resort…) + hotel star rating
  0017_sales_delete_applications.sql — lets a sales agent withdraw a lead they submitted
  0018_admin_takedown.sql          — admin unpublish + delete, and the mirror-row cleanup trigger
  0019_planner_contact.sql         — whatsapp_number + meet_link on admin_users, and fetch_my_planner(enquiry_id)
                                       for the client app's chat/video-call/planner-number tab
  0020_staff_self_profile.sql      — lets a staff member fix their own name and set their WhatsApp number
                                       at set-password time, column-guarded so self-service can't touch role/is_active
  0021_client_signals.sql          — shortlist/visit_request/callback_request activity types + RPCs, so a manager
                                       sees on Client History when a couple shortlists, asks to visit, or requests
                                       a callback. Only shortlisting is wired to real UI so far — see the file header
  0022_venue_availability_and_visits.sql — vendor_listing_availability (salesman-owned, status doesn't gate writes,
                                       unlike every other child table) + venue_visit_requests + request_venue_visit(),
                                       for Phase 7's calendar and "Schedule a visit"
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
