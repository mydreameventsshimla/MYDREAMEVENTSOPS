import React, { useState } from 'react';
import { signInWithPassword } from '../lib/auth';
import { useStaff } from '../context/StaffContext';

// Single login screen for all three roles — the account's `staff.role`
// (set by an admin, see migration 0010) decides where they land, not a
// choice made here. This is what keeps a manager from ever being able to
// self-select the admin workspace.
export const AuthGateway: React.FC = () => {
  const { notProvisioned, signOut } = useStaff();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden animate-fade-in border border-slate-100">
        <div className="p-8 pb-4 text-center space-y-2 border-b border-slate-50">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-[#1e293b]">
            <span className="material-symbols-outlined text-4xl">security</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-geist">MyDreamEvents</h1>
          <p className="text-slate-500 text-sm">Staff access for Managers, Admins &amp; Sales Agents.</p>
        </div>

        {notProvisioned ? (
          <div className="p-8 space-y-4 text-center">
            <p className="text-sm text-slate-600">
              This account is signed in but hasn't been granted a workspace yet. Ask an admin to add you to the{' '}
              <code className="bg-slate-100 px-1 rounded">staff</code> table with your role.
            </p>
            <button onClick={signOut} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
              Sign out and try a different account
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@wedplatform.com"
                  className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#1e293b] text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? 'Authenticating…' : 'Authenticate Session'}
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </form>
        )}

        <div className="p-6 bg-slate-50 text-center">
          <p className="text-[10px] text-slate-400 flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-sm">verified_user</span> Role-scoped access — each workspace only ever sees its own data.
          </p>
        </div>
      </div>
    </div>
  );
};
