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
  };
}

export async function fetchStaffRoster(role?: StaffRole): Promise<StaffProfile[]> {
  let query = supabase
    .from('admin_users')
    .select('id, full_name, email, role, is_active')
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

async function callApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
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

export async function inviteStaffMember(input: { email: string; full_name: string; role: StaffRole }): Promise<void> {
  await callApi('/api/invite-staff', input);
}

export async function setStaffActive(staffId: string, isActive: boolean): Promise<void> {
  await callApi('/api/deactivate-staff', { staffId, isActive });
}

export async function fetchFullStaffRoster(): Promise<StaffProfile[]> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, full_name, email, role, is_active')
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
