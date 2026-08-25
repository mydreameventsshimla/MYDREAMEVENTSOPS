// Listing operations that span both the database and Cloudinary.
//
// Lives in its own module rather than in api.ts because cloudinary.ts already
// imports api.ts for `callApi` — putting this in api.ts would make the two
// import each other.

import {
  deleteVendorListing, adminDeleteVendorListing, deleteVendorApplication, fetchListingBundle,
} from './api';
import { deleteListingMedia } from './cloudinary';
import { VendorListing } from '../types';

export interface DeleteOutcome {
  photosDeleted: number;
  photosFailed: number;
  applicationRemoved: boolean;
}

// Deleting a listing row cascades to its media/spaces/rooms/packages rows
// (`on delete cascade` in 0015), but Postgres knows nothing about Cloudinary:
// without this, deleting a venue with 25 photos leaves 25 files billing
// forever with nothing left in the database pointing at them, so they can
// never be found and cleaned up later.
//
// ORDER MATTERS. The destroy endpoint verifies the caller may edit the
// listing, which means looking the listing up — so it has to run while the
// row still exists. Deleting the row first would make every destroy call
// fail with "Listing not found".
// `alsoRemoveApplication` exists because deleting only the listing is
// frequently not what the agent meant. A listing built from an approved
// application leaves that application behind, and the Vendor Listings screen
// then surfaces it as a "Build profile" card — so the vendor they just
// deleted reappears within seconds, looking like the delete silently failed.
// Asking once, at the point of deletion, is clearer than either guessing.
export async function deleteListingAndMedia(
  listingId: string,
  alsoRemoveApplication = false,
  asAdmin = false
): Promise<DeleteOutcome> {
  const bundle = await fetchListingBundle(listingId);

  let photosDeleted = 0;
  let photosFailed = 0;

  for (const media of bundle.media) {
    try {
      await deleteListingMedia(listingId, media);
      photosDeleted++;
    } catch {
      // Deliberately swallowed. A leftover Cloudinary file is a storage cost;
      // refusing to delete the listing because one file wouldn't budge would
      // leave the agent stuck with a wrong listing they cannot remove, which
      // is the worse outcome. The count is reported so it isn't silent.
      photosFailed++;
    }
  }

  const applicationId = bundle.listing.application_id;
  // The admin path goes through an RPC because a published listing has a
  // venues/vendors mirror row that a plain delete would strand on the live
  // site. An agent's draft has no mirror, so the direct delete is fine —
  // and 0018's after-delete trigger covers the case either way.
  if (asAdmin) await adminDeleteVendorListing(listingId);
  else await deleteVendorListing(listingId);

  // After the listing, not before: if this fails, the agent is left with a
  // stray lead rather than a stray listing, and a lead is the cheaper thing
  // to clean up by hand.
  let applicationRemoved = false;
  if (alsoRemoveApplication && applicationId) {
    try {
      await deleteVendorApplication(applicationId);
      applicationRemoved = true;
    } catch {
      applicationRemoved = false;
    }
  }

  return { photosDeleted, photosFailed, applicationRemoved };
}

// RLS in 0015 only lets a sales agent delete their own listing while it is a
// draft or has been sent back. Encoding that here as well means the UI can
// explain *why* the option is unavailable instead of just hiding it — or
// worse, offering it and letting the delete fail with a policy error.
export function deletability(listing: VendorListing): { canDelete: boolean; reason: string | null } {
  if (listing.status === 'draft' || listing.status === 'rejected') {
    return { canDelete: true, reason: null };
  }
  if (listing.status === 'pending_review') {
    return {
      canDelete: false,
      reason: "It's with an admin for review. Ask them to send it back, then you can delete it.",
    };
  }
  return {
    canDelete: false,
    reason: 'It is live on the public site. An admin has to take it down first.',
  };
}
