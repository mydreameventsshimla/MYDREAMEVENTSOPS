import { AppStaffRole } from './lib/roles';

export type StaffRole = AppStaffRole; // 'admin' | 'manager' | 'salesman' — see lib/roles.ts for the DB mapping

export interface StaffProfile {
  id: string; // admin_users.id — the FK target used by enquiries.assigned_to etc, NOT auth.uid()
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
}

// Matches the enquiries.status CHECK constraint in your real database.
export type EnquiryStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'won' | 'lost';

export interface ClientRow {
  id: string;
  full_name: string;
  phone_country_code: string | null;
  phone_number: string | null;
  phone_e164: string | null;
  email: string | null;
}

export interface EnquiryRow {
  id: string;
  client_id: string;
  source: string;
  destination: string | null;
  event_date_text: string | null;
  guest_bracket: string | null;
  vision_style: string | null;
  service_category: string | null;
  notes: string | null;
  dream_text: string | null;
  contact_raw: string | null;
  estimated_budget: number | null;
  assigned_to: string | null; // admin_users.id
  status: EnquiryStatus;
  claimed_at: string | null;
  created_at: string;
}

// Convenience shape used across manager/admin screens: an enquiry with its
// client joined in, plus (for admin) the manager it's assigned to.
export interface EnquiryWithClient extends EnquiryRow {
  client: ClientRow | null;
  manager: Pick<StaffProfile, 'id' | 'full_name'> | null;
}

export type VendorRefTable = 'vendors' | 'venues' | 'decor_themes';
export type PushStatus = 'pushed' | 'viewing' | 'wishlist' | 'skipped' | 'quote';

export interface VendorPush {
  id: string;
  enquiry_id: string;
  vendor_ref_table: VendorRefTable;
  vendor_ref_id: string;
  vendor_label: string;
  status: PushStatus;
  created_at: string;
}

export type RecruitmentStatus = 'assigned' | 'in_progress' | 'negotiating' | 'onboarded' | 'rejected';
export type RecruitmentPriority = 'high' | 'medium' | 'low';
export type VendorCategory = 'venue' | 'decor' | 'photography' | 'makeup' | 'dj' | 'mehendi' | 'other';

export interface RecruitmentTarget {
  id: string;
  vendor_name: string;
  category: VendorCategory;
  priority: RecruitmentPriority;
  objective: string | null;
  assigned_salesman_id: string | null; // admin_users.id
  status: RecruitmentStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Matches vendor_applications.role's CHECK constraint exactly.
export type VendorApplicationRole = 'Venue' | 'Decor' | 'Sound' | 'Lens' | 'Henna' | 'Face' | 'Film' | 'Full Planning';
export type VendorApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface VendorApplication {
  id: string;
  applicant_name: string;
  role: VendorApplicationRole;
  portfolio_url: string | null;
  story: string | null;
  city: string | null;
  email: string | null;
  status: VendorApplicationStatus;
  reviewed_by: string | null;
  submitted_by: string | null; // admin_users.id of the sales agent, if staff-submitted
  promoted_vendor_id: string | null;
  promoted_venue_id: string | null;
  promoted_decor_theme_id: string | null;
  created_at: string;
}

export type ActivityType = 'note' | 'status_change' | 'claim' | 'assignment' | 'push' | 'client_reaction';

export interface ActivityLogEntry {
  id: string;
  enquiry_id: string;
  staff_id: string | null;
  type: ActivityType;
  content: string | null;
  meta: Record<string, any> | null;
  created_at: string;
  actorName?: string;
}

// Admin-managed destination presets shown in the client intake wizard's
// step 2 (migration 0013).
export interface LocationRow {
  id: string;
  name: string;
  region: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

// The RSVP/guest-list feature (migration 0013). Staff read/manage these
// through real RLS (is_admin() / assigned planner), unlike the client app
// which is entirely RPC-gated — see that migration's comment for why.
export type GuestSide = 'bride' | 'groom' | 'both';
export type RsvpStatus = 'pending' | 'attending' | 'not_attending' | 'maybe';

export interface GuestRow {
  id: string;
  enquiry_id: string;
  full_name: string;
  relation: string | null;
  side: GuestSide | null;
  coming_from: string | null;
  phone: string | null;
  email: string | null;
  rsvp_status: RsvpStatus;
  plus_ones: number;
  dietary_notes: string | null;
  invite_token: string;
  invited_via: 'manual' | 'link' | 'email' | 'whatsapp';
  invite_delivery_status: 'queued' | 'sent' | 'failed' | null;
  invited_at: string | null;
  responded_at: string | null;
  created_at: string;
}
