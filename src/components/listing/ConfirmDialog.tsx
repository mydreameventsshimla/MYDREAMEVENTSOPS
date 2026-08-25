import React, { useState } from 'react';

// A confirm dialog for actions that cannot be undone.
//
// `confirmPhrase` exists for the genuinely irreversible ones: deleting a
// listing takes its photos out of Cloudinary too, so there is nothing left to
// restore from. Making someone type the listing's name turns a misplaced
// click into a deliberate act — worth the friction exactly once, on delete,
// and nowhere else.

interface Props {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmPhrase?: string;
  // Rendered between the body and the confirm phrase — for a decision that
  // belongs to this action rather than a separate dialog after it.
  extra?: React.ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({
  title, body, confirmLabel, confirmPhrase, extra, busy, onConfirm, onCancel,
}) => {
  const [typed, setTyped] = useState('');
  const armed = !confirmPhrase || typed.trim().toLowerCase() === confirmPhrase.trim().toLowerCase();

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-rose-500 text-[22px] mt-px">warning</span>
          <div className="space-y-2">
            <h3 className="font-geist font-semibold text-slate-800">{title}</h3>
            <div className="text-sm text-slate-500 leading-relaxed">{body}</div>
          </div>
        </div>

        {extra}

        {confirmPhrase && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600">
              Type <span className="font-mono text-slate-800">{confirmPhrase}</span> to confirm
            </label>
            <input
              value={typed}
              autoFocus
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-400 outline-none text-sm"
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !armed}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
