import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, Main, TopHeader } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import { submitVendorApplication } from '../../lib/api';
import { VendorApplicationRole } from '../../types';

const ROLES: VendorApplicationRole[] = ['Venue', 'Decor', 'Sound', 'Lens', 'Henna', 'Face', 'Film', 'Full Planning'];

export const SalesmanOnboard: React.FC = () => {
  const { staff } = useStaff();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    applicant_name: '',
    role: 'Venue' as VendorApplicationRole,
    portfolio_url: '',
    story: '',
    city: '',
    email: '',
  });

  const reset = () => {
    setForm({ applicant_name: '', role: 'Venue', portfolio_url: '', story: '', city: '', email: '' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff) return;
    setSubmitting(true);
    setDone(false);
    setError(null);
    try {
      await submitVendorApplication(staff.id, form);
      reset();
      setDone(true);
    } catch (err) {
      // Without this the submit failed completely silently: the button
      // just stopped spinning and the agent had no idea whether the lead
      // was saved. An RLS rejection here reads as "nothing happened",
      // which is the worst possible outcome for someone standing in a
      // hotel lobby with the owner waiting.
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <TopHeader title="Add Vendor" subtitle="Quick capture — for when you don't have the full details yet" />
      <Main>
        {/* Two entry points exist and people kept assuming a vendor has to
            pass through both. It doesn't: this form is the fast path for a
            lead you can't fully document yet, and the full profile can be
            started directly with no application at all. Saying so here is
            cheaper than everyone learning it by asking. */}
        <div className="max-w-2xl bg-sky-50 border border-sky-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
          <span className="material-symbols-outlined text-sky-500 text-[20px] mt-px">info</span>
          <div className="text-sm text-sky-900 space-y-2">
            <p>
              <strong className="font-semibold">Use this when you're short on time</strong> — a name and a phone
              number in the lobby. An admin decides whether we work with them, and then you build the full
              profile afterwards.
            </p>
            <p>
              <strong className="font-semibold">Already have everything?</strong> Skip this form.{' '}
              <Link to="/salesman/listings" className="underline font-semibold hover:text-sky-700">
                Start the full profile directly
              </Link>{' '}
              — it goes straight to one admin review, not two.
            </p>
          </div>
        </div>

        <div className="max-w-2xl bg-white rounded-3xl shadow-sm border border-slate-100 p-10 space-y-8">
          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] mt-px">error</span>
              <span>
                <strong className="font-semibold">Could not save this lead.</strong> {error}
              </span>
            </div>
          )}

          {done && (
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">check_circle</span> Submitted — waiting on admin approval.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 uppercase tracking-wider text-xs">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as VendorApplicationRole })}
                className="w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <Field label="Vendor / Business Name" value={form.applicant_name} onChange={(v) => setForm({ ...form, applicant_name: v })} required />
            <div className="grid grid-cols-2 gap-6">
              <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
            </div>
            <Field label="Portfolio URL" value={form.portfolio_url} onChange={(v) => setForm({ ...form, portfolio_url: v })} />
            <TextArea label="Story / Notes" value={form.story} onChange={(v) => setForm({ ...form, story: v })} />
            <SubmitButton submitting={submitting} />
          </form>
        </div>
      </Main>
    </Page>
  );
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string; type?: string }> = ({
  label, value, onChange, required, placeholder, type = 'text',
}) => (
  <div className="space-y-2">
    <label className="text-sm font-semibold text-slate-700 uppercase tracking-wider text-xs">{label}</label>
    <input
      type={type}
      required={required}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
    />
  </div>
);

const TextArea: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div className="space-y-2">
    <label className="text-sm font-semibold text-slate-700 uppercase tracking-wider text-xs">{label}</label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className="w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all resize-none"
    />
  </div>
);

const SubmitButton: React.FC<{ submitting: boolean }> = ({ submitting }) => (
  <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
    <button disabled={submitting} type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white px-10 py-4 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 transition-all disabled:opacity-60">
      {submitting ? 'Submitting…' : 'Submit for Approval'}
      <span className="material-symbols-outlined">arrow_forward</span>
    </button>
  </div>
);

// Supabase errors arrive as PostgrestError ({ message, code, details }),
// never as an Error instance, so `err.message` alone would render
// "[object Object]" for the exact failures worth reading. RLS rejections
// (42501) get a plain-language translation -- an agent can act on "ask an
// admin", they can't act on "new row violates row-level security policy".
function errorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  if (e?.code === '42501') return 'Your account does not have permission to add vendors. Ask an admin to check your access.';
  if (e?.code === '23514') return 'One of the values was rejected by the database. Check the Role field and try again.';
  if (e?.message) return e.message;
  return 'Unexpected error. Please try again.';
}
