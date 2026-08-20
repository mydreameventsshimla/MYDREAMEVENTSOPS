// One-off local script — NOT part of the deployed app. Resets a Supabase
// Auth user's password directly via the Admin API using your service role
// key. Use this to fix "Invalid login credentials" (401 on
// grant_type=password) when an admin_users row exists but the matching
// auth.users account never had a password set.
//
// Usage:
//   node scripts/reset-admin-password.mjs you@example.com "YourNewPassword123!"
//
// Reads SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL from .env.local —
// run this from the ops-portal directory.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-admin-password.mjs <email> <new-password>');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // listUsers() paginates; this app won't have thousands of staff, so one
  // page (default 50) is enough. Bump `perPage` if you ever need more.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    console.error('Failed to list users:', error.message);
    process.exit(1);
  }

  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No auth user found with email ${email}.`);
    console.error('Existing emails:', data.users.map((u) => u.email).join(', ') || '(none)');
    process.exit(1);
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
    email_confirm: true, // in case it wasn't confirmed yet, which also blocks password sign-in
  });
  if (updateErr) {
    console.error('Failed to update password:', updateErr.message);
    process.exit(1);
  }

  console.log(`Password set for ${email} (auth user id: ${user.id}). You can sign in with it now.`);
}

main();
