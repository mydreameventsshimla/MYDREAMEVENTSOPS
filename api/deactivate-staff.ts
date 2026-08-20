// Vercel serverless function equivalent of server.ts's
// /api/deactivate-staff — see invite-staff.ts's header comment for why
// this exists as a separate file.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminClient, requireAdmin } from './_lib/adminAuth';

// Deactivate a staff member — flips is_active off, which RLS already
// treats as "logged out of every workspace" (see is_staff()/is_admin()).
// staffId here is admin_users.id (what the UI works with), not auth.uid().
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const adminId = await requireAdmin(req, res);
    if (!adminId) return;

    const { staffId, isActive } = req.body || {};
    if (!staffId) return res.status(400).json({ error: 'staffId is required' });

    const admin = getAdminClient()!;
    const { error } = await admin.from('admin_users').update({ is_active: !!isActive }).eq('id', staffId);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('deactivate-staff error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}
