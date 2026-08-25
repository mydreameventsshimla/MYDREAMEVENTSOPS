// Browser half of the signed-upload flow. The file bytes go straight from
// the agent's phone to Cloudinary — our server only ever hands out
// signatures, so a 40-photo venue gallery never passes through (or times
// out) our own Node process.
//
// Flow per batch:
//   1. ask /api/cloudinary-sign for N signed slots for this listing
//   2. POST each file to Cloudinary with its slot's signature
//   3. write the returned public_id/version/dimensions into
//      vendor_listing_media
//
// Steps 2 and 3 are separate on purpose: if the browser dies between them
// the asset is orphaned in Cloudinary (harmless, and reclaimable), whereas
// writing the row first would leave the gallery pointing at an image that
// doesn't exist.

import { supabase } from './supabase';
import { callApi } from './api';
import { ListingMedia, MediaKind, MediaRole } from '../types';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;

export type { ListingMedia, MediaKind, MediaRole };

interface SignedSlot {
  publicId: string;
  timestamp: number;
  signature: string;
  allowedFormats: string;
  uploadUrl: string;
  apiKey: string;
  cloudName: string;
}

interface CloudinaryUploadResult {
  public_id: string;
  version: number;
  format: string;
  width: number;
  height: number;
  bytes: number;
  secure_url: string;
}


// ---------------------------------------------------------------------------
// URL building
//
// We store the public_id rather than a finished URL precisely so that the
// same asset can be served at card size and at full size without
// re-uploading. `f_auto,q_auto` lets Cloudinary pick AVIF/WebP and a
// sensible quality per browser — on a listing grid of 30 cards that is the
// difference between a few hundred KB and tens of MB on a phone.
// ---------------------------------------------------------------------------
export interface ImageOptions {
  width?: number;
  height?: number;
  crop?: 'fill' | 'fit' | 'limit';
  version?: number | null;
}

export function cloudinaryUrl(publicId: string, opts: ImageOptions = {}): string {
  if (!CLOUD_NAME) return '';
  const { width, height, crop = 'fill', version } = opts;
  const parts = ['f_auto', 'q_auto'];
  if (width) parts.push(`w_${width}`);
  if (height) parts.push(`h_${height}`);
  if (width || height) parts.push(`c_${crop}`);
  const versionSegment = version ? `v${version}/` : '';
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${parts.join(',')}/${versionSegment}${publicId}`;
}

// The size the listing grid actually renders at, doubled for retina.
export function cardImageUrl(media: Pick<ListingMedia, 'cloudinary_public_id' | 'cloudinary_version' | 'secure_url'>): string {
  if (!media.cloudinary_public_id) return media.secure_url || '';
  return cloudinaryUrl(media.cloudinary_public_id, {
    width: 800,
    height: 600,
    crop: 'fill',
    version: media.cloudinary_version,
  });
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

// Three at a time, not all thirty. A sales agent is usually standing in a
// venue on mobile data; firing 30 parallel multipart POSTs there means every
// one of them crawls and the slowest few time out, and the browser's own
// per-host connection cap serialises them anyway.
const CONCURRENCY = 3;

export interface UploadProgress {
  completed: number;
  total: number;
  failed: number;
}

export interface UploadOptions {
  listingId: string;
  files: File[];
  kind?: MediaKind;
  role?: MediaRole;
  onProgress?: (p: UploadProgress) => void;
}

export async function uploadListingMedia({
  listingId,
  files,
  kind = 'image',
  role = 'gallery',
  onProgress,
}: UploadOptions): Promise<ListingMedia[]> {
  if (files.length === 0) return [];

  const { slots } = await callApi<{ slots: SignedSlot[] }>('/api/cloudinary-sign', {
    listingId,
    kind,
    count: files.length,
  });

  if (slots.length < files.length) {
    throw new Error(`Only ${slots.length} uploads allowed at once — add the rest in a second batch.`);
  }

  // Existing media decides where this batch starts in the ordering, so a
  // second batch appends after the first instead of interleaving with it.
  const { count: existingCount } = await supabase
    .from('vendor_listing_media')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId);

  const startPosition = existingCount ?? 0;
  const uploaded: ListingMedia[] = [];
  const failures: string[] = [];
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++;
      const file = files[index];
      try {
        const result = await uploadOne(file, slots[index]);
        const row = await insertMediaRow({
          listingId,
          kind,
          role,
          result,
          position: startPosition + index,
          alt: file.name.replace(/\.[^.]+$/, ''),
        });
        uploaded.push(row);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      } finally {
        completed++;
        onProgress?.({ completed, total: files.length, failed: failures.length });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  // Partial success is reported, not swallowed: 9 of 10 photos landing and
  // the agent believing all 10 did is how a listing reaches review missing
  // exactly the photo the owner cared about.
  if (failures.length > 0 && uploaded.length === 0) {
    throw new Error(failures.join('; '));
  }
  if (failures.length > 0) {
    throw Object.assign(new Error(`${failures.length} of ${files.length} failed — ${failures.join('; ')}`), {
      partial: uploaded,
    });
  }

  return uploaded.sort((a, b) => a.position - b.position);
}

async function uploadOne(file: File, slot: SignedSlot): Promise<CloudinaryUploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', slot.apiKey);
  form.append('timestamp', String(slot.timestamp));
  form.append('public_id', slot.publicId);
  form.append('allowed_formats', slot.allowedFormats);
  form.append('signature', slot.signature);

  const res = await fetch(slot.uploadUrl, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Cloudinary rejected the file (${res.status})`);
  }
  return json as CloudinaryUploadResult;
}

async function insertMediaRow(input: {
  listingId: string;
  kind: MediaKind;
  role: MediaRole;
  result: CloudinaryUploadResult;
  position: number;
  alt: string;
}): Promise<ListingMedia> {
  const { result } = input;
  const { data, error } = await supabase
    .from('vendor_listing_media')
    .insert({
      listing_id: input.listingId,
      kind: input.kind,
      role: input.role,
      cloudinary_public_id: result.public_id,
      cloudinary_version: result.version,
      secure_url: result.secure_url,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      alt: input.alt,
      position: input.position,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ListingMedia;
}

// ---------------------------------------------------------------------------
// Read / reorder / delete
// ---------------------------------------------------------------------------

export async function fetchListingMedia(listingId: string): Promise<ListingMedia[]> {
  const { data, error } = await supabase
    .from('vendor_listing_media')
    .select('*')
    .eq('listing_id', listingId)
    .order('position');
  if (error) throw error;
  return (data as ListingMedia[]) || [];
}

// Goes through the server, which deletes the Cloudinary asset AND the row
// together. Deleting only the row would leave the asset billable forever
// with nothing left pointing at it to find it by.
export async function deleteListingMedia(listingId: string, media: ListingMedia): Promise<void> {
  await callApi('/api/cloudinary-destroy', {
    listingId,
    mediaId: media.id,
    publicId: media.cloudinary_public_id,
    kind: media.kind,
  });
}

export async function reorderListingMedia(ordered: ListingMedia[]): Promise<void> {
  await Promise.all(
    ordered.map((m, i) =>
      supabase.from('vendor_listing_media').update({ position: i }).eq('id', m.id)
    )
  );
}

// Exactly one cover per listing — the grid card and every share preview
// read it, so "whichever row happened to sort first" is not good enough.
export async function setCoverMedia(listingId: string, mediaId: string): Promise<void> {
  const { error: demote } = await supabase
    .from('vendor_listing_media')
    .update({ role: 'gallery' })
    .eq('listing_id', listingId)
    .eq('role', 'cover');
  if (demote) throw demote;

  const { error } = await supabase
    .from('vendor_listing_media')
    .update({ role: 'cover' })
    .eq('id', mediaId);
  if (error) throw error;
}
