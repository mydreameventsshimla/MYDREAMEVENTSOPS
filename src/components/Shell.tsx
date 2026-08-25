import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStaff } from '../context/StaffContext';
import { StaffRole } from '../types';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_BY_ROLE: Record<StaffRole, NavItem[]> = {
  manager: [
    { path: '/manager', label: 'Lead Pipeline', icon: 'contact_page' },
    { path: '/manager/clients', label: 'My Clients', icon: 'groups' },
    { path: '/manager/analytics', label: 'My Performance', icon: 'analytics' },
  ],
  admin: [
    { path: '/admin', label: 'Overview', icon: 'space_dashboard' },
    { path: '/admin/enquiries', label: 'All Enquiries', icon: 'inbox' },
    { path: '/admin/managers', label: 'Managers', icon: 'badge' },
    { path: '/admin/vendors', label: 'Vendors', icon: 'storefront' },
    { path: '/admin/salesteam', label: 'Sales Team', icon: 'group' },
    { path: '/admin/locations', label: 'Locations', icon: 'add_location_alt' },
    { path: '/admin/team', label: 'Team & Invites', icon: 'person_add' },
  ],
  salesman: [
    { path: '/salesman', label: 'My Targets', icon: 'assignment_ind' },
    { path: '/salesman/onboard', label: 'Add Vendor', icon: 'add_business' },
    { path: '/salesman/listings', label: 'Vendor Listings', icon: 'storefront' },
    { path: '/salesman/import', label: 'Bulk Import', icon: 'upload_file' },
    { path: '/salesman/pipeline', label: 'My Pipeline', icon: 'trending_up' },
  ],
};

const ROLE_LABEL: Record<StaffRole, string> = {
  manager: 'MANAGER',
  admin: 'ADMIN',
  salesman: 'SALES AGENT',
};

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { staff, signOut } = useStaff();
  if (!staff) return null;
  const navItems = NAV_BY_ROLE[staff.role];

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-[#1e293b] z-50 flex flex-col shadow-xl">
      <div className="px-6 py-7 flex flex-col gap-2 border-b border-white/10">
        <span className="font-geist font-semibold text-white tracking-[0.15em] uppercase text-sm">MyDreamEvents</span>
        <span className="w-fit bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded tracking-widest">
          {ROLE_LABEL[staff.role]}
        </span>
      </div>
      <nav className="flex-1 px-3 mt-4 space-y-1">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center px-4 py-3 rounded-xl transition-all duration-200 ${
                active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined mr-3 text-[20px]">{item.icon}</span>
              <span className="font-geist text-sm font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 mt-auto space-y-3">
        <div className="bg-white/10 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-white text-[18px]">person</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-white text-sm font-semibold truncate">{staff.full_name}</span>
            <span className="text-white/50 text-[11px] truncate">{staff.email}</span>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 text-white/60 hover:text-white text-xs font-semibold py-2 rounded-lg hover:bg-white/5 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">logout</span> Sign out
        </button>
      </div>
    </aside>
  );
};

export const TopHeader: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode }> = ({
  title,
  subtitle,
  right,
}) => (
  <header className="fixed top-0 left-64 right-0 h-16 bg-white/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex items-center justify-between px-8">
    <div>
      <h1 className="font-geist font-semibold text-[#1e293b] text-lg leading-none">{title}</h1>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
    <div className="flex items-center gap-4">{right}</div>
  </header>
);

export const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pl-64 min-h-screen bg-[#F8FAFC]">{children}</div>
);

export const Main: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main className="pt-16 px-8 py-8 space-y-8">{children}</main>
);

// A simple centered overlay modal shared by the staff-performance and
// enquiry-detail popups. Click the backdrop or the × to close.
// `xl` is for the listing review modal specifically: it renders a full
// vendor profile — a 16:7 cover, a gallery grid, hall and room tables — and
// at `wide`'s max-w-2xl those collapse into something an admin can't
// actually judge the listing from.
export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  xl?: boolean;
}> = ({
  title,
  onClose,
  children,
  wide,
  xl,
}) => (
  <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
    <div
      className={`bg-white rounded-2xl shadow-2xl w-full ${xl ? 'max-w-5xl' : wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <h2 className="font-geist font-semibold text-lg">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </div>
  </div>
);

export const StatTile: React.FC<{ label: string; value: React.ReactNode; tone?: 'default' | 'dark'; icon?: string }> = ({
  label,
  value,
  tone = 'default',
  icon,
}) => (
  <div
    className={`p-6 rounded-xl shadow-sm border h-32 flex flex-col justify-between ${
      tone === 'dark' ? 'bg-[#1e293b] border-[#1e293b] text-white' : 'bg-white border-slate-100 text-[#1e293b]'
    }`}
  >
    <div className="flex items-center justify-between">
      <span className={`text-[10px] font-bold uppercase tracking-widest ${tone === 'dark' ? 'text-white/60' : 'text-slate-400'}`}>
        {label}
      </span>
      {icon && <span className="material-symbols-outlined text-[18px] opacity-50">{icon}</span>}
    </div>
    <span className="text-3xl font-geist font-bold">{value}</span>
  </div>
);

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600',
  contacted: 'bg-amber-50 text-amber-600',
  qualified: 'bg-violet-50 text-violet-600',
  proposal_sent: 'bg-orange-50 text-orange-600',
  won: 'bg-emerald-50 text-emerald-600',
  lost: 'bg-red-50 text-red-500',
  assigned: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-amber-50 text-amber-600',
  negotiating: 'bg-orange-50 text-orange-600',
  onboarded: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-500'}`}>
    {status.replace('_', ' ')}
  </span>
);
