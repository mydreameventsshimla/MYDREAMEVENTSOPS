// Sends the staff-invite email. Two modes, chosen automatically:
//
//   - RESEND_API_KEY + RESEND_FROM_EMAIL set  -> Supabase creates the
//     invited user via generateLink() (which creates the auth user but
//     sends NO email of its own), then we send the actual email ourselves
//     via Resend's HTTP API. Same provider/pattern as the client app's
//     /api/send-guest-invite route, for one consistent sending story
//     across both apps.
//   - Neither set -> falls back to Supabase's own built-in
//     inviteUserByEmail(), exactly what this app did before. Nothing
//     breaks if you haven't added Resend credentials yet; it just starts
//     using them the moment both env vars are present, no code change
//     needed on your end.
//
// Either way the caller gets back the same shape: { user, error }.
import type { SupabaseClient } from '@supabase/supabase-js';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface InviteResult {
  user: { id: string } | null;
  error: string | null;
}

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', manager: 'Manager', salesman: 'Sales Agent' };

// Inline CSS + table layout throughout — required for reliable rendering
// across email clients (Gmail/Outlook strip <style> blocks or have patchy
// CSS support), not a stylistic choice. Georgia/Arial fallbacks instead of
// the site's actual Google Fonts, since most email clients won't load an
// external font stylesheet at all.
function buildInviteEmailHtml(fullName: string, role: string, actionLink: string): { subject: string; html: string } {
  const safeName = escapeHtml(fullName || 'there');
  const safeLink = escapeHtml(actionLink);
  const roleLabel = ROLE_LABEL[role] || 'team member';

  const html = `
<div style="background-color:#f8fafc;padding:40px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr>
      <td style="padding:40px 40px 20px 40px;text-align:center;">
        <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#10b981;font-weight:700;">MyDreamEvents</p>
        <h1 style="margin:0;font-size:24px;line-height:1.3;color:#1e293b;font-family:Georgia,'Times New Roman',serif;font-weight:400;">Welcome to the team</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 40px 28px 40px;text-align:center;color:#475569;font-size:15px;line-height:1.7;">
        <p style="margin:0 0 16px 0;">Hi ${safeName},</p>
        <p style="margin:0 0 16px 0;">You've been invited to join MyDreamEvents as a <strong style="color:#1e293b;">${roleLabel}</strong>. We're glad to have you — whether it's guiding a couple through their dream celebration or building the vendor network that makes it happen, there's a real seat waiting for you here.</p>
        <p style="margin:0;">Set your password below to get started.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 40px 40px 40px;text-align:center;">
        <a href="${safeLink}" style="display:inline-block;background-color:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:16px 40px;border-radius:999px;">Join the Team</a>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">This invite link is personal — please don't share it. If you weren't expecting this, you can safely ignore this email.</p>
      </td>
    </tr>
  </table>
</div>`.trim();

  return { subject: 'Welcome to the MyDreamEvents team', html };
}

export async function createInviteAndSendEmail(
  admin: SupabaseClient,
  email: string,
  fullName: string,
  role: string,
  redirectTo: string
): Promise<InviteResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !resendFrom) {
    // Fallback: Supabase's own built-in invite email (unchanged behavior,
    // styled via Supabase's "Invite user" template instead of this file —
    // full_name and role are passed through as {{ .Data.full_name }} /
    // {{ .Data.role }} so that template can reference them too.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role },
      redirectTo,
    });
    return { user: data?.user ? { id: data.user.id } : null, error: error?.message || null };
  }

  // generateLink() creates the auth user in "invited" state (same as
  // inviteUserByEmail) but never sends anything itself — email delivery
  // is entirely our responsibility from here.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { data: { full_name: fullName }, redirectTo },
  });
  if (error || !data?.user) {
    return { user: null, error: error?.message || 'Failed to generate invite link' };
  }

  const actionLink = data.properties?.action_link;
  if (!actionLink) {
    return { user: null, error: 'Invite link generation succeeded but returned no action_link' };
  }

  const { subject, html } = buildInviteEmailHtml(fullName, role, actionLink);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: resendFrom, to: [email], subject, html }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text().catch(() => '');
    // The auth user was already created by generateLink() above even
    // though the email failed to send — surface that clearly rather than
    // silently leaving an invited-but-unnotified account behind.
    return {
      user: { id: data.user.id },
      error: `Auth account created, but Resend rejected the email: ${errText || resendRes.statusText}. Ask them to use "Forgot password" once you've confirmed the account exists, or resend manually.`,
    };
  }

  return { user: { id: data.user.id }, error: null };
}
