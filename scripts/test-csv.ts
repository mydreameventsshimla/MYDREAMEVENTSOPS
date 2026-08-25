// Tests for the CSV parser in src/lib/csv.ts.
//
//   npx tsx scripts/test-csv.ts
//
// A CSV parser without tests is a liability: every failure mode it has is
// silent. A mis-split quoted field doesn't throw — it shifts every later
// column left by one and imports a listing with the phone number in the
// email field, which nobody notices until a vendor gets no calls.

import { parseCsv, parseCsvToObjects, toCsv, splitList, splitFields } from '../src/lib/csv.js';

let pass = 0;
let fail = 0;

function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}\n        got  ${g}\n        want ${w}`);
  }
}

eq('plain rows', parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);

// The one that motivates the whole file: addresses contain commas.
eq(
  'comma inside quotes stays one field',
  parseCsv('name,city\n"Nandi Hills Road, Chikkaballapur",Bengaluru'),
  [['name', 'city'], ['Nandi Hills Road, Chikkaballapur', 'Bengaluru']]
);

eq('"" is an escaped quote', parseCsv('a\n"He said ""hi"""'), [['a'], ['He said "hi"']]);
eq('newline inside quotes', parseCsv('a,b\n"line1\nline2",x'), [['a', 'b'], ['line1\nline2', 'x']]);
eq('CRLF line endings', parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
eq('bare CR line endings', parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
eq('trailing newline makes no phantom row', parseCsv('a\n1\n'), [['a'], ['1']]);
eq('empty trailing field is kept', parseCsv('a,b\n1,'), [['a', 'b'], ['1', '']]);

// Excel writes a BOM. Without stripping it the first header becomes "﻿name"
// and that column silently never matches anything.
eq('BOM stripped from first header', parseCsvToObjects('﻿name\nWildflower').headers, ['name']);

eq(
  'headers normalised across spellings',
  parseCsvToObjects('Per Plate Veg,per-plate_NONVEG\n1,2').rows,
  [{ per_plate_veg: '1', per_plate_nonveg: '2' }]
);

eq('blank rows skipped', parseCsvToObjects('a\n1\n\n\n2').rows, [{ a: '1' }, { a: '2' }]);
eq('ragged row shorter than header', parseCsvToObjects('a,b,c\n1,2').rows, [{ a: '1', b: '2', c: '' }]);
eq('cells are trimmed', parseCsvToObjects('a,b\n  x  ,  y').rows, [{ a: 'x', b: 'y' }]);

eq(
  'toCsv output round-trips',
  parseCsv(toCsv(['a', 'b'], [['x,y', 'say "hi"']])),
  [['a', 'b'], ['x,y', 'say "hi"']]
);

eq(
  'splitList on ;',
  splitList('Lawrence Hall|2799|112; Auckland Room|444|18'),
  ['Lawrence Hall|2799|112', 'Auckland Room|444|18']
);
eq('splitList tolerates trailing ;', splitList('Spa; Gym;'), ['Spa', 'Gym']);
eq('splitList of empty is empty', splitList(''), []);
eq('splitFields on |', splitFields('Lawrence Hall|banquet|2799|112'), ['Lawrence Hall', 'banquet', '2799', '112']);
eq('splitFields keeps empty middles', splitFields('Hall||2799'), ['Hall', '', '2799']);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
