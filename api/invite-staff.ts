// Vercel serverless function — this is what /api/invite-staff actually
// hits on the deployed site. Vercel's static-Vite deployment never runs
// server.ts (that Express app only runs under `npm run dev` / `npm start`
// on a persistent Node host); this is the equivalent route ported to
// Vercel's per-file function convention. Keep this in sync with
// server.ts's /api/invite-staff if you change one — server.ts stays the
// version used for local dev and any non-Vercel deployment target.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { APP_TO_DB_ROLE, getAdminClient, requireAdmin } from './_lib/adminAuth';
import { createInviteAndSendEmail } from './_lib/inviteEmail';

// Invite a new manager/salesman/admin: creates the Supabase Auth user in
// "invited" state (Supabase emails them a set-password link) and creates
// their `admin_users` row in the same call, pointing auth_user_id at the
// new auth user, so they can sign in the moment they finish setting a
// password — no separate "activate" step.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const adminId = await requireAdmin(req, res);
    if (!adminId) return;

    const { email, full_name, role } = req.body || {};
    if (!email || !full_name || !['admin', 'manager', 'salesman'].includes(role)) {
      return res.status(400).json({ error: 'email, full_name and a valid role are required' });
    }

    const admin = getAdminClient()!;
    const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
    const redirectTo = `${siteUrl}/set-password`;

    // Uses Resend if RESEND_API_KEY + RESEND_FROM_EMAIL are set, otherwise
    // falls back to Supabase's own built-in invite email — see
    // _lib/inviteEmail.ts.
    const { user, error: inviteErr } = await createInviteAndSendEmail(admin, email, full_name, redirectTo);
    if (!user) {
      return res.status(400).json({ error: inviteErr || 'Invite failed' });
    }

    const { error: staffErr } = await admin.from('admin_users').insert({
      auth_user_id: user.id,
      full_name,
      email,
      role: APP_TO_DB_ROLE[role],
      is_active: true,
    });
    if (staffErr) {
      return res.status(400).json({ error: `Invite sent, but admin_users row failed: ${staffErr.message}` });
    }

    // user exists but inviteErr is set only in the "account created, email
    // failed to send" case (see inviteEmail.ts) — still 200 since the
    // account is real, but the client should surface this to the admin.
    return res.status(200).json({ ok: true, id: user.id, warning: inviteErr || undefined });
  } catch (err: any) {
    console.error('invite-staff error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}
