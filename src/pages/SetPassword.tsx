import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setMyPassword } from '../lib/auth';
import { useStaff } from '../context/StaffContext';

// Landing page for both invite links and "forgot password" links.
// supabase-js has already turned the link's token into a temporary signed-in
// session by the time this component mounts (detectSessionInUrl, on by
// default) — all that's left is asking for a real password.
export const SetPassword: React.FC = () => {
  const { refresh } = useStaff();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await setMyPassword(password);
      await refresh();
      setDone(true);
      setTimeout(() => navigate('/'), 1200);
    } catch (err: any) {
      setError(err?.message || 'Could not set your password. The link may have expired — ask an admin to resend the invite.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 space-y-6 border border-slate-100">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-[#1e293b]">
            <span className="material-symbols-outlined text-4xl">lock_open</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-geist">Welcome to MyDreamEvents</h1>
          <p className="text-slate-500 text-sm">Set a password. You'll use it with your email to sign in from now on.</p>
        </div>

        {done ? (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm px-4 py-3 rounded-xl text-center">
            Password set — taking you to your workspace…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">New Password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Confirm Password</label>
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={submitting} className="w-full bg-[#1e293b] text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-60">
              {submitting ? 'Saving…' : 'Set Password & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
