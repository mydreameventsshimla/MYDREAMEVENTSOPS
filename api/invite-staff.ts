// Vercel serverless function — this is what /api/invite-staff actually
// hits on the deployed site. Vercel's static-Vite deployment never runs
// server.ts (that Express app only runs under `npm run dev` / `npm start`
// on a persistent Node host); this is the equivalent route ported to
// Vercel's per-file function convention. Keep this in sync with
// server.ts's /api/invite-staff if you change one — server.ts stays the
// version used for local dev and any non-Vercel deployment target.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { APP_TO_DB_ROLE, getAdminClient, requireAdmin } from './_lib/adminAuth';

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

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo,
    });
    if (inviteErr || !invited?.user) {
      return res.status(400).json({ error: inviteErr?.message || 'Invite failed' });
    }

    const { error: staffErr } = await admin.from('admin_users').insert({
      auth_user_id: invited.user.id,
      full_name,
      email,
      role: APP_TO_DB_ROLE[role],
      is_active: true,
    });
    if (staffErr) {
      return res.status(400).json({ error: `Invite sent, but admin_users row failed: ${staffErr.message}` });
    }

    return res.status(200).json({ ok: true, id: invited.user.id });
  } catch (err: any) {
    console.error('invite-staff error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}
