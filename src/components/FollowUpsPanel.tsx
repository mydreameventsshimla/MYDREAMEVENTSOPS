import React, { useState } from 'react';
import { EnquiryTask } from '../types';
import { setTaskStatus } from '../lib/api';

// The pipeline's "overdue" stat has been a hardcoded 0 since it was
// built — this is the widget that finally gives it something real to
// count, and a way to act on it without opening every lead one by one.

interface Props {
  tasks: EnquiryTask[];
  clientNameByEnquiry: Map<string, string>;
  onOpenEnquiry: (enquiryId: string) => void;
  onChanged: () => void;
}

function formatDue(iso: string): { label: string; overdue: boolean } {
  const due = new Date(iso);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const overdue = diffMs < 0;
  if (overdue) {
    const daysAgo = Math.abs(diffDays);
    return { label: daysAgo === 0 ? 'Overdue — today' : `Overdue — ${daysAgo}d ago`, overdue: true };
  }
  if (diffDays === 0) return { label: 'Due today', overdue: false };
  if (diffDays === 1) return { label: 'Due tomorrow', overdue: false };
  return { label: `Due in ${diffDays}d`, overdue: false };
}

export const FollowUpsPanel: React.FC<Props> = ({ tasks, clientNameByEnquiry, onOpenEnquiry, onChanged }) => {
  const [completing, setCompleting] = useState<string | null>(null);
  const pending = tasks.filter((t) => t.status === 'pending');

  const handleComplete = async (taskId: string) => {
    setCompleting(taskId);
    try {
      await setTaskStatus(taskId, 'done');
      onChanged();
    } finally {
      setCompleting(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
      <h3 className="font-geist font-semibold text-sm flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-slate-400">task_alt</span>
        Follow-ups
      </h3>

      {pending.length === 0 && (
        <p className="text-xs text-slate-400 py-2">Nothing due — add a reminder from any lead's workspace.</p>
      )}

      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {pending.map((task) => {
          const due = formatDue(task.due_at);
          return (
            <div
              key={task.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg ${due.overdue ? 'bg-red-50' : 'hover:bg-slate-50'}`}
            >
              <button
                onClick={() => handleComplete(task.id)}
                disabled={completing === task.id}
                aria-label="Mark done"
                className="w-5 h-5 rounded-full border-2 border-slate-300 hover:border-emerald-500 shrink-0 mt-0.5 disabled:opacity-40"
              />
              <button onClick={() => onOpenEnquiry(task.enquiry_id)} className="flex-1 min-w-0 text-left">
                <p className="text-xs font-semibold text-slate-700 truncate">{task.title}</p>
                <p className="text-[10px] text-slate-400 truncate">
                  {clientNameByEnquiry.get(task.enquiry_id) || 'Unknown lead'}
                </p>
                <p className={`text-[10px] font-bold mt-0.5 ${due.overdue ? 'text-red-600' : 'text-slate-400'}`}>{due.label}</p>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
