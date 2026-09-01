import React, { useState } from 'react';
import { Modal } from './Shell';
import { notifyClient } from '../lib/api';

interface Props {
  enquiryId: string;
  clientName: string;
  onClose: () => void;
}

// Pushes a real notification to the couple's phone (if they've installed
// the app and turned notifications on — see minimalist-muse's ProfileMenu
// toggle). Routes through server.ts/api/notify-client.ts, which is the
// only place that holds the shared secret this needs.
export const NotifyClientModal: React.FC<Props> = ({ enquiryId, clientName, onClose }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await notifyClient(enquiryId, title.trim(), body.trim());
      setResult(res);
    } catch (err: any) {
      setError(err?.message || 'Could not send that notification.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title={`Notify ${clientName}`} onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          {result.sent > 0 ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
              Delivered to {result.sent} device{result.sent === 1 ? '' : 's'}.
            </p>
          ) : (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-4">
              Sent, but this couple has not turned on notifications yet (or has not installed the app) — nothing was
              delivered.
            </p>
          )}
          <button onClick={onClose} className="w-full bg-[#1e293b] text-white py-3 rounded-xl text-sm font-bold hover:bg-slate-800">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSend} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Your venue visit is confirmed!"
              className="w-full p-3.5 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Tap to see the details we just confirmed."
              className="w-full p-3.5 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={sending || !title.trim() || !body.trim()}
            className="w-full bg-[#1e293b] text-white py-3 rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-60"
          >
            {sending ? 'Sending…' : 'Send Notification'}
          </button>
        </form>
      )}
    </Modal>
  );
};
