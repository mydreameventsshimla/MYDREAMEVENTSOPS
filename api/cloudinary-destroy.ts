import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminClient } from './_lib/adminAuth.js';
import { handleDestroyRequest } from './_lib/cloudinary.js';

// Deployed twin of the /api/cloudinary-destroy route in server.ts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = getAdminClient();
  if (!admin) return res.status(500).json({ error: 'Server is not configured' });

  const token = ((req.headers.authorization as string) || '').replace('Bearer ', '');
  const { status, body } = await handleDestroyRequest(admin, token, req.body || {});
  return res.status(status).json(body);
}
