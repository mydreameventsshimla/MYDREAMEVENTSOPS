import { AppStaffRole } from './lib/roles';

export type StaffRole = AppStaffRole; // 'admin' | 'manager' | 'salesman' — see lib/roles.ts for the DB mapping

export interface StaffProfile {
  id: string; // admin_users.id — the FK target used by enquiries.assigned_to etc, NOT auth.uid()
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  // Migration 0019/0020. Null until the staff member sets it themselves at
  // set-password time (managers) or an admin fills it in later.
  whatsapp_number: string | null;
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

// Migration 0021 added shortlist/visit_request/callback_request — signals a
// couple sends from the client app directly, distinct from staff-authored
// notes/pushes and from the enquiry's own status/assignment history.
export type ActivityType =
  | 'note' | 'status_change' | 'claim' | 'assignment' | 'push' | 'client_reaction'
  | 'shortlist' | 'visit_request' | 'callback_request';

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

// ============================================================================
// VENDOR LISTINGS (migration 0015) — the rich, admin-approved vendor profile
// that feeds both the ops portal and the public browse/detail pages.
//
// Distinct from VendorApplication above: an *application* answers "should we
// work with this vendor at all", a *listing* answers "is this profile good
// enough to publish". One application can turn into one listing; a listing
// can also exist with no application behind it.
// ============================================================================

export type ListingCategory =
  | 'venue' | 'decor' | 'sound' | 'photography' | 'mehendi'
  | 'makeup' | 'film' | 'planning' | 'catering';

export type ListingStatus = 'draft' | 'pending_review' | 'published' | 'rejected';

export type PriceUnit = 'per_plate' | 'per_event' | 'per_day' | 'per_hour';

// Admin-only (enforced by trigger in 0015, not just by the UI hiding them).
export type ListingBadge = 'choice' | 'bestseller' | 'premium' | 'budget' | 'new';

export const LISTING_CATEGORY_LABELS: Record<ListingCategory, string> = {
  venue: 'Venue',
  decor: 'Decor',
  sound: 'Sound & DJ',
  photography: 'Photography',
  mehendi: 'Mehendi',
  makeup: 'Bridal Makeup',
  film: 'Film',
  planning: 'Full Planning',
  catering: 'Catering',
};

// The application form's role labels -> the DB's canonical category slugs.
export const APPLICATION_ROLE_TO_CATEGORY: Record<VendorApplicationRole, ListingCategory> = {
  Venue: 'venue',
  Decor: 'decor',
  Sound: 'sound',
  Lens: 'photography',
  Henna: 'mehendi',
  Face: 'makeup',
  Film: 'film',
  'Full Planning': 'planning',
};

export interface VendorListing {
  id: string;
  application_id: string | null;
  created_by: string | null;
  owner_salesman_id: string | null;
  category: ListingCategory;

  status: ListingStatus;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  published_at: string | null;

  name: string;
  slug: string | null;
  tagline: string | null;
  description: string | null;

  city: string | null;
  locality: string | null;
  state: string | null;
  address: string | null;
  map_lat: number | null;
  map_lng: number | null;

  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;

  price_unit: PriceUnit | null;
  per_plate_veg: number | null;
  per_plate_nonveg: number | null;
  price_starting: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  rooms_count: number | null;

  rating: number | null;
  reviews_count: number;
  badges: ListingBadge[];
  is_partner: boolean;
  offer_text: string | null;
  sort_weight: number;

  amenities: string[];
  locality_highlights: string[];
  distance_airport_km: number | null;
  distance_railway_km: number | null;
  parking_capacity: number | null;
  alcohol_allowed: boolean | null;
  outside_catering_allowed: boolean | null;
  veg_only: boolean | null;

  // Migration 0016
  venue_types: VenueType[];
  hotel_star_rating: number | null;

  details: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type MediaKind = 'image' | 'video';
export type MediaRole = 'cover' | 'gallery' | 'logo' | 'menu' | 'floorplan';

export interface ListingMedia {
  id: string;
  listing_id: string;
  kind: MediaKind;
  role: MediaRole;
  cloudinary_public_id: string;
  cloudinary_version: number | null;
  secure_url: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: string | null;
  position: number;
}

// Migration 0016. A property is often several of these at once, which is why
// this is an array on the listing rather than a single "type" column.
export type VenueType =
  | 'banquet_hall' | 'wedding_garden' | 'wedding_resort' | 'hotel' | 'farmhouse'
  | 'lawn' | 'destination' | 'heritage' | 'rooftop' | 'convention_centre';

export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  banquet_hall: 'Banquet hall',
  wedding_garden: 'Wedding garden',
  wedding_resort: 'Wedding resort',
  hotel: 'Hotel',
  farmhouse: 'Farmhouse',
  lawn: 'Lawn',
  destination: 'Destination',
  heritage: 'Heritage property',
  rooftop: 'Rooftop',
  convention_centre: 'Convention centre',
};

export type SpaceType = 'indoor' | 'outdoor' | 'lawn' | 'poolside' | 'banquet' | 'terrace';

export interface ListingSpace {
  id: string;
  listing_id: string;
  name: string;
  space_type: SpaceType | null;
  area_sqft: number | null;
  capacity_pax: number | null;
  position: number;
}

export interface ListingRoom {
  id: string;
  listing_id: string;
  name: string;
  area_sqft: number | null;
  room_count: number | null;
  position: number;
}

export interface ListingPackage {
  id: string;
  listing_id: string;
  name: string;
  description: string | null;
  price: number | null;
  unit: PriceUnit | 'per_person' | null;
  inclusions: string[];
  is_active: boolean;
  position: number;
}

// Everything the editor loads for one listing in a single round trip.
export interface ListingBundle {
  listing: VendorListing;
  media: ListingMedia[];
  spaces: ListingSpace[];
  rooms: ListingRoom[];
  packages: ListingPackage[];
}

// Migration 0022. Unlike every other child table, writes to this one are
// NOT gated by the listing's status (draft/pending_review/published) — a
// live venue's calendar changes constantly, and freezing it at publish
// time would break the exact workflow this exists for right when it starts
// mattering.
export type AvailabilityStatus =
  | 'available' | 'low_demand' | 'high_demand' | 'peak_demand' | 'fully_booked' | 'blocked';

export interface ListingAvailability {
  id: string;
  listing_id: string;
  date: string; // ISO yyyy-mm-dd
  status: AvailabilityStatus;
  is_auspicious: boolean;
}
