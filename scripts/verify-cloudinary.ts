// Proves the one thing that can't be checked without real credentials:
// that Cloudinary actually accepts the signature we generate, and that the
// signature genuinely constrains what can be uploaded.
//
//   npx tsx scripts/verify-cloudinary.ts
//
// Uploads a 1x1 PNG into a throwaway folder, checks the result, then
// deletes it again. Nothing it creates outlives the run.

import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { cloudinaryConfig, signParams } from '../api/_lib/cloudinary.js';

dotenv.config({ path: '.env.local' });

const ALLOWED = 'jpg,jpeg,png,webp,avif,heic';

// Smallest valid PNG — one transparent pixel. Avoids needing a fixture file
// on disk just to exercise a signature.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function ok(label: string) { console.log(`  \x1b[32mPASS\x1b[0m  ${label}`); }
function bad(label: string, detail?: unknown) {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
  if (detail !== undefined) console.log(`        ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  process.exitCode = 1;
}

async function main() {
  const config = cloudinaryConfig();
  if (!config) {
    console.error('\nCLOUDINARY_API_SECRET (or key/cloud name) is missing from .env.local — nothing to test.\n');
    process.exit(1);
  }
  console.log(`\nCloudinary: cloud "${config.cloudName}", key ...${config.apiKey.slice(-4)}\n`);

  const publicId = `vendor-listings/_verify/${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams(
    { allowed_formats: ALLOWED, public_id: publicId, timestamp },
    config.apiSecret
  );

  // --- 1. A correctly signed upload is accepted -----------------------------
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: 'image/png' }), 'pixel.png');
  form.append('api_key', config.apiKey);
  form.append('timestamp', String(timestamp));
  form.append('public_id', publicId);
  form.append('allowed_formats', ALLOWED);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const uploaded = await res.json().catch(() => ({}));

  if (!res.ok) {
    bad('signed upload accepted', uploaded?.error?.message ?? `HTTP ${res.status}`);
    console.log('\nThe signature is being rejected — check CLOUDINARY_API_SECRET is the full, untruncated value.\n');
    return;
  }
  ok('signed upload accepted');

  if (uploaded.public_id === publicId) ok('landed at the server-chosen public_id');
  else bad('landed at the server-chosen public_id', `got ${uploaded.public_id}`);

  if (uploaded.version && uploaded.secure_url) ok('returned version + secure_url (what we store)');
  else bad('returned version + secure_url', uploaded);

  // --- 2. A tampered public_id is rejected ---------------------------------
  // This is the check that matters. If Cloudinary accepted this, an agent
  // could point an upload at any public_id in the account — including the
  // landing page's hero video — and overwrite it.
  const tampered = new FormData();
  tampered.append('file', new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: 'image/png' }), 'pixel.png');
  tampered.append('api_key', config.apiKey);
  tampered.append('timestamp', String(timestamp));
  tampered.append('public_id', 'vendor-listings/_verify/somewhere-else');
  tampered.append('allowed_formats', ALLOWED);
  tampered.append('signature', signature); // signature for the ORIGINAL public_id

  const tamperRes = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: 'POST',
    body: tampered,
  });

  if (tamperRes.ok) {
    const leaked = await tamperRes.json().catch(() => ({}));
    bad('tampered public_id rejected — IT WAS ACCEPTED', leaked?.public_id);
  } else {
    ok(`tampered public_id rejected (HTTP ${tamperRes.status})`);
  }

  // --- 3. Cleanup: the destroy path, which is also the delete-photo path ---
  const destroyTs = Math.floor(Date.now() / 1000);
  const destroyForm = new URLSearchParams({
    public_id: publicId,
    timestamp: String(destroyTs),
    api_key: config.apiKey,
    signature: signParams({ public_id: publicId, timestamp: destroyTs }, config.apiSecret),
  });
  const destroyRes = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`, {
    method: 'POST',
    body: destroyForm,
  });
  const destroyed = await destroyRes.json().catch(() => ({}));

  if (destroyed.result === 'ok') ok('test asset deleted (destroy path works)');
  else bad('test asset deleted', destroyed);

  console.log('');
}

main().catch((err) => {
  console.error('\nverify-cloudinary crashed:', err);
  process.exit(1);
});
