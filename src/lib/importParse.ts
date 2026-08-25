// The PURE half of bulk import: file in, validated listing objects out.
//
// Deliberately imports nothing from ./api or ./cloudinary. Those pull in the
// Supabase client, which reads `import.meta.env` at module load and therefore
// only exists inside Vite — so entangling them here would make every parsing
// rule in this file untestable outside a browser. The writing half lives in
// bulkImport.ts. See scripts/test-import.ts.
//
// EVERYTHING LANDS AS A DRAFT. There is no bulk-publish and there never
// should be: the entire point of the review step is that a human looked at
// what goes in front of couples, and an import that could push fifty
// unreviewed profiles live would quietly delete that guarantee. Bulk submit
// for approval is offered; bulk approval is not.
//
// The pipeline is deliberately two-phase — parse and validate everything
// first, show the operator exactly what will happen, and only then write.
// A partial import that dies halfway through row 30 leaves the agent with no
// idea which 29 listings exist, and the natural fix (run it again) creates
// duplicates.

import JSZip from 'jszip';
import { parseCsvToObjects, CsvRow, splitList, splitFields, toCsv } from './csv';
import {
  ListingCategory, VenueType, VendorListing, PriceUnit, SpaceType,
  LISTING_CATEGORY_LABELS, VENUE_TYPE_LABELS,
} from '../types';

// A cap, not a limitation. Fifty listings is a big genuine batch; a file
// with 5,000 rows is a mistake (a whole CRM export, the wrong file), and
// discovering that after it has created 5,000 drafts is much worse than
// being told to split it up.
export const MAX_ROWS = 200;

export interface ParsedListing {
  rowNumber: number;
  ref: string;
  // Resolved at parse time and carried separately from `fields`, because
  // category is an argument to create_vendor_listing() rather than something
  // patched afterwards — it's fixed for the life of the listing.
  category: ListingCategory;
  fields: Partial<VendorListing>;
  spaces: Record<string, unknown>[];
  rooms: Record<string, unknown>[];
  packages: Record<string, unknown>[];
  imageFiles: File[];
  imageUrls: string[];
  errors: string[];
  warnings: string[];
}

export interface ParseResult {
  listings: ParsedListing[];
  fileErrors: string[];
  imagesFound: number;
  unmatchedImageFolders: string[];
}

// ---------------------------------------------------------------------------
// Column vocabulary
// ---------------------------------------------------------------------------

const CATEGORY_ALIASES: Record<string, ListingCategory> = {
  venue: 'venue', venues: 'venue', hotel: 'venue', resort: 'venue', banquet: 'venue',
  decor: 'decor', decoration: 'decor',
  sound: 'sound', dj: 'sound', music: 'sound',
  photography: 'photography', photographer: 'photography', lens: 'photography', photo: 'photography',
  mehendi: 'mehendi', henna: 'mehendi',
  makeup: 'makeup', 'bridal makeup': 'makeup', face: 'makeup',
  film: 'film', video: 'film', videography: 'film',
  planning: 'planning', 'full planning': 'planning', planner: 'planning',
  catering: 'catering', caterer: 'catering', food: 'catering',
};

const VENUE_TYPE_ALIASES: Record<string, VenueType> = {
  'banquet hall': 'banquet_hall', banquet: 'banquet_hall', banquet_hall: 'banquet_hall',
  'wedding garden': 'wedding_garden', garden: 'wedding_garden', wedding_garden: 'wedding_garden',
  'wedding resort': 'wedding_resort', resort: 'wedding_resort', wedding_resort: 'wedding_resort',
  hotel: 'hotel',
  farmhouse: 'farmhouse', 'farm house': 'farmhouse',
  lawn: 'lawn',
  destination: 'destination',
  heritage: 'heritage', 'heritage property': 'heritage',
  rooftop: 'rooftop',
  'convention centre': 'convention_centre', 'convention center': 'convention_centre',
  convention_centre: 'convention_centre',
};

const SPACE_TYPE_ALIASES: Record<string, SpaceType> = {
  banquet: 'banquet', indoor: 'indoor', outdoor: 'outdoor',
  lawn: 'lawn', poolside: 'poolside', terrace: 'terrace',
};

const PRICE_UNITS: PriceUnit[] = ['per_plate', 'per_event', 'per_day', 'per_hour'];

// ---------------------------------------------------------------------------
// Cell coercion
// ---------------------------------------------------------------------------

// "₹1,200", "1200/-", "Rs 1200", " 1200 " all mean 1200. People paste from
// rate cards and WhatsApp, not from a database.
function num(cell: string | undefined): number | null {
  if (!cell) return null;
  const cleaned = cell.replace(/[₹,\s]/g, '').replace(/(rs\.?|inr|\/-|\+)/gi, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function int(cell: string | undefined): number | null {
  const n = num(cell);
  return n === null ? null : Math.round(n);
}

// Blank stays null — "nobody said" is not "no". Matches the tri-state fields
// in the editor.
function tri(cell: string | undefined): boolean | null {
  if (!cell) return null;
  const v = cell.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'allowed', 'available'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'not allowed', 'na'].includes(v)) return false;
  return null;
}

function text(cell: string | undefined): string | null {
  const v = (cell ?? '').trim();
  return v === '' ? null : v;
}

// "100-600", "100 to 600", "100 – 600" (en dash) → [100, 600]. One column in
// the spreadsheet, two columns in the database.
function range(cell: string | undefined): [number | null, number | null] {
  if (!cell) return [null, null];
  const parts = cell.split(/[-–—]|\bto\b/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return [int(parts[0]), int(parts[1])];
  const single = int(cell);
  return [null, single];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export async function parseImportFile(file: File): Promise<ParseResult> {
  const isZip = file.name.toLowerCase().endsWith('.zip');
  return isZip ? parseZip(file) : parseCsvFile(file);
}

async function parseCsvFile(file: File): Promise<ParseResult> {
  const text = await file.text();
  const result = buildListings(text, new Map());
  return { ...result, imagesFound: 0, unmatchedImageFolders: [] };
}

// Expected ZIP shape:
//   listings.csv                  (required — any *.csv at the root works)
//   images/<ref>/anything.jpg     (optional, one folder per listing `ref`)
async function parseZip(file: File): Promise<ParseResult> {
  // Read to an ArrayBuffer first rather than handing JSZip the File directly:
  // JSZip only recognises File via browser-specific detection, so passing it
  // straight through works in Chrome and throws everywhere else — including
  // in tests, which is how this would have gone unnoticed.
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const fileErrors: string[] = [];

  const csvEntry = Object.values(zip.files).find(
    (f) => !f.dir && /\.csv$/i.test(f.name) && !f.name.includes('__MACOSX')
  );
  if (!csvEntry) {
    return {
      listings: [],
      fileErrors: ['No .csv file found inside the ZIP. It needs a listings.csv at the top level.'],
      imagesFound: 0,
      unmatchedImageFolders: [],
    };
  }

  // Group images by their immediate parent folder, which is the listing ref.
  const byRef = new Map<string, File[]>();
  let imagesFound = 0;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.name.includes('__MACOSX') || entry.name.split('/').pop()?.startsWith('.')) continue;
    if (!/\.(jpe?g|png|webp|avif|heic)$/i.test(entry.name)) continue;

    const segments = entry.name.split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const ref = segments[segments.length - 2].trim().toLowerCase();

    // arraybuffer rather than blob: JSZip's blob output is browser-only, and
    // File takes either — so this same code path is exercisable in tests
    // outside a browser instead of being verified only by hand.
    const buffer = await entry.async('arraybuffer');
    const imageFile = new File([buffer], segments[segments.length - 1], { type: mimeFor(entry.name) });
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref)!.push(imageFile);
    imagesFound++;
  }

  // Sort each folder by filename so "01-front.jpg" reliably becomes the cover
  // rather than whatever order the ZIP happened to store things in.
  for (const files of byRef.values()) {
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  const csvText = await csvEntry.async('string');
  const built = buildListings(csvText, byRef);

  const usedRefs = new Set(built.listings.map((l) => l.ref.toLowerCase()));
  const unmatched = [...byRef.keys()].filter((r) => !usedRefs.has(r));

  return {
    listings: built.listings,
    fileErrors: [...fileErrors, ...built.fileErrors],
    imagesFound,
    unmatchedImageFolders: unmatched,
  };
}

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'avif') return 'image/avif';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}

function buildListings(
  csvText: string,
  imagesByRef: Map<string, File[]>
): { listings: ParsedListing[]; fileErrors: string[] } {
  const { headers, rows } = parseCsvToObjects(csvText);
  const fileErrors: string[] = [];

  if (rows.length === 0) {
    return { listings: [], fileErrors: ['The CSV has a header row but no data rows.'] };
  }
  if (!headers.includes('name')) {
    return {
      listings: [],
      fileErrors: [`The CSV has no "name" column. Found: ${headers.join(', ') || '(nothing)'}`],
    };
  }
  if (rows.length > MAX_ROWS) {
    fileErrors.push(
      `${rows.length} rows is over the ${MAX_ROWS}-row limit — split the file and import in batches.`
    );
  }

  const seenNames = new Set<string>();
  const listings = rows.slice(0, MAX_ROWS).map((row, i) => {
    const parsed = buildListing(row, i + 2, imagesByRef);
    const key = `${parsed.fields.name}|${parsed.fields.city}`.toLowerCase();
    if (seenNames.has(key)) {
      parsed.warnings.push('Another row in this same file has the same name and city');
    }
    seenNames.add(key);
    return parsed;
  });

  return { listings, fileErrors };
}

function buildListing(row: CsvRow, rowNumber: number, imagesByRef: Map<string, File[]>): ParsedListing {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = text(row.name);
  if (!name) errors.push('Missing name');

  const rawCategory = (row.category || row.type || 'venue').trim().toLowerCase();
  const category = CATEGORY_ALIASES[rawCategory];
  if (!category) {
    errors.push(
      `Unknown category "${row.category || row.type}" — use one of: ${Object.keys(LISTING_CATEGORY_LABELS).join(', ')}`
    );
  }

  const city = text(row.city);
  // Not an error: a draft can be saved without a city. It's a blocker only at
  // submit time, and flagging it here as fatal would refuse to import rows
  // the agent could fix in ten seconds.
  if (!city) warnings.push('No city — needed before this can be submitted');

  const ref = (text(row.ref) || name || `row-${rowNumber}`).toLowerCase();
  const imageFiles = imagesByRef.get(ref) ?? imagesByRef.get((name ?? '').toLowerCase()) ?? [];
  const imageUrls = splitList(row.image_urls || row.images).filter((u) => /^https?:\/\//i.test(u));

  if (imageFiles.length === 0 && imageUrls.length === 0) {
    warnings.push('No photos — needed before this can be submitted');
  }

  const [capFromRange, capMaxFromRange] = range(row.capacity || row.guests);
  const capacity_min = int(row.capacity_min) ?? capFromRange;
  const capacity_max = int(row.capacity_max) ?? capMaxFromRange;

  if (capacity_min !== null && capacity_max !== null && capacity_min > capacity_max) {
    errors.push(`Guest capacity reads backwards (${capacity_min} – ${capacity_max})`);
  }

  const venue_types = splitList(row.venue_type || row.venue_types)
    .map((v) => VENUE_TYPE_ALIASES[v.toLowerCase()])
    .filter(Boolean) as VenueType[];

  const unknownVenueTypes = splitList(row.venue_type || row.venue_types)
    .filter((v) => !VENUE_TYPE_ALIASES[v.toLowerCase()]);
  if (unknownVenueTypes.length > 0) {
    warnings.push(
      `Venue type not recognised, skipped: ${unknownVenueTypes.join(', ')} ` +
      `(valid: ${Object.values(VENUE_TYPE_LABELS).join(', ')})`
    );
  }

  const priceUnitRaw = (row.price_unit || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const price_unit = PRICE_UNITS.includes(priceUnitRaw as PriceUnit) ? (priceUnitRaw as PriceUnit) : null;

  const star = int(row.hotel_star_rating || row.star_rating);
  if (star !== null && (star < 1 || star > 7)) {
    warnings.push(`Star rating ${star} is out of range and was dropped`);
  }

  const fields: Partial<VendorListing> = {
    name: name ?? '',
    tagline: text(row.tagline),
    description: text(row.description),
    city,
    locality: text(row.locality || row.area),
    state: text(row.state),
    address: text(row.address),
    map_lat: num(row.map_lat || row.latitude),
    map_lng: num(row.map_lng || row.longitude),
    phone: text(row.phone || row.contact),
    email: text(row.email),
    website: text(row.website),
    instagram: text(row.instagram),
    price_unit,
    per_plate_veg: num(row.per_plate_veg),
    per_plate_nonveg: num(row.per_plate_nonveg),
    price_starting: num(row.price_starting),
    capacity_min,
    capacity_max,
    rooms_count: int(row.rooms_count || row.total_rooms),
    amenities: splitList(row.amenities),
    locality_highlights: splitList(row.locality_highlights || row.nearby),
    distance_airport_km: num(row.distance_airport_km),
    distance_railway_km: num(row.distance_railway_km),
    parking_capacity: int(row.parking_capacity),
    alcohol_allowed: tri(row.alcohol_allowed),
    outside_catering_allowed: tri(row.outside_catering_allowed),
    veg_only: tri(row.veg_only),
    venue_types,
    hotel_star_rating: star !== null && star >= 1 && star <= 7 ? star : null,
  };

  // halls: "Lawrence Hall|banquet|2799|112; Auckland Room|indoor|444|18"
  const spaces = splitList(row.halls || row.spaces).map((item, i) => {
    const [hName, hType, hArea, hPax] = splitFields(item);
    return {
      name: hName || `Space ${i + 1}`,
      space_type: SPACE_TYPE_ALIASES[(hType || '').toLowerCase()] ?? null,
      area_sqft: int(hArea),
      capacity_pax: int(hPax),
    };
  });

  // rooms: "Deluxe Garden View|463|20; Premier Valley View|463|15"
  const rooms = splitList(row.rooms || row.room_types).map((item, i) => {
    const [rName, rArea, rCount] = splitFields(item);
    return { name: rName || `Room type ${i + 1}`, area_sqft: int(rArea), room_count: int(rCount) };
  });

  // packages: "Silver|Basic decor and catering|85000|per_event"
  const packages = splitList(row.packages).map((item, i) => {
    const [pName, pDesc, pPrice, pUnit] = splitFields(item);
    const unit = (pUnit || '').toLowerCase().replace(/[\s-]+/g, '_');
    return {
      name: pName || `Package ${i + 1}`,
      description: pDesc || null,
      price: num(pPrice),
      unit: [...PRICE_UNITS, 'per_person'].includes(unit) ? unit : null,
    };
  });

  return {
    rowNumber, ref,
    category: category ?? 'venue',
    fields, spaces, rooms, packages,
    imageFiles, imageUrls, errors, warnings,
  };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const TEMPLATE_HEADERS = [
  'ref', 'name', 'category', 'venue_type', 'tagline', 'description',
  'city', 'locality', 'state', 'address', 'map_lat', 'map_lng',
  'phone', 'email', 'website', 'instagram',
  'capacity_min', 'capacity_max', 'price_unit', 'per_plate_veg', 'per_plate_nonveg',
  'price_starting', 'rooms_count', 'hotel_star_rating',
  'amenities', 'locality_highlights',
  'distance_airport_km', 'distance_railway_km', 'parking_capacity',
  'alcohol_allowed', 'outside_catering_allowed', 'veg_only',
  'halls', 'rooms', 'packages', 'image_urls',
];

const TEMPLATE_EXAMPLE = [
  'wildflower-hall',
  'Wildflower Hall, Shimla',
  'venue',
  'wedding resort; hotel',
  'A 5-star hillside resort with Himalayan valley views',
  'The former residence of Lord Kitchener, Wildflower Hall is a 5 star resort in Shimla.',
  'Shimla', 'Chharabra', 'Himachal Pradesh', 'Chharabra, Shimla 171012',
  '31.1048', '77.1734',
  '+91 98765 43210', 'events@example.com', 'https://example.com', '@wildflowerhall',
  '100', '600', 'per_plate', '1200', '1500', '', '85', '5',
  'Spa; Fitness centre; Heated swimming pool; Business centre; Conference room',
  'The Mall; Green Valley; Himalayan Nature Park',
  '17.6', '12.8', '60',
  'yes', 'no', 'no',
  'Lawrence Hall|banquet|2799|112; Auckland Room|indoor|444|18',
  'Deluxe Garden View|463|20; Lord Kitchener Suite|1475|1',
  'Silver|Basic decor and catering|85000|per_event',
  '',
];

export function buildTemplateCsv(): string {
  return toCsv(TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE]);
}
