import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminClient } from './_lib/adminAuth.js';
import { handleSignRequest } from './_lib/cloudinary.js';

// Deployed twin of the /api/cloudinary-sign route in server.ts. Both are
// three lines of plumbing around the same handler in _lib/cloudinary.ts, so
// local dev and production authorise uploads identically — the failure mode
// worth avoiding is a check that exists in one runtime and not the other.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = getAdminClient();
  if (!admin) return res.status(500).json({ error: 'Server is not configured' });

  const token = ((req.headers.authorization as string) || '').replace('Bearer ', '');
  const { status, body } = await handleSignRequest(admin, token, req.body || {});
  return res.status(status).json(body);
}
