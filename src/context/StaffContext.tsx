import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChange, fetchMyStaffProfile, signOut as authSignOut } from '../lib/auth';
import { StaffProfile } from '../types';

interface StaffContextValue {
  staff: StaffProfile | null;
  isSignedIn: boolean;
  checkingAuth: boolean;
  // true once we know the auth session is real but there is no matching,
  // active `staff` row — i.e. this account exists but hasn't been granted
  // a workspace yet.
  notProvisioned: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const StaffContext = createContext<StaffContextValue | null>(null);

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [notProvisioned, setNotProvisioned] = useState(false);

  const refresh = useCallback(async () => {
    const profile = await fetchMyStaffProfile();
    setStaff(profile);
    setNotProvisioned(!profile);
  }, []);

  useEffect(() => {
    let firstFire = true;
    const unsubscribe = onAuthStateChange(async (session) => {
      setIsSignedIn(!!session);
      if (session) {
        await refresh();
      } else {
        setStaff(null);
        setNotProvisioned(false);
      }
      if (firstFire) {
        firstFire = false;
        setCheckingAuth(false);
      }
    });
    return unsubscribe;
  }, [refresh]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setStaff(null);
  }, []);

  return (
    <StaffContext.Provider value={{ staff, isSignedIn, checkingAuth, notProvisioned, signOut, refresh }}>
      {children}
    </StaffContext.Provider>
  );
}

export function useStaff(): StaffContextValue {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error('useStaff must be used within StaffProvider');
  return ctx;
}
