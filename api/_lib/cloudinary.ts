// Cloudinary signed-upload logic, shared by both runtimes: the Express
// route in server.ts (local dev / self-hosted) and the Vercel function in
// api/cloudinary.ts (deployed). Same split as inviteEmail.ts — the actual
// logic lives here once, and each runtime contributes only its own
// request/response plumbing.
//
// WHY SIGNED UPLOADS AND NOT AN UNSIGNED PRESET:
//
//   An unsigned upload preset is a public write credential. Anyone who
//   opens devtools on the portal (or on the public site, since the preset
//   name travels in the request body) can upload anything they like into
//   our Cloudinary account, forever, with no way to attribute or revoke it
//   short of deleting the preset and breaking our own uploads. Signed
//   uploads mean the browser cannot upload anything the server didn't
//   individually authorise, seconds earlier, for a specific listing.
//
// WHAT THE SIGNATURE ACTUALLY PINS DOWN:
//
//   The signature covers `public_id` and `allowed_formats`, and Cloudinary
//   rejects the upload if the browser alters either. Because WE choose the
//   public_id -- always `vendor-listings/<listingId>/<random>` -- a sales
//   agent cannot (a) write into someone else's listing folder, or (b) pick
//   an existing public_id and overwrite an asset that is already live. That
//   second one matters more than it looks: the landing page's hero video is
//   in this same Cloudinary account, and an upload targeting its public_id
//   would replace the homepage video for every visitor.
//
// Deliberately no `cloudinary` npm package: the signature is one sha1 and
// the two API calls are plain POSTs, so the SDK would be a dependency (and
// a supply-chain surface) bought for nothing.

import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const IMAGE_FORMATS = 'jpg,jpeg,png,webp,avif,heic';
const VIDEO_FORMATS = 'mp4,webm,mov';

// One request can ask for at most this many upload slots. A gallery of 30
// photos is realistic; 500 is someone scripting the endpoint.
const MAX_SLOTS = 30;

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface SignedSlot {
  publicId: string;
  timestamp: number;
  signature: string;
  allowedFormats: string;
  uploadUrl: string;
  apiKey: string;
  cloudName: string;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export function cloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.VITE_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

// Cloudinary's scheme: take every parameter you intend to send (except the
// file itself, api_key and resource_type), sort by key, join as
// `k=v&k=v`, append the API secret, sha1 it. Any parameter the browser
// adds or changes that isn't in this string makes the upload fail.
export function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(canonical + apiSecret).digest('hex');
}

// ---------------------------------------------------------------------------
// Caller identity. NOT the same as requireAdmin() in adminAuth.ts: uploading
// listing photos is a sales agent's core job, so this admits 'sales' too --
// but it returns their admin_users.id so the ownership check below can pin
// each upload to a listing they actually own.
// ---------------------------------------------------------------------------
interface StaffIdentity {
  staffId: string;
  role: string;
}

async function resolveStaff(admin: SupabaseClient, token: string): Promise<StaffIdentity | null> {
  if (!token) return null;
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: staffRow } = await admin
    .from('admin_users')
    .select('id, role, is_active')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();

  if (!staffRow || !staffRow.is_active) return null;
  if (staffRow.role !== 'admin' && staffRow.role !== 'sales') return null;
  return { staffId: staffRow.id as string, role: staffRow.role as string };
}

// Mirrors the RLS rules in migration 0015 exactly, because this endpoint
// runs with the service-role key and therefore bypasses them. An agent may
// attach media only to their own listing and only while it is still theirs
// to edit -- a listing sitting in `pending_review` is frozen, so photos
// can't be swapped out from under an admin mid-review.
async function assertCanEditListing(
  admin: SupabaseClient,
  listingId: string,
  staff: StaffIdentity
): Promise<string | null> {
  const { data: listing } = await admin
    .from('vendor_listings')
    .select('id, owner_salesman_id, status')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return 'Listing not found';
  if (staff.role === 'admin') return null;
  if (listing.owner_salesman_id !== staff.staffId) return 'This listing belongs to another agent';
  if (listing.status !== 'draft' && listing.status !== 'rejected') {
    return `A listing in ${listing.status} can't be edited — ask an admin`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/cloudinary/sign  { listingId, kind, count }
//
// Returns `count` independently signed upload slots so a gallery of photos
// costs one round trip to us rather than one per file. The browser then
// POSTs each file straight to Cloudinary — the bytes never pass through
// this server, which is the whole point of doing it this way.
// ---------------------------------------------------------------------------
export async function handleSignRequest(
  admin: SupabaseClient,
  token: string,
  body: Record<string, unknown>
): Promise<HandlerResult> {
  // Identity first, configuration second: an anonymous caller has no
  // business learning whether our Cloudinary keys are set, and checking in
  // the other order turns this into a free server-config probe.
  const staff = await resolveStaff(admin, token);
  if (!staff) return { status: 403, body: { error: 'Sales or admin access required' } };

  const config = cloudinaryConfig();
  if (!config) {
    return {
      status: 500,
      body: { error: 'Cloudinary is not configured. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.' },
    };
  }

  const listingId = typeof body.listingId === 'string' ? body.listingId : '';
  if (!listingId) return { status: 400, body: { error: 'listingId is required' } };

  const kind = body.kind === 'video' ? 'video' : 'image';
  const count = Math.min(Math.max(Number(body.count) || 1, 1), MAX_SLOTS);

  const denial = await assertCanEditListing(admin, listingId, staff);
  if (denial) return { status: 403, body: { error: denial } };

  const allowedFormats = kind === 'video' ? VIDEO_FORMATS : IMAGE_FORMATS;
  const timestamp = Math.floor(Date.now() / 1000);

  const slots: SignedSlot[] = Array.from({ length: count }, () => {
    // randomUUID, not the filename: two agents uploading `IMG_0001.jpg` to
    // the same listing must not collide, and a filename from an untrusted
    // form has no business becoming part of a public URL path.
    const publicId = `vendor-listings/${listingId}/${randomUUID()}`;
    const signature = signParams(
      { allowed_formats: allowedFormats, public_id: publicId, timestamp },
      config.apiSecret
    );
    return {
      publicId,
      timestamp,
      signature,
      allowedFormats,
      uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/${kind}/upload`,
      apiKey: config.apiKey,
      cloudName: config.cloudName,
    };
  });

  return { status: 200, body: { slots } };
}

// ---------------------------------------------------------------------------
// POST /api/cloudinary/destroy  { listingId, publicId, kind }
//
// Without this, every photo an agent adds and then removes while drafting
// stays in Cloudinary forever — the DB row goes, the asset doesn't. On a
// free tier that quietly becomes the reason uploads start failing months
// from now, with no obvious cause.
//
// The publicId is required to sit under this listing's own folder, so this
// endpoint can't be turned into "delete any asset in the account" by
// passing, say, the hero video's public_id.
// ---------------------------------------------------------------------------
export async function handleDestroyRequest(
  admin: SupabaseClient,
  token: string,
  body: Record<string, unknown>
): Promise<HandlerResult> {
  const staff = await resolveStaff(admin, token);
  if (!staff) return { status: 403, body: { error: 'Sales or admin access required' } };

  const config = cloudinaryConfig();
  if (!config) return { status: 500, body: { error: 'Cloudinary is not configured' } };

  const listingId = typeof body.listingId === 'string' ? body.listingId : '';
  const publicId = typeof body.publicId === 'string' ? body.publicId : '';
  const mediaId = typeof body.mediaId === 'string' ? body.mediaId : '';
  const kind = body.kind === 'video' ? 'video' : 'image';
  if (!listingId || !publicId) {
    return { status: 400, body: { error: 'listingId and publicId are required' } };
  }

  if (!publicId.startsWith(`vendor-listings/${listingId}/`)) {
    return { status: 403, body: { error: 'That asset does not belong to this listing' } };
  }

  const denial = await assertCanEditListing(admin, listingId, staff);
  if (denial) return { status: 403, body: { error: denial } };

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ public_id: publicId, timestamp }, config.apiSecret);

  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: config.apiKey,
    signature,
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${kind}/destroy`,
    { method: 'POST', body: form }
  );
  const result = (await response.json()) as { result?: string };

  // 'not found' is treated as success: the caller's intent was "this asset
  // should not exist", and failing here would strand the DB row pointing at
  // an asset that is already gone.
  if (result.result !== 'ok' && result.result !== 'not found') {
    return { status: 502, body: { error: `Cloudinary refused the delete: ${result.result ?? 'unknown'}` } };
  }

  // Drop the DB row in the same request, so the two can't drift apart.
  //
  // The error here MUST be checked. This previously ignored it and returned
  // ok, which meant a failed row delete looked like success: the editor
  // dropped the photo from view, the row survived pointing at a Cloudinary
  // asset that no longer existed, and the next person to load the listing —
  // usually the admin reviewing it — got a broken image with no way to tell
  // where it came from. Cloudinary has already destroyed the file by this
  // point, so a surviving row is strictly worse than a failed delete.
  //
  // Deletes by primary key when the caller supplies it, falling back to
  // public_id for older callers. `id` is exact; matching on a path string
  // is one normalisation quirk away from deleting nothing (or too much).
  const query = admin.from('vendor_listing_media').delete();
  const { error: rowError } = mediaId
    ? await query.eq('id', mediaId)
    : await query.eq('cloudinary_public_id', publicId);

  if (rowError) {
    return {
      status: 500,
      body: {
        error:
          'The file was deleted from Cloudinary but its database row could not be removed, ' +
          'so the listing still refers to a photo that no longer exists. Tell an admin.',
      },
    };
  }

  return { status: 200, body: { ok: true } };
}
