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

export async function createInviteAndSendEmail(
  admin: SupabaseClient,
  email: string,
  fullName: string,
  redirectTo: string
): Promise<InviteResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !resendFrom) {
    // Fallback: Supabase's own built-in invite email (unchanged behavior).
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
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

  const safeName = escapeHtml(fullName || 'there');
  const safeLink = escapeHtml(actionLink);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom,
      to: [email],
      subject: "You're invited to MyDreamEvents",
      html: `<p>Hi ${safeName},</p><p>You've been invited to join the MyDreamEvents staff portal. Click below to set your password and get started:</p><p><a href="${safeLink}">${safeLink}</a></p>`,
    }),
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
