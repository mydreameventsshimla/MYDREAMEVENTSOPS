// Vercel serverless function — mirrors server.ts's /api/notify-client for
// local dev / non-Vercel hosts. Keep both in sync if you change one (see
// invite-staff.ts's header comment for why two copies exist).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminClient, requireStaff } from './_lib/adminAuth.js';
import { sendClientNotification } from './_lib/notifyClient.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const staff = await requireStaff(req, res);
    if (!staff) return;

    const { enquiryId, title, body } = req.body || {};
    if (!enquiryId || !title || !body) {
      return res.status(400).json({ error: 'enquiryId, title and body are required.' });
    }

    const admin = getAdminClient();
    if (!admin) return res.status(500).json({ error: 'Server not configured.' });

    const result = await sendClientNotification(admin, staff.id, staff.role, enquiryId, title, body);
    return res.status(result.status).json(result.body);
  } catch (err: any) {
    console.error('notify-client error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}
