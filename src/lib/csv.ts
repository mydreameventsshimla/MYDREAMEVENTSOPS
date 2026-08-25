// A correct RFC 4180 CSV parser, written rather than pulled in as a
// dependency because the whole problem is about 80 lines and the failure
// mode of a naive `split(',')` is silent and ugly: a venue address like
// "Nandi Hills Road, Chikkaballapur" becomes two columns, every field after
// it shifts left by one, and the import creates listings with the phone
// number in the email field. Quoted fields containing commas, newlines and
// escaped quotes are the normal case in this data, not an edge case.

export type CsvRow = Record<string, string>;

// Parses into rows of raw cells. Handles: quoted fields, commas and
// newlines inside quotes, "" as an escaped quote, CRLF or LF line endings,
// and a UTF-8 BOM (which Excel adds, and which otherwise corrupts the very
// first header name into "﻿name" so no column ever matches).
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (char === '\r') {
      // Bare \r (old Mac) and \r\n both terminate the row.
      if (text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += char;
    i++;
  }

  // Trailing field/row — only kept if there was actually something there,
  // so a file ending in a newline doesn't yield a phantom empty row.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Parses to objects keyed by header. Headers are normalised (lowercased,
// spaces and hyphens to underscores) so "Per Plate Veg", "per-plate-veg"
// and "per_plate_veg" all land on the same field — a spreadsheet that has
// been through three people's hands will have all three.
export function parseCsvToObjects(input: string): { headers: string[]; rows: CsvRow[] } {
  const raw = parseCsv(input);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0].map(normaliseHeader);
  const rows: CsvRow[] = [];

  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    // Skip rows that are entirely empty — trailing blank lines in an
    // exported spreadsheet are extremely common and are not data.
    if (cells.every((c) => c.trim() === '')) continue;

    const obj: CsvRow = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = (cells[idx] ?? '').trim();
    });
    rows.push(obj);
  }

  return { headers, rows };
}

export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Quote only when needed, and always escape embedded quotes — used to build
// the downloadable template so that a template cell containing an example
// like `Lawrence Hall|2799|112; Hall 2|801|32` survives a round trip.
export function toCsv(headers: string[], rows: string[][]): string {
  const escape = (cell: string) =>
    /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return [headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
}

// Multi-value cells. `;` separates items, `|` separates that item's fields:
//   halls:  "Lawrence Hall|banquet|2799|112; Auckland Room|indoor|444|18"
// Chosen over commas because commas are the column separator, and over JSON
// because the person filling this in is working in Excel, not a code editor.
export function splitList(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell.split(';').map((s) => s.trim()).filter(Boolean);
}

export function splitFields(item: string): string[] {
  return item.split('|').map((s) => s.trim());
}
