import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { StaffProvider, useStaff } from './context/StaffContext';
import { AuthGateway } from './pages/AuthGateway';
import { SetPassword } from './pages/SetPassword';
import { Sidebar } from './components/Shell';
import { StaffRole } from './types';

import { ManagerPipeline } from './pages/manager/ManagerPipeline';
import { ManagerClients } from './pages/manager/ManagerClients';
import { EventWorkspace } from './pages/manager/EventWorkspace';
import { ClientHistory } from './pages/manager/ClientHistory';
import { ManagerProfile } from './pages/manager/ManagerProfile';

import { AdminOverviewPage } from './pages/admin/AdminOverview';
import { AdminEnquiries } from './pages/admin/AdminEnquiries';
import { AdminManagers } from './pages/admin/AdminManagers';
import { AdminSalesTeam } from './pages/admin/AdminSalesTeam';
import { AdminLocations } from './pages/admin/AdminLocations';
import { AdminTeam } from './pages/admin/AdminTeam';
import { AdminVendors } from './pages/admin/AdminVendors';

import { SalesmanTargets } from './pages/salesman/SalesmanTargets';
import { SalesmanOnboard } from './pages/salesman/SalesmanOnboard';
import { SalesmanPipeline } from './pages/salesman/SalesmanPipeline';
import { SalesmanListings } from './pages/salesman/SalesmanListings';
import { ListingEditor } from './pages/salesman/ListingEditor';
import { BulkImport } from './pages/salesman/BulkImport';

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50">
    <div className="flex flex-col items-center gap-3 text-slate-400">
      <span className="material-symbols-outlined text-3xl animate-pulse">hourglass_top</span>
      <span className="text-sm">Checking your session…</span>
    </div>
  </div>
);

// Every route below is only ever reachable if the signed-in staff row's
// role matches — a manager hitting /admin gets redirected to their own
// workspace instead of the admin UI silently rendering with empty data.
// RLS on the backend is the real enforcement; this is the UX layer on
// top of it.
const RoleGuard: React.FC<{ allow: StaffRole; children: React.ReactNode }> = ({ allow, children }) => {
  const { staff } = useStaff();
  if (!staff) return <Navigate to="/" replace />;
  if (staff.role !== allow) return <Navigate to={`/${staff.role}`} replace />;
  return <>{children}</>;
};

// Everything except /set-password lives behind this: checking session,
// then routing by role. /set-password is deliberately OUTSIDE this gate —
// an invited person already has a `staff` row (created at invite time) but
// hasn't set a password yet, so if this gate applied there it would just
// bounce them straight into a workspace they can't get back to without a
// password.
const GatedApp: React.FC = () => {
  const { staff, checkingAuth, isSignedIn, notProvisioned } = useStaff();

  if (checkingAuth) return <LoadingScreen />;
  if (!isSignedIn || notProvisioned || !staff) return <AuthGateway />;

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <Sidebar />
      <Routes>
        <Route path="/" element={<Navigate to={`/${staff.role}`} replace />} />

        <Route path="/manager" element={<RoleGuard allow="manager"><ManagerPipeline /></RoleGuard>} />
        <Route path="/manager/clients" element={<RoleGuard allow="manager"><ManagerClients /></RoleGuard>} />
        <Route path="/manager/event/:enquiryId" element={<RoleGuard allow="manager"><EventWorkspace /></RoleGuard>} />
        <Route path="/manager/history/:enquiryId" element={<RoleGuard allow="manager"><ClientHistory /></RoleGuard>} />
        <Route path="/manager/analytics" element={<RoleGuard allow="manager"><ManagerClients /></RoleGuard>} />
        <Route path="/manager/profile" element={<RoleGuard allow="manager"><ManagerProfile /></RoleGuard>} />

        <Route path="/admin" element={<RoleGuard allow="admin"><AdminOverviewPage /></RoleGuard>} />
        <Route path="/admin/enquiries" element={<RoleGuard allow="admin"><AdminEnquiries /></RoleGuard>} />
        <Route path="/admin/managers" element={<RoleGuard allow="admin"><AdminManagers /></RoleGuard>} />
        <Route path="/admin/vendors" element={<RoleGuard allow="admin"><AdminVendors /></RoleGuard>} />
        {/* Old bookmarks for the separate Listing Review screen still land
            somewhere sensible now that the two are one page. */}
        <Route path="/admin/listings" element={<Navigate to="/admin/vendors" replace />} />
        <Route path="/admin/salesteam" element={<RoleGuard allow="admin"><AdminSalesTeam /></RoleGuard>} />
        <Route path="/admin/locations" element={<RoleGuard allow="admin"><AdminLocations /></RoleGuard>} />
        <Route path="/admin/team" element={<RoleGuard allow="admin"><AdminTeam /></RoleGuard>} />

        <Route path="/salesman" element={<RoleGuard allow="salesman"><SalesmanTargets /></RoleGuard>} />
        <Route path="/salesman/onboard" element={<RoleGuard allow="salesman"><SalesmanOnboard /></RoleGuard>} />
        <Route path="/salesman/pipeline" element={<RoleGuard allow="salesman"><SalesmanPipeline /></RoleGuard>} />
        <Route path="/salesman/listings" element={<RoleGuard allow="salesman"><SalesmanListings /></RoleGuard>} />
        <Route path="/salesman/listing/:listingId" element={<RoleGuard allow="salesman"><ListingEditor /></RoleGuard>} />
        <Route path="/salesman/import" element={<RoleGuard allow="salesman"><BulkImport /></RoleGuard>} />

        <Route path="*" element={<Navigate to={`/${staff.role}`} replace />} />
      </Routes>
    </div>
  );
};

export default function App() {
  return (
    <StaffProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/*" element={<GatedApp />} />
        </Routes>
      </BrowserRouter>
    </StaffProvider>
  );
}
