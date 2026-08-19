// The ops-portal UI/routes speak 'admin' | 'manager' | 'salesman' (matches
// the three workspaces and URL paths). Your database's admin_users.role
// check constraint speaks 'admin' | 'planner' | 'sales'. This is the one
// place that translation happens — everything else in the app only ever
// deals with the app-level names.
export type AppStaffRole = 'admin' | 'manager' | 'salesman';
export type DbStaffRole = 'admin' | 'planner' | 'sales';

export const APP_TO_DB_ROLE: Record<AppStaffRole, DbStaffRole> = {
  admin: 'admin',
  manager: 'planner',
  salesman: 'sales',
};

export const DB_TO_APP_ROLE: Record<DbStaffRole, AppStaffRole> = {
  admin: 'admin',
  planner: 'manager',
  sales: 'salesman',
};
