import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { StaffProfile } from '../types';
import { DB_TO_APP_ROLE, DbStaffRole } from './roles';

// ============================================================================
// Staff authentication — email + password (Supabase Auth), distinct from the
// client site's OTP flow. A person only ever gets access after an admin
// creates their `admin_users` row (see migration 0012) pointing at their
// auth user id; signing in without an active admin_users row leaves them
// "authenticated but not staff", and every workspace treats that as
// logged-out. Note: admin_users.id is its own uuid, separate from
// auth.uid() — the link is admin_users.auth_user_id.
// ============================================================================

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Used once, right after clicking an invite-email link: supabase-js has
// already exchanged that link for a temporary session (detectSessionInUrl
// is on by default), so this just attaches a real password to it. From
// then on the person signs in with signInWithPassword like everyone else.
export async function setMyPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

// The raw access token for the current session — needed to call the
// server's privileged /api/* routes (invite/deactivate), which re-verify
// it server-side before doing anything.
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

// Resolves the current auth session into the staff row that defines which
// workspace (and RLS scope) this person gets. Returns null for anyone
// without an active admin_users row — the caller should sign them out.
export async function fetchMyStaffProfile(): Promise<StaffProfile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from('admin_users')
    .select('id, full_name, email, role, is_active, whatsapp_number, meet_link')
    .eq('auth_user_id', uid)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('fetchMyStaffProfile failed:', error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    full_name: data.full_name,
    email: data.email,
    is_active: data.is_active,
    role: DB_TO_APP_ROLE[data.role as DbStaffRole],
    whatsapp_number: data.whatsapp_number ?? null,
    meet_link: data.meet_link ?? null,
  };
}

// Self-service only — see migrations 0020/0024. A column-level guard
// trigger silently drops anything here that isn't
// `full_name`/`whatsapp_number`/`meet_link` back to its previous value,
// even if this function is later changed to send more, so this is defense
// in depth rather than the only thing standing between a staff member and
// their own `role` column.
//
// whatsapp_number/meet_link take string | null, not string: both columns'
// check constraints (0019) read "is null or matches <shape>" — an empty
// string is neither, so clearing a field and sending '' violates the
// constraint instead of clearing it. Passing null is what a "leave this
// blank" save actually means to the database.
export async function updateMyProfile(input: { full_name: string; whatsapp_number: string | null; meet_link: string | null }): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase
    .from('admin_users')
    .update({ full_name: input.full_name, whatsapp_number: input.whatsapp_number, meet_link: input.meet_link })
    .eq('auth_user_id', uid);
  if (error) throw error;
}
