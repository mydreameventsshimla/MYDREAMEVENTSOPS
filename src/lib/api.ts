import { supabase } from './supabase';
import { getAccessToken } from './auth';
import { APP_TO_DB_ROLE, DB_TO_APP_ROLE, DbStaffRole } from './roles';
import {
  ClientRow,
  EnquiryRow,
  EnquiryWithClient,
  EnquiryStatus,
  StaffProfile,
  StaffRole,
  VendorPush,
  RecruitmentTarget,
  RecruitmentStatus,
  RecruitmentPriority,
  VendorCategory,
  VendorRefTable,
  VendorApplication,
  VendorApplicationRole,
  ActivityLogEntry,
  LocationRow,
  GuestRow,
  ListingCategory,
  ListingStatus,
  ListingBadge,
  VendorListing,
  ListingBundle,
  ListingMedia,
  ListingSpace,
  ListingRoom,
  ListingPackage,
  ListingAvailability,
  AvailabilityStatus,
} from '../types';

// ============================================================================
// SHARED: staff roster (used to show manager names on admin screens, and
// to populate the "assign to" dropdown). Backed by admin_users; role is
// translated app-level <-> db-level via lib/roles.ts.
// ============================================================================

function mapStaffRow(row: any): StaffProfile {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    is_active: row.is_active,
    role: DB_TO_APP_ROLE[row.role as DbStaffRole],
    whatsapp_number: row.whatsapp_number ?? null,
  };
}

export async function fetchStaffRoster(role?: StaffRole): Promise<StaffProfile[]> {
  let query = supabase
    .from('admin_users')
    .select('id, full_name, email, role, is_active, whatsapp_number')
    .eq('is_active', true)
    .order('full_name');
  if (role) query = query.eq('role', APP_TO_DB_ROLE[role]);
  const { data, error } = await query;
  if (error) throw error;
  return ((data as any[]) || []).map(mapStaffRow);
}

function attachJoins(rows: EnquiryRow[], clients: ClientRow[], staff: StaffProfile[]): EnquiryWithClient[] {
  const clientMap = new Map(clients.map((c) => [c.id, c]));
  const staffMap = new Map(staff.map((s) => [s.id, s]));
  return rows.map((r) => ({
    ...r,
    client: clientMap.get(r.client_id) || null,
    manager: r.assigned_to
      ? { id: r.assigned_to, full_name: staffMap.get(r.assigned_to)?.full_name || 'Unknown' }
      : null,
  }));
}

async function hydrateEnquiries(rows: EnquiryRow[]): Promise<EnquiryWithClient[]> {
  if (rows.length === 0) return [];
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const managerIds = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean) as string[])];

  const [clientsRes, staffRes] = await Promise.all([
    supabase.from('clients').select('*').in('id', clientIds),
    managerIds.length
      ? supabase.from('admin_users').select('id, full_name, email, role, is_active').in('id', managerIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (clientsRes.error) throw clientsRes.error;
  if (staffRes.error) throw staffRes.error;

  return attachJoins(rows, (clientsRes.data as ClientRow[]) || [], ((staffRes.data as any[]) || []).map(mapStaffRow));
}

// ============================================================================
// MANAGER WORKSPACE
// ============================================================================

// The "chute" — new, unclaimed enquiries any manager (planner) can grab.
export async function fetchUnclaimedEnquiries(): Promise<EnquiryWithClient[]> {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .is('assigned_to', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return hydrateEnquiries((data as EnquiryRow[]) || []);
}

// This manager's own book of business.
export async function fetchMyEnquiries(managerId: string): Promise<EnquiryWithClient[]> {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .eq('assigned_to', managerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return hydrateEnquiries((data as EnquiryRow[]) || []);
}

export async function claimEnquiry(enquiryId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_enquiry', { p_enquiry_id: enquiryId });
  if (error) throw error;
  return !!data;
}

export async function updateEnquiryStatus(enquiryId: string, status: EnquiryStatus): Promise<void> {
  const { error } = await supabase.from('enquiries').update({ status }).eq('id', enquiryId);
  if (error) throw error;
}

// Live-updates whenever the enquiries table changes (new enquiry, claim,
// status change, reassignment) — both the chute and "my leads" lists
// re-fetch off of this.
export function subscribeToEnquiries(onChange: () => void): () => void {
  const channel = supabase
    .channel('ops:enquiries')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enquiries' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// Push a catalog listing to a client mid-call (writes into the same
// enquiry_vendor_pushes table the client dashboard's "For You" reads from
// in real time).
export async function pushListingToClient(
  enquiryId: string,
  table: VendorRefTable,
  vendorId: string,
  label: string
): Promise<void> {
  const { error } = await supabase.from('enquiry_vendor_pushes').insert({
    enquiry_id: enquiryId,
    vendor_ref_table: table,
    vendor_ref_id: vendorId,
    vendor_label: label,
    status: 'pushed',
  });
  if (error) throw error;
}

export async function fetchPushesForEnquiry(enquiryId: string): Promise<VendorPush[]> {
  const { data, error } = await supabase
    .from('enquiry_vendor_pushes')
    .select('*')
    .eq('enquiry_id', enquiryId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as VendorPush[]) || [];
}

export function subscribeToPushes(enquiryId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`ops:pushes:${enquiryId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'enquiry_vendor_pushes', filter: `enquiry_id=eq.${enquiryId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// Approved catalog (what a manager searches to find something to push).
// decor_themes has no `name` column (it's `title`) — searching it against
// a hardcoded `name` filter threw a Postgres error on every keystroke.
const CATALOG_NAME_COLUMN: Record<VendorRefTable, string> = {
  venues: 'name',
  vendors: 'name',
  decor_themes: 'title',
};

export async function searchCatalog(table: VendorRefTable, query: string) {
  const nameCol = CATALOG_NAME_COLUMN[table];
  let q = supabase.from(table).select('*').eq('is_active', true).limit(12);
  if (query.trim()) q = q.ilike(nameCol, `%${query.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ============================================================================
// ADMIN WORKSPACE
// ============================================================================

export async function fetchAllEnquiries(): Promise<EnquiryWithClient[]> {
  const { data, error } = await supabase.from('enquiries').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return hydrateEnquiries((data as EnquiryRow[]) || []);
}

export interface AdminOverview {
  totalEnquiriesToday: number;
  totalEnquiriesAllTime: number;
  unassignedCount: number;
  confirmedCount: number;
  activeManagers: number;
  activeSalesmen: number;
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todayRes, allRes, unassignedRes, confirmedRes, managersRes, salesmenRes] = await Promise.all([
    supabase.from('enquiries').select('id', { count: 'exact', head: true }).gte('created_at', startOfToday.toISOString()),
    supabase.from('enquiries').select('id', { count: 'exact', head: true }),
    supabase.from('enquiries').select('id', { count: 'exact', head: true }).is('assigned_to', null),
    supabase.from('enquiries').select('id', { count: 'exact', head: true }).eq('status', 'won'),
    supabase.from('admin_users').select('id', { count: 'exact', head: true }).eq('role', 'planner').eq('is_active', true),
    supabase.from('admin_users').select('id', { count: 'exact', head: true }).eq('role', 'sales').eq('is_active', true),
  ]);

  return {
    totalEnquiriesToday: todayRes.count || 0,
    totalEnquiriesAllTime: allRes.count || 0,
    unassignedCount: unassignedRes.count || 0,
    confirmedCount: confirmedRes.count || 0,
    activeManagers: managersRes.count || 0,
    activeSalesmen: salesmenRes.count || 0,
  };
}

export async function adminAssignEnquiry(enquiryId: string, managerId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_enquiry', { p_enquiry_id: enquiryId, p_manager_id: managerId });
  if (error) throw error;
}

// Admin fills this in manually for now — the client intake wizard doesn't
// collect a budget figure yet, so this is the stopgap until it does.
export async function updateEstimatedBudget(enquiryId: string, budget: number | null): Promise<void> {
  const { error } = await supabase.from('enquiries').update({ estimated_budget: budget }).eq('id', enquiryId);
  if (error) throw error;
}

export interface ManagerLoad {
  manager: StaffProfile;
  total: number;
  byStatus: Record<EnquiryStatus, number>;
}

export async function fetchManagerLoads(): Promise<ManagerLoad[]> {
  const [managers, enquiries] = await Promise.all([fetchStaffRoster('manager'), fetchAllEnquiries()]);
  return managers.map((manager) => {
    const mine = enquiries.filter((e) => e.assigned_to === manager.id);
    const byStatus = mine.reduce(
      (acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
      },
      {} as Record<EnquiryStatus, number>
    );
    return { manager, total: mine.length, byStatus };
  });
}

// ============================================================================
// VENDOR APPLICATIONS — the real inbound-vendor pipeline. Vendors apply
// (publicly, or a sales agent submits on their behalf with submitted_by
// set to the agent's admin_users.id); an admin reviews and approves/rejects;
// an approved+onboarded vendor is later promoted into vendors/venues/
// decor_themes by the pre-existing complete_vendor_onboarding flow.
// ============================================================================

export async function fetchPendingVendorApplications(): Promise<VendorApplication[]> {
  const { data, error } = await supabase
    .from('vendor_applications')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as VendorApplication[]) || [];
}

export async function reviewVendorApplication(
  applicationId: string,
  approve: boolean,
  reviewerStaffId: string
): Promise<void> {
  const { error } = await supabase
    .from('vendor_applications')
    .update({ status: approve ? 'approved' : 'rejected', reviewed_by: reviewerStaffId })
    .eq('id', applicationId);
  if (error) throw error;
}

export async function fetchAllRecruitmentTargets(): Promise<RecruitmentTarget[]> {
  const { data, error } = await supabase.from('vendor_recruitment_targets').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data as RecruitmentTarget[]) || [];
}

export async function createRecruitmentTarget(input: {
  vendor_name: string;
  category: VendorCategory;
  priority: RecruitmentPriority;
  objective: string;
  assigned_salesman_id: string;
  created_by: string;
}): Promise<void> {
  const { error } = await supabase.from('vendor_recruitment_targets').insert(input);
  if (error) throw error;
}

// ============================================================================
// SALESMAN WORKSPACE
// ============================================================================

export async function fetchMyRecruitmentTargets(salesmanId: string): Promise<RecruitmentTarget[]> {
  const { data, error } = await supabase
    .from('vendor_recruitment_targets')
    .select('*')
    .eq('assigned_salesman_id', salesmanId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as RecruitmentTarget[]) || [];
}

export async function updateRecruitmentStatus(targetId: string, status: RecruitmentStatus): Promise<void> {
  const { error } = await supabase
    .from('vendor_recruitment_targets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', targetId);
  if (error) throw error;
}

export function subscribeToMyTargets(salesmanId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`ops:targets:${salesmanId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'vendor_recruitment_targets', filter: `assigned_salesman_id=eq.${salesmanId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// A sales agent submits a vendor lead they've recruited in the field —
// lands in vendor_applications just like a public self-application, but
// tagged with submitted_by so it shows up in "my submissions" and the
// admin can see who brought it in.
export interface VendorApplicationInput {
  applicant_name: string;
  role: VendorApplicationRole;
  portfolio_url: string;
  story: string;
  city: string;
  email: string;
}

export async function submitVendorApplication(salesmanId: string, input: VendorApplicationInput): Promise<void> {
  const { error } = await supabase.from('vendor_applications').insert({
    ...input,
    submitted_by: salesmanId,
    status: 'pending',
  });
  if (error) throw error;
}

// Withdraw a lead this agent submitted (migration 0017). Listings built from
// it are unaffected — vendor_listings.application_id is `on delete set null`.
export async function deleteVendorApplication(applicationId: string): Promise<void> {
  const { error } = await supabase.from('vendor_applications').delete().eq('id', applicationId);
  if (error) throw error;
}

export async function fetchMyVendorApplications(salesmanId: string): Promise<VendorApplication[]> {
  const { data, error } = await supabase
    .from('vendor_applications')
    .select('*')
    .eq('submitted_by', salesmanId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as VendorApplication[]) || [];
}

// ============================================================================
// TEAM MANAGEMENT (admin) — invite/deactivate go through server.ts, which
// holds the service-role key. This client never sees that key; it just
// forwards the caller's own access token so the server can re-verify
// they're really an admin before doing anything privileged.
// ============================================================================

export async function callApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request to ${path} failed`);
  return json as T;
}

// `warning` is set only in one specific case: the auth account was
// created successfully but the invite email itself failed to send (e.g.
// Resend rejected it) — the account is real even though nothing landed in
// their inbox, so this is surfaced rather than silently discarded.
export async function inviteStaffMember(input: { email: string; full_name: string; role: StaffRole }): Promise<{ warning?: string }> {
  return callApi('/api/invite-staff', input);
}

export async function setStaffActive(staffId: string, isActive: boolean): Promise<void> {
  await callApi('/api/deactivate-staff', { staffId, isActive });
}

export async function fetchFullStaffRoster(): Promise<StaffProfile[]> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, full_name, email, role, is_active, whatsapp_number')
    .order('role')
    .order('full_name');
  if (error) throw error;
  return ((data as any[]) || []).map(mapStaffRow);
}

// Change someone's workspace after they've already been invited — covered
// by the same "admin manages admin_users" RLS policy that lets an admin
// deactivate staff, so this can go straight through the client (no server
// route needed, unlike invite which needs the Auth admin API).
export async function updateStaffRole(staffId: string, role: StaffRole): Promise<void> {
  const { error } = await supabase.from('admin_users').update({ role: APP_TO_DB_ROLE[role] }).eq('id', staffId);
  if (error) throw error;
}

// ============================================================================
// STAFF PERFORMANCE — powers the profile popup in Team & Invites. Managers
// (planners) are measured on their enquiry book; sales agents on their
// recruitment targets and vendor application submissions.
// ============================================================================

export interface ManagerPerformance {
  kind: 'manager';
  total: number;
  won: number;
  lost: number;
  active: number;
  conversionRate: number; // won / (won + lost), 0 if no closed leads yet
  byStatus: Record<EnquiryStatus, number>;
}

export interface SalesmanPerformance {
  kind: 'salesman';
  totalTargets: number;
  onboarded: number;
  rejected: number;
  activeTargets: number;
  targetsByStatus: Record<RecruitmentStatus, number>;
  totalApplications: number;
  applicationsByStatus: { pending: number; approved: number; rejected: number };
}

export interface AdminPerformance {
  kind: 'admin';
  vendorApplicationsReviewed: number;
}

export type StaffPerformance = ManagerPerformance | SalesmanPerformance | AdminPerformance;

export async function fetchStaffPerformance(staff: StaffProfile): Promise<StaffPerformance> {
  if (staff.role === 'manager') {
    const { data, error } = await supabase.from('enquiries').select('status').eq('assigned_to', staff.id);
    if (error) throw error;
    const rows = (data as { status: EnquiryStatus }[]) || [];
    const byStatus = rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<EnquiryStatus, number>);
    const won = byStatus.won || 0;
    const lost = byStatus.lost || 0;
    return {
      kind: 'manager',
      total: rows.length,
      won,
      lost,
      active: rows.length - won - lost,
      conversionRate: won + lost > 0 ? won / (won + lost) : 0,
      byStatus,
    };
  }

  if (staff.role === 'salesman') {
    const [targetsRes, appsRes] = await Promise.all([
      supabase.from('vendor_recruitment_targets').select('status').eq('assigned_salesman_id', staff.id),
      supabase.from('vendor_applications').select('status').eq('submitted_by', staff.id),
    ]);
    if (targetsRes.error) throw targetsRes.error;
    if (appsRes.error) throw appsRes.error;

    const targets = (targetsRes.data as { status: RecruitmentStatus }[]) || [];
    const targetsByStatus = targets.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<RecruitmentStatus, number>);

    const apps = (appsRes.data as { status: 'pending' | 'approved' | 'rejected' }[]) || [];
    const applicationsByStatus = apps.reduce(
      (acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0 }
    );

    return {
      kind: 'salesman',
      totalTargets: targets.length,
      onboarded: targetsByStatus.onboarded || 0,
      rejected: targetsByStatus.rejected || 0,
      activeTargets: targets.length - (targetsByStatus.onboarded || 0) - (targetsByStatus.rejected || 0),
      targetsByStatus,
      totalApplications: apps.length,
      applicationsByStatus,
    };
  }

  const { count, error } = await supabase
    .from('vendor_applications')
    .select('id', { count: 'exact', head: true })
    .eq('reviewed_by', staff.id);
  if (error) throw error;
  return { kind: 'admin', vendorApplicationsReviewed: count || 0 };
}

// ============================================================================
// ENQUIRY ACTIVITY LOG — the persisted history timeline. Status changes,
// claims, reassignments, pushes and client reactions are logged
// automatically by triggers (migration 0012); only free-text notes are
// written from here.
// ============================================================================

export async function fetchActivityLog(enquiryId: string): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('enquiry_activity_log')
    .select('*')
    .eq('enquiry_id', enquiryId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data as ActivityLogEntry[]) || [];
  const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean) as string[])];
  if (staffIds.length === 0) return rows;

  const { data: staffRows } = await supabase.from('admin_users').select('id, full_name').in('id', staffIds);
  const nameMap = new Map((staffRows || []).map((s: any) => [s.id, s.full_name]));
  return rows.map((r) => ({ ...r, actorName: r.staff_id ? nameMap.get(r.staff_id) : undefined }));
}

export async function addActivityNote(enquiryId: string, staffId: string, content: string): Promise<void> {
  const { error } = await supabase.from('enquiry_activity_log').insert({
    enquiry_id: enquiryId,
    staff_id: staffId,
    type: 'note',
    content,
  });
  if (error) throw error;
}

export function subscribeToActivityLog(enquiryId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`ops:activity:${enquiryId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'enquiry_activity_log', filter: `enquiry_id=eq.${enquiryId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// LOCATIONS (admin) — the destination presets the client intake wizard's
// step 2 reads from (migration 0013). Plain admin-only RLS, no RPCs needed.
// ============================================================================

export async function fetchAllLocations(): Promise<LocationRow[]> {
  const { data, error } = await supabase.from('locations').select('*').order('display_order', { ascending: true });
  if (error) throw error;
  return (data as LocationRow[]) || [];
}

export async function createLocation(input: { name: string; region?: string; image_url?: string; display_order?: number }): Promise<void> {
  const { error } = await supabase.from('locations').insert({
    name: input.name,
    region: input.region || null,
    image_url: input.image_url || null,
    display_order: input.display_order ?? 0,
  });
  if (error) throw error;
}

export async function updateLocation(id: string, patch: Partial<Pick<LocationRow, 'name' | 'region' | 'image_url' | 'display_order' | 'is_active'>>): Promise<void> {
  const { error } = await supabase.from('locations').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteLocation(id: string): Promise<void> {
  const { error } = await supabase.from('locations').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// GUESTS (staff read/manage) — real RLS (admin full access; assigned
// planner scoped to their own enquiries), unlike the client app's RPC-gated
// anon access. See migration 0013.
// ============================================================================

export async function fetchGuestsForEnquiryStaff(enquiryId: string): Promise<GuestRow[]> {
  const { data, error } = await supabase.from('guests').select('*').eq('enquiry_id', enquiryId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data as GuestRow[]) || [];
}

export function subscribeToGuestsStaff(enquiryId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`ops:guests:${enquiryId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: `enquiry_id=eq.${enquiryId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================================
// VENDOR LISTINGS (migration 0015)
//
// Reads and simple field updates go straight through PostgREST — RLS already
// scopes them (a sales agent sees every listing but can only write their own,
// and only while it's a draft or rejected). The three things RLS *can't*
// express — status transitions, the completeness check, and the publish-time
// mirror write — go through the SECURITY DEFINER RPCs instead.
// ============================================================================

export async function createVendorListing(
  category: ListingCategory,
  name: string,
  applicationId?: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc('create_vendor_listing', {
    p_category: category,
    p_name: name,
    p_application_id: applicationId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchMyListings(salesmanId: string): Promise<VendorListing[]> {
  const { data, error } = await supabase
    .from('vendor_listings')
    .select('*')
    .eq('owner_salesman_id', salesmanId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as VendorListing[]) || [];
}

// One round trip for the whole editor. Five parallel queries rather than one
// nested select: PostgREST's embedded resources can't be ordered per-child
// independently, and the editor needs each child list in its own `position`
// order.
export async function fetchListingBundle(listingId: string): Promise<ListingBundle> {
  const [listing, media, spaces, rooms, packages] = await Promise.all([
    supabase.from('vendor_listings').select('*').eq('id', listingId).single(),
    supabase.from('vendor_listing_media').select('*').eq('listing_id', listingId).order('position'),
    supabase.from('vendor_listing_spaces').select('*').eq('listing_id', listingId).order('position'),
    supabase.from('vendor_listing_rooms').select('*').eq('listing_id', listingId).order('position'),
    supabase.from('vendor_listing_packages').select('*').eq('listing_id', listingId).order('position'),
  ]);
  if (listing.error) throw listing.error;
  if (media.error) throw media.error;
  if (spaces.error) throw spaces.error;
  if (rooms.error) throw rooms.error;
  if (packages.error) throw packages.error;

  return {
    listing: listing.data as VendorListing,
    media: (media.data as ListingMedia[]) || [],
    spaces: (spaces.data as ListingSpace[]) || [],
    rooms: (rooms.data as ListingRoom[]) || [],
    packages: (packages.data as ListingPackage[]) || [],
  };
}

// Sending the whole row back is fine even though it contains admin-only
// columns: the guard trigger in 0015 silently preserves badges/rating/
// sort_weight for non-admins rather than rejecting the write, which is
// exactly why it preserves rather than raises.
export async function updateVendorListing(
  listingId: string,
  patch: Partial<VendorListing>
): Promise<VendorListing> {
  const { data, error } = await supabase
    .from('vendor_listings')
    .update(patch)
    .eq('id', listingId)
    .select()
    .single();
  if (error) throw error;
  return data as VendorListing;
}

export async function submitVendorListing(listingId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_vendor_listing', { p_listing_id: listingId });
  if (error) throw error;
}

export async function deleteVendorListing(listingId: string): Promise<void> {
  const { error } = await supabase.from('vendor_listings').delete().eq('id', listingId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// AVAILABILITY (migration 0022) — the salesman-owned calendar. Deliberately
// NOT part of the generic child-row helper below: writes here aren't gated
// by listing status the way spaces/rooms/packages are (see the migration's
// header for why), so this can't share that helper's assumptions.
// ---------------------------------------------------------------------------

export async function fetchListingAvailability(listingId: string): Promise<ListingAvailability[]> {
  const { data, error } = await supabase
    .from('vendor_listing_availability')
    .select('*')
    .eq('listing_id', listingId)
    .order('date');
  if (error) throw error;
  return (data as ListingAvailability[]) || [];
}

// One call sets one status across many dates — the "mark this whole year
// available" button and a parsed CSV both funnel through this, grouped by
// status client-side, rather than one round trip per date.
export async function setVendorAvailability(
  listingId: string,
  dates: string[],
  status: AvailabilityStatus,
  isAuspicious = false
): Promise<void> {
  if (dates.length === 0) return;
  const { error } = await supabase.rpc('set_vendor_availability', {
    p_listing_id: listingId,
    p_dates: dates,
    p_status: status,
    p_is_auspicious: isAuspicious,
  });
  if (error) throw error;
}

export async function deleteAvailabilityDates(listingId: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const { error } = await supabase
    .from('vendor_listing_availability')
    .delete()
    .eq('listing_id', listingId)
    .in('date', dates);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Child rows (spaces / rooms / packages). Generic over the three tables —
// they differ only in their columns, and three near-identical copies of this
// is how one of them ends up not saving `position`.
// ---------------------------------------------------------------------------
export type ListingChildTable =
  | 'vendor_listing_spaces'
  | 'vendor_listing_rooms'
  | 'vendor_listing_packages';

export async function addListingChild<T>(
  table: ListingChildTable,
  listingId: string,
  row: Record<string, unknown>,
  position: number
): Promise<T> {
  const { data, error } = await supabase
    .from(table)
    .insert({ ...row, listing_id: listingId, position })
    .select()
    .single();
  if (error) throw error;
  return data as T;
}

export async function updateListingChild<T>(
  table: ListingChildTable,
  id: string,
  patch: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as T;
}

export async function deleteListingChild(table: ListingChildTable, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// LISTING REVIEW (admin)
//
// Approve/reject and badge assignment both go through SECURITY DEFINER RPCs,
// not table writes: approving also has to generate the slug and write the
// mirror row into venues/vendors, and badges are blocked for everyone by the
// guard trigger regardless of role — the RPC is the only door.
// ---------------------------------------------------------------------------

export async function fetchListingsByStatus(status?: ListingStatus): Promise<VendorListing[]> {
  let q = supabase.from('vendor_listings').select('*');
  if (status) q = q.eq('status', status);
  const { data, error } = await q
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as VendorListing[]) || [];
}

export async function reviewVendorListing(
  listingId: string,
  approve: boolean,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc('review_vendor_listing', {
    p_listing_id: listingId,
    p_approve: approve,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export interface MerchandisingInput {
  badges?: ListingBadge[];
  is_partner?: boolean;
  offer_text?: string | null;
  sort_weight?: number;
}

export async function setListingMerchandising(
  listingId: string,
  input: MerchandisingInput
): Promise<void> {
  const { error } = await supabase.rpc('set_vendor_listing_merchandising', {
    p_listing_id: listingId,
    p_badges: input.badges ?? null,
    p_is_partner: input.is_partner ?? null,
    p_offer_text: input.offer_text ?? null,
    p_sort_weight: input.sort_weight ?? null,
  });
  if (error) throw error;
}

// The review queue should light up the moment an agent submits — 0015 adds
// vendor_listings to the supabase_realtime publication for exactly this.
export function subscribeToListings(onChange: () => void): () => void {
  const channel = supabase
    .channel('ops:vendor_listings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_listings' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// Take a live listing off the public site and hand it back to its agent with
// a reason. Deactivates the venues/vendors mirror row in the same
// transaction — see 0018 for why that ordering isn't optional.
export async function unpublishVendorListing(listingId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('unpublish_vendor_listing', {
    p_listing_id: listingId,
    p_reason: reason,
  });
  if (error) throw error;
}

// Admin delete for any listing, at any status. Removes the mirror row too;
// without that the venue stays live on the client site with its listing gone.
export async function adminDeleteVendorListing(listingId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_vendor_listing', { p_listing_id: listingId });
  if (error) throw error;
}

// Cover images for a set of listings, for the review queue's cards. Only
// `role = 'cover'` is fetched rather than all media: a queue of 20 venues
// with 30 photos each would otherwise pull 600 rows to show 20 thumbnails.
// Every route that creates media assigns a cover (the editor promotes the
// first upload, bulk import promotes the first file, deleting a cover
// promotes a replacement), so a listing without one is rare and falls back
// to a placeholder rather than a second query.
export async function fetchCoversForListings(
  listingIds: string[]
): Promise<Map<string, ListingMedia>> {
  if (listingIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('vendor_listing_media')
    .select('*')
    .in('listing_id', listingIds)
    .eq('role', 'cover')
    .order('position');
  if (error) throw error;

  // First row per listing wins. Ordering by position matters because a bug in
  // an earlier version of the uploader marked every photo of the first batch
  // as the cover; without an explicit order those listings would show a
  // different thumbnail depending on which row the database returned first.
  const covers = new Map<string, ListingMedia>();
  for (const m of (data as ListingMedia[]) || []) {
    if (!covers.has(m.listing_id)) covers.set(m.listing_id, m);
  }
  return covers;
}

// How many photos each listing has — shown on the queue card, because "this
// venue has one photo" is a reason to send it back and it shouldn't take
// opening the listing to find that out.
export async function fetchMediaCounts(listingIds: string[]): Promise<Map<string, number>> {
  if (listingIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('vendor_listing_media')
    .select('listing_id')
    .in('listing_id', listingIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of (data as { listing_id: string }[]) || []) {
    counts.set(row.listing_id, (counts.get(row.listing_id) ?? 0) + 1);
  }
  return counts;
}
