import React, { useEffect, useState } from 'react';
import { Page, Main, TopHeader } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import { updateMyProfile } from '../../lib/auth';
import { COUNTRY_CODES, MIN_DIGITS_BY_CODE, splitPhoneNumber } from '../../data/countryCodes';

// SetPassword.tsx asks for name/WhatsApp/Meet link exactly once, at
// account setup. This is that same form, reachable any time after — so a
// manager who skipped the video link initially (or just gets a new Meet
// room) isn't stuck re-triggering a password reset to fix it.
export const ManagerProfile: React.FC = () => {
  const { staff, refresh } = useStaff();

  const [fullName, setFullName] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('+91');
  const [whatsappDigits, setWhatsappDigits] = useState('');
  const [meetLink, setMeetLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!staff) return;
    setFullName(staff.full_name);
    const { code, digits } = splitPhoneNumber(staff.whatsapp_number);
    setWhatsappCode(code);
    setWhatsappDigits(digits);
    setMeetLink(staff.meet_link ?? '');
  }, [staff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!fullName.trim()) {
      setError('Your name can’t be blank.');
      return;
    }
    const digitsOnly = whatsappDigits.replace(/\D/g, '');
    if (digitsOnly && digitsOnly.length < (MIN_DIGITS_BY_CODE[whatsappCode] || 8)) {
      setError(`That doesn’t look like a valid ${whatsappCode} number.`);
      return;
    }
    if (meetLink.trim() && !meetLink.trim().startsWith('https://')) {
      setError('Your video call link needs to start with https://');
      return;
    }

    setSaving(true);
    try {
      const whatsappNumber = digitsOnly ? `${whatsappCode}${digitsOnly}` : null;
      await updateMyProfile({ full_name: fullName.trim(), whatsapp_number: whatsappNumber, meet_link: meetLink.trim() || null });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || 'Could not save that — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <TopHeader title="My Profile" subtitle="How couples reach you once they're assigned to you" />
      <Main>
        <form onSubmit={handleSubmit} className="max-w-lg bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Your Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">WhatsApp Number</label>
            <div className="flex gap-2">
              <select
                value={whatsappCode}
                onChange={(e) => setWhatsappCode(e.target.value)}
                className="p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none w-[120px] shrink-0"
              >
                {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <input
                type="tel"
                inputMode="numeric"
                value={whatsappDigits}
                onChange={(e) => setWhatsappDigits(e.target.value)}
                placeholder="98765 43210"
                className="flex-1 min-w-0 p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 ml-1">Powers the "Chat on WhatsApp" and call buttons on your clients' dashboards.</p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Video Call Link</label>
            <input
              type="url"
              value={meetLink}
              onChange={(e) => setMeetLink(e.target.value)}
              placeholder="https://meet.google.com/your-room"
              className="w-full p-4 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <p className="text-[11px] text-slate-400 ml-1">A standing Google Meet or Zoom room. The "Video call" button opens this directly.</p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {saved && <p className="text-sm text-emerald-600">Saved.</p>}

          <button
            type="submit"
            disabled={saving}
            className="bg-[#1e293b] text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </Main>
    </Page>
  );
};
