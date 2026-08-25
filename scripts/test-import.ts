// Tests the bulk-import parser against the kinds of file a sales team
// actually produces: prices with rupee symbols, capacity as one "100-600"
// cell, mixed-case category names, an address full of commas, and a ZIP
// whose image folders don't all match.
//
//   npx tsx scripts/test-import.ts
//
// Only the pure parse/validate half runs here — runImport() writes to
// Supabase and Cloudinary and is not exercised.

import JSZip from 'jszip';
import { parseImportFile, buildTemplateCsv, MAX_ROWS } from '../src/lib/importParse.js';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${label}`); }
  else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

// Node 18+ has File; give it a filename so parseImportFile picks the branch.
const csvFile = (name: string, body: string) =>
  new File([body], name, { type: 'text/csv' });

async function main() {
  // ---- 1. A messy but realistic CSV ---------------------------------------
  const messy = [
    'ref,name,category,venue_type,city,address,capacity,per_plate_veg,amenities,halls,rooms,alcohol_allowed,hotel_star_rating',
    '"wildflower","Wildflower Hall, Shimla",Resort,"wedding resort; hotel",Shimla,"Chharabra, Shimla 171012","100 - 600","₹1,200/-","Spa; Fitness centre","Lawrence Hall|banquet|2799|112; Auckland Room|indoor|444|18","Deluxe Garden View|463|20",yes,5',
    'moksha,The Moksha,venue,farmhouse,,,250,Rs 900,,,,no,',
  ].join('\n');

  const r1 = await parseImportFile(csvFile('listings.csv', messy));
  const w = r1.listings[0];

  check('parses both rows', r1.listings.length === 2, r1.listings.length);
  check('name with comma survives', w.fields.name === 'Wildflower Hall, Shimla', w.fields.name);
  check('address with comma survives', w.fields.address === 'Chharabra, Shimla 171012', w.fields.address);
  check('"Resort" maps to venue category', w.category === 'venue', w.category);
  check('venue_type list maps to slugs',
    JSON.stringify(w.fields.venue_types) === JSON.stringify(['wedding_resort', 'hotel']), w.fields.venue_types);
  check('"100 - 600" splits into min/max',
    w.fields.capacity_min === 100 && w.fields.capacity_max === 600,
    [w.fields.capacity_min, w.fields.capacity_max]);
  check('"₹1,200/-" parses to 1200', w.fields.per_plate_veg === 1200, w.fields.per_plate_veg);
  check('amenities split on ;',
    JSON.stringify(w.fields.amenities) === JSON.stringify(['Spa', 'Fitness centre']), w.fields.amenities);
  check('halls parsed with type and numbers',
    w.spaces.length === 2 &&
    (w.spaces[0] as any).name === 'Lawrence Hall' &&
    (w.spaces[0] as any).space_type === 'banquet' &&
    (w.spaces[0] as any).area_sqft === 2799 &&
    (w.spaces[0] as any).capacity_pax === 112,
    w.spaces);
  check('rooms parsed', w.rooms.length === 1 && (w.rooms[0] as any).area_sqft === 463, w.rooms);
  check('alcohol yes -> true', w.fields.alcohol_allowed === true, w.fields.alcohol_allowed);
  check('star rating kept', w.fields.hotel_star_rating === 5, w.fields.hotel_star_rating);
  check('no blocking errors on good row', w.errors.length === 0, w.errors);

  const m = r1.listings[1];
  check('blank city is a warning, not an error',
    m.errors.length === 0 && m.warnings.some((x) => x.includes('city')), { e: m.errors, w: m.warnings });
  check('blank tri-state stays null', m.fields.veg_only === null, m.fields.veg_only);
  check('"Rs 900" parses to 900', m.fields.per_plate_veg === 900, m.fields.per_plate_veg);
  check('single capacity becomes max only',
    m.fields.capacity_min === null && m.fields.capacity_max === 250,
    [m.fields.capacity_min, m.fields.capacity_max]);

  // ---- 2. Validation failures ---------------------------------------------
  const bad = [
    'name,category,capacity_min,capacity_max',
    ',venue,,',
    'Ok Place,spaceship,,',
    'Backwards,venue,600,100',
  ].join('\n');
  const r2 = await parseImportFile(csvFile('bad.csv', bad));
  check('missing name is an error', r2.listings[0].errors.some((e) => e.includes('Missing name')), r2.listings[0].errors);
  check('unknown category is an error', r2.listings[1].errors.some((e) => e.includes('Unknown category')), r2.listings[1].errors);
  check('backwards capacity is an error', r2.listings[2].errors.some((e) => e.includes('backwards')), r2.listings[2].errors);

  // ---- 3. No name column at all -------------------------------------------
  const r3 = await parseImportFile(csvFile('x.csv', 'foo,bar\n1,2'));
  check('missing name column is a file-level error',
    r3.listings.length === 0 && r3.fileErrors[0].includes('no "name" column'), r3.fileErrors);

  // ---- 4. Row cap ---------------------------------------------------------
  const many = ['name', ...Array.from({ length: MAX_ROWS + 5 }, (_, i) => `Venue ${i}`)].join('\n');
  const r4 = await parseImportFile(csvFile('many.csv', many));
  check('row cap enforced', r4.listings.length === MAX_ROWS, r4.listings.length);
  check('row cap explained', r4.fileErrors.some((e) => e.includes('over the')), r4.fileErrors);

  // ---- 5. ZIP with images -------------------------------------------------
  const zip = new JSZip();
  zip.file('listings.csv', 'ref,name,city\nwildflower,Wildflower Hall,Shimla\nmoksha,The Moksha,Shimla');
  // Deliberately out of order, to prove sorting picks 01 first.
  zip.file('images/wildflower/02-lawn.jpg', 'x');
  zip.file('images/wildflower/01-exterior.jpg', 'x');
  zip.file('images/orphan-folder/pic.jpg', 'x');
  zip.file('__MACOSX/images/wildflower/._01-exterior.jpg', 'x');
  zip.file('images/wildflower/notes.txt', 'ignored');
  // uint8array, not blob: JSZip's blob output needs a browser.
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const r5 = await parseImportFile(new File([zipBytes], 'upload.zip', { type: 'application/zip' }));

  const wf = r5.listings.find((l) => l.ref === 'wildflower')!;
  check('zip: csv found and rows parsed', r5.listings.length === 2, r5.listings.length);
  check('zip: images matched to ref by folder', wf.imageFiles.length === 2, wf.imageFiles.map((f) => f.name));
  check('zip: images sorted so 01 is first', wf.imageFiles[0].name === '01-exterior.jpg', wf.imageFiles[0]?.name);
  check('zip: non-images ignored', !wf.imageFiles.some((f) => f.name.endsWith('.txt')), wf.imageFiles.map((f) => f.name));
  check('zip: __MACOSX junk ignored', r5.imagesFound === 3, r5.imagesFound);
  check('zip: unmatched folder reported',
    r5.unmatchedImageFolders.includes('orphan-folder'), r5.unmatchedImageFolders);
  const mk = r5.listings.find((l) => l.ref === 'moksha')!;
  check('zip: listing with no folder warns about photos',
    mk.warnings.some((x) => x.includes('photo')), mk.warnings);

  // ---- 6. ZIP with no CSV -------------------------------------------------
  const zip2 = new JSZip();
  zip2.file('images/a/1.jpg', 'x');
  const r6 = await parseImportFile(
    new File([await zip2.generateAsync({ type: 'uint8array' })], 'nocsv.zip', { type: 'application/zip' })
  );
  check('zip with no csv is a clear error', r6.fileErrors[0].includes('No .csv file found'), r6.fileErrors);

  // ---- 7. The template we hand out must import cleanly --------------------
  const r7 = await parseImportFile(csvFile('template.csv', buildTemplateCsv()));
  check('template row parses with no errors',
    r7.listings.length === 1 && r7.listings[0].errors.length === 0,
    r7.listings[0]?.errors);
  check('template example has halls, rooms and packages',
    r7.listings[0].spaces.length === 2 &&
    r7.listings[0].rooms.length === 2 &&
    r7.listings[0].packages.length === 1,
    { s: r7.listings[0].spaces.length, r: r7.listings[0].rooms.length, p: r7.listings[0].packages.length });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
