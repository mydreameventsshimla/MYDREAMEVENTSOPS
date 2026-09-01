// Sends a push notification to a client, on a planner's behalf, from the
// staff side. The actual push infrastructure (subscriptions table, VAPID
// keys, web-push sending) lives entirely in minimalist-muse — this just
// calls its /api/send-push endpoint server-to-server, authenticated with
// a shared secret (never exposed to either app's browser bundle).
import { SupabaseClient } from '@supabase/supabase-js';

export interface NotifyResult {
  status: number;
  body: { sent?: number; failed?: number; error?: string };
}

export async function sendClientNotification(
  supabase: SupabaseClient,
  staffId: string,
  staffRole: string,
  enquiryId: string,
  title: string,
  body: string
): Promise<NotifyResult> {
  const { data: enquiry, error: fetchErr } = await supabase
    .from('enquiries')
    .select('client_id, assigned_to')
    .eq('id', enquiryId)
    .maybeSingle();

  if (fetchErr || !enquiry) {
    return { status: 404, body: { error: 'Enquiry not found.' } };
  }

  // A planner can only notify their own clients; an admin can notify
  // anyone's — same scoping every planner-facing table in this schema
  // uses (enquiry_messages, enquiry_tasks, enquiry_payments, proposals).
  if (staffRole !== 'admin' && enquiry.assigned_to !== staffId) {
    return { status: 403, body: { error: 'This enquiry is not assigned to you.' } };
  }

  const secret = process.env.PUSH_SEND_SECRET;
  const clientAppUrl = process.env.CLIENT_APP_URL || 'https://www.mydreamevent.in';
  if (!secret) {
    return { status: 500, body: { error: 'Push sending is not configured on this deployment.' } };
  }

  try {
    const res = await fetch(`${clientAppUrl}/api/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-push-secret': secret },
      body: JSON.stringify({ clientId: enquiry.client_id, title, body }),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) return { status: res.status, body: resBody };

    // Logged like every other staff-initiated, client-visible action in
    // this schema (0021's shortlist/visit_request pattern) — a manager
    // looking at Client History should see that a notification went out,
    // same as they'd see a push or a note.
    await supabase.from('enquiry_activity_log').insert({
      enquiry_id: enquiryId,
      staff_id: staffId,
      type: 'note',
      content: `Sent a notification to the client: "${title}" — ${body}`,
    });

    return { status: 200, body: resBody };
  } catch (err: any) {
    console.error('sendClientNotification failed:', err);
    return { status: 500, body: { error: 'Could not reach the client app to send the notification.' } };
  }
}
