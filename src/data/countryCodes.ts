// Same list/shape as minimalist-muse's src/data/countryCodes.ts — kept
// consistent across both apps even though they're separate codebases, so
// a planner's WhatsApp number entered here always matches the country-code
// format the client app (and its wa.me links) expects. Used by
// SetPassword.tsx and ManagerProfile.tsx, the two places a planner's own
// WhatsApp number gets typed in.
export const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: '+91', label: 'IND (+91)' },
  { code: '+1', label: 'USA (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+65', label: 'SGP (+65)' },
  { code: '+61', label: 'AUS (+61)' },
  { code: '+86', label: 'CHN (+86)' },
];

// A lightweight sanity check, not full E.164 validation (that needs a
// proper phone library, overkill here).
export const MIN_DIGITS_BY_CODE: Record<string, number> = {
  '+91': 10,
  '+1': 10,
  '+44': 10,
  '+971': 8,
  '+65': 8,
  '+61': 9,
  '+86': 11,
};

// Splits a number already stored on admin_users.whatsapp_number back into
// {code, digits} for editing. Existing rows predate the country-code
// selector — they were free-typed against a loose regex (0019's
// `^\+?[0-9 ()-]{7,20}$`), so this can't assume a clean match; it falls
// back to +91 with whatever digits it can salvage rather than blanking
// the field and making someone re-enter a number that was already there.
export function splitPhoneNumber(stored: string | null | undefined): { code: string; digits: string } {
  if (!stored) return { code: '+91', digits: '' };
  const match = COUNTRY_CODES.find((c) => stored.startsWith(c.code));
  if (match) return { code: match.code, digits: stored.slice(match.code.length).replace(/\D/g, '') };
  return { code: '+91', digits: stored.replace(/\D/g, '') };
}
