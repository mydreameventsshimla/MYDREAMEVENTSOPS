import React from 'react';
import { EnquiryStatus } from '../types';

// Replaces a plain dropdown as the ONE place status lives on the
// workspace — a manager should see where a lead sits in the journey at a
// glance, not have to read a select box's current value. Lost is a
// separate dead-end badge, not a step on the happy path.
const STEPS: { id: EnquiryStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal_sent', label: 'Proposal Sent' },
  { id: 'won', label: 'Won' },
];

interface Props {
  status: EnquiryStatus;
  onChange: (status: EnquiryStatus) => void;
}

export const StatusStepper: React.FC<Props> = ({ status, onChange }) => {
  if (status === 'lost') {
    return (
      <div className="flex items-center gap-3">
        <span className="px-3 py-1.5 rounded-full text-xs font-bold uppercase bg-red-50 text-red-600">Lost</span>
        <button onClick={() => onChange('contacted')} className="text-xs text-slate-400 hover:text-slate-600 underline">
          Reopen as Contacted
        </button>
      </div>
    );
  }

  const currentIndex = STEPS.findIndex((s) => s.id === status);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <React.Fragment key={step.id}>
            {i > 0 && <div className={`h-px w-4 sm:w-8 ${isDone || isCurrent ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
            <button
              onClick={() => onChange(step.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                isCurrent
                  ? 'bg-[#1e293b] text-white'
                  : isDone
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
              }`}
            >
              {isDone && <span className="material-symbols-outlined text-[13px]">check</span>}
              {step.label}
            </button>
          </React.Fragment>
        );
      })}
      <button
        onClick={() => onChange('lost')}
        className="ml-2 text-[11px] text-slate-300 hover:text-red-500 underline"
      >
        Mark Lost
      </button>
    </div>
  );
};
