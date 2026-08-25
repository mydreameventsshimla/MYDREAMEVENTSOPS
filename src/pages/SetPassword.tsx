import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setMyPassword, fetchMyStaffProfile, updateMyProfile } from '../lib/auth';
import { useStaff } from '../context/StaffContext';
import { StaffProfile } from '../types';

// Landing page for both invite links and "forgot password" links.
// supabase-js has already turned the link's token into a temporary signed-in
// session by the time this component mounts (detectSessionInUrl, on by
// default) — so the admin_users row this session belongs to is already
// readable here, before a password has even been set.
//
// That's what this form is really for: an invite is filled in by an admin
// on someone else's behalf (0018/AdminTeam), so the name on the row is
// whatever the admin typed and may have a typo the invitee never got a
// chance to catch, and — for managers specifically — the WhatsApp number
// the client app's "My Planner" tab (0019) depends on doesn't exist at all
// yet. Asking for both right here, once, at the moment they're setting up
// their own login, means neither is an admin's problem to chase down after
// the fact.
export const SetPassword: React.FC = () => {
  const { refresh } = useStaff();
  const navigate = useNavigate();

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profile, setProfile] = useState<StaffProfile | null>(null);

  const [fullName, setFullName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchMyStaffProfile().then((p) => {
      setProfile(p);
      if (p) {
        setFullName(p.full_name);
        setWhatsapp(p.whatsapp_number ?? '');
      }
      setLoadingProfile(false);
    });
  }, []);

  // Required only for managers, and only when the row doesn't already have
  // one — a manager resetting a forgotten password who already set theirs
  // isn't asked again. Admins and sales agents never get assigned an
  // enquiry (see 0012's claim/assignment RLS), so nothing in the client app
  // ever needs their WhatsApp number, and this form doesn't hold their
  // password reset hostage to a field they have no use for.
  const whatsappRequired = profile?.role === 'manager' && !profile?.whatsapp_number;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Your name can’t be blank.');
      return;
    }
    if (whatsappRequired && !whatsapp.trim()) {
      setError('Add a WhatsApp number — couples use it to reach you directly once you’re assigned a lead.');
      return;
    }
    if (whatsapp.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(whatsapp.trim())) {
      setError('That doesn’t look like a phone number — digits, spaces, and an optional leading + only.');
      return;
    }
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
      // Profile first: if the password step below succeeds but this one
      // silently didn't, the person is signed in with no way back to this
      // one-time form to finish it. Failing loud here, before the
      // irreversible step, is the safer order.
      if (profile) {
        await updateMyProfile({ full_name: fullName.trim(), whatsapp_number: whatsapp.trim() });
      }
      await setMyPassword(password);
      await refresh();
      setDone(true);
      setTimeout(() => navigate('/'), 1200);
    } catch (err: any) {
      setError(err?.message || 'Could not save that. The link may have expired — ask an admin to resend the invite.');
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
          <p className="text-slate-500 text-sm">
            {profile ? 'Check your details, then set a password.' : 'Set a password. You’ll use it with your email to sign in from now on.'}
          </p>
        </div>

        {done ? (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm px-4 py-3 rounded-xl text-center">
            Saved — taking you to your workspace…
          </div>
        ) : loadingProfile ? (
          <p className="text-center text-sm text-slate-400 py-4">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {profile && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Your Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="As you'd like it shown to the team"
                    className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 ml-1">Whoever invited you may have typed this in a hurry — fix it if it's wrong.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                    WhatsApp Number{whatsappRequired && <span className="text-rose-500"> *</span>}
                  </label>
                  <input
                    type="tel"
                    required={whatsappRequired}
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 ml-1">
                    {profile.role === 'manager'
                      ? 'Couples chat with you here once they’re assigned to you — this is not shown publicly.'
                      : 'Optional for your role today. Not shown publicly.'}
                  </p>
                </div>
              </>
            )}

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
              {submitting ? 'Saving…' : 'Save & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
