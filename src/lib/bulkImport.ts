// The WRITING half of bulk import. Parsing and validation live in
// importParse.ts, which stays free of Supabase/Cloudinary imports so it can
// be tested outside a browser.
//
// EVERYTHING LANDS AS A DRAFT. There is no bulk-publish and there never
// should be: the point of the review step is that a human looked at what
// goes in front of couples, and an import that could push fifty unreviewed
// profiles live would quietly delete that guarantee. Bulk submit for
// approval is offered; bulk approval is not.

import { createVendorListing, updateVendorListing, addListingChild, fetchMyListings } from './api';
import { uploadListingMedia } from './cloudinary';
import { ParsedListing } from './importParse';

export * from './importParse';

// ---------------------------------------------------------------------------
// Duplicate detection against what the agent already has
// ---------------------------------------------------------------------------

export async function flagExistingDuplicates(
  salesmanId: string,
  listings: ParsedListing[]
): Promise<void> {
  const mine = await fetchMyListings(salesmanId);
  const existing = new Set(
    mine.map((l) => `${(l.name || '').toLowerCase()}|${(l.city || '').toLowerCase()}`)
  );
  for (const l of listings) {
    const key = `${(l.fields.name || '').toLowerCase()}|${(l.fields.city || '').toLowerCase()}`;
    if (existing.has(key)) {
      l.warnings.push('You already have a listing with this name and city — importing makes a second one');
    }
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ImportProgress {
  done: number;
  total: number;
  current: string;
}

export interface ImportOutcome {
  rowNumber: number;
  name: string;
  listingId: string | null;
  photosUploaded: number;
  error: string | null;
  photoError: string | null;
}

export async function runImport(
  listings: ParsedListing[],
  onProgress: (p: ImportProgress) => void
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];

  // Sequential, not parallel. Each listing costs a create RPC, an update, a
  // signature request and N Cloudinary uploads; fanning fifty of those out at
  // once trips the upload endpoint's rate limit and produces a wall of
  // failures that look like bugs rather than throttling.
  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    onProgress({ done: i, total: listings.length, current: l.fields.name || `Row ${l.rowNumber}` });

    const outcome: ImportOutcome = {
      rowNumber: l.rowNumber,
      name: l.fields.name || `Row ${l.rowNumber}`,
      listingId: null,
      photosUploaded: 0,
      error: null,
      photoError: null,
    };

    try {
      const id = await createVendorListing(l.category, l.fields.name || 'Untitled listing');
      outcome.listingId = id;

      await updateVendorListing(id, l.fields);

      for (const [table, rows] of [
        ['vendor_listing_spaces', l.spaces],
        ['vendor_listing_rooms', l.rooms],
        ['vendor_listing_packages', l.packages],
      ] as const) {
        for (let p = 0; p < rows.length; p++) {
          await addListingChild(table, id, rows[p], p);
        }
      }

      // Photos are attempted last and their failure is recorded separately:
      // a listing that imported with all its text but lost two photos is a
      // ten-second fix in the editor, and throwing the whole row away for it
      // would be worse than useless.
      if (l.imageFiles.length > 0) {
        try {
          const uploaded = await uploadListingMedia({ listingId: id, files: l.imageFiles, role: 'gallery' });
          outcome.photosUploaded = uploaded.length;
          if (uploaded.length > 0) {
            await promoteFirstToCover(id, uploaded[0].id);
          }
        } catch (err: any) {
          outcome.photoError = err?.message || 'Photo upload failed';
          if (Array.isArray(err?.partial)) outcome.photosUploaded = err.partial.length;
        }
      }
    } catch (err: any) {
      outcome.error = err?.message || 'Import failed';
    }

    outcomes.push(outcome);
  }

  onProgress({ done: listings.length, total: listings.length, current: '' });
  return outcomes;
}

async function promoteFirstToCover(listingId: string, mediaId: string) {
  const { setCoverMedia } = await import('./cloudinary');
  await setCoverMedia(listingId, mediaId);
}
