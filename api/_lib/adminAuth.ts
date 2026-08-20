// Shared by every /api/* Vercel function below. Not itself a route —
// Vercel only treats files directly under api/ (not api/_lib/) as
// endpoints, same convention as Next.js's _-prefixed non-route files.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// App-level role ('admin' | 'manager' | 'salesman') <-> the real
// admin_users.role check constraint ('admin' | 'planner' | 'sales').
// Kept in sync with src/lib/roles.ts (that file can't be imported here —
// these functions run under Vercel's own Node runtime, not through
// Vite's TS pipeline).
export const APP_TO_DB_ROLE: Record<string, string> = { admin: 'admin', manager: 'planner', salesman: 'sales' };

// Service-role client — NEVER exposed to the browser. This is the one
// place in the whole app that can bypass RLS and call the Auth admin API
// (inviteUserByEmail, deleting users, etc). Only reachable through the
// two routes below, each of which re-checks the caller is a signed-in
// admin before doing anything privileged.
export function getAdminClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Every /api/* call must prove it's coming from a signed-in admin: the
// browser sends the caller's own access token, we ask Supabase who that
// is, then check their admin_users row (looked up by auth_user_id — the
// admin_users.id primary key is its own uuid, NOT auth.uid()). This is
// what stops a manager from just calling the invite endpoint directly.
export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const authHeader = (req.headers.authorization as string) || '';
  const token = authHeader.replace('Bearer ', '');
  const admin = getAdminClient();
  if (!token || !admin) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }
  const { data: staffRow } = await admin
    .from('admin_users')
    .select('role, is_active')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (!staffRow || staffRow.role !== 'admin' || !staffRow.is_active) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return userData.user.id;
}

// NOTE ON RATE LIMITING: server.ts's Express version of these routes used
// express-rate-limit, which keeps its counters in process memory. Vercel
// functions are stateless and short-lived (a fresh instance can spin up
// per request, and traffic can land on different instances/regions), so
// an in-memory limiter here would not reliably track anything — it isn't
// carried over from the Express version. requireAdmin() above still fully
// gates both routes to real, active admins, which is the load-bearing
// protection; if you want actual rate limiting on top of that in this
// serverless deployment, it needs a shared store (e.g. Upstash Redis) —
// not a plain in-memory counter.
