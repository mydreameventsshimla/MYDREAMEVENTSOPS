import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config({ path: '.env.local' });

// App-level role ('admin' | 'manager' | 'salesman') <-> the real
// admin_users.role check constraint ('admin' | 'planner' | 'sales').
// Kept in sync with src/lib/roles.ts (that file can't be imported here
// since this runs standalone under tsx, not through Vite's TS pipeline).
const APP_TO_DB_ROLE: Record<string, string> = { admin: 'admin', manager: 'planner', salesman: 'sales' };

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3001;

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());

  // These two routes hold the service-role key behind them — requireAdmin
  // stops anyone without an active admin row, but a tight rate limit is
  // still worth it: it's the only thing standing between a leaked/stolen
  // admin token and a scripted flood of invite emails or mass deactivation.
  const privilegedLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

  // Service-role client — NEVER exposed to the browser. This is the one
  // place in the whole app that can bypass RLS and call the Auth admin
  // API (inviteUserByEmail, deleting users, etc). Only reachable through
  // the /api/* routes below, each of which re-checks the caller is a
  // signed-in admin before doing anything privileged.
  function getAdminClient() {
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
  async function requireAdmin(req: express.Request, res: express.Response): Promise<string | null> {
    const authHeader = req.headers.authorization || '';
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

  // Invite a new manager/salesman/admin: creates the Supabase Auth user in
  // "invited" state (Supabase emails them a set-password link) and creates
  // their `admin_users` row in the same call, pointing auth_user_id at the
  // new auth user, so they can sign in the moment they finish setting a
  // password — no separate "activate" step.
  app.post('/api/invite-staff', privilegedLimiter, async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;

      const { email, full_name, role } = req.body || {};
      if (!email || !full_name || !['admin', 'manager', 'salesman'].includes(role)) {
        return res.status(400).json({ error: 'email, full_name and a valid role are required' });
      }

      const admin = getAdminClient()!;
      const redirectTo = `${process.env.SITE_URL || `http://localhost:${PORT}`}/set-password`;

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

      return res.json({ ok: true, id: invited.user.id });
    } catch (err: any) {
      console.error('invite-staff error:', err);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  });

  // Deactivate a staff member — flips is_active off, which RLS already
  // treats as "logged out of every workspace" (see is_staff()/is_admin()).
  // staffId here is admin_users.id (what the UI works with), not auth.uid().
  app.post('/api/deactivate-staff', privilegedLimiter, async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { staffId, isActive } = req.body || {};
      if (!staffId) return res.status(400).json({ error: 'staffId is required' });

      const admin = getAdminClient()!;
      const { error } = await admin.from('admin_users').update({ is_active: !!isActive }).eq('id', staffId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error('deactivate-staff error:', err);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: 'MyDreamEvents' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MyDreamEvents running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
