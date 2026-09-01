import React, { useCallback, useEffect, useState } from 'react';
import { EnquiryTask } from '../types';
import { fetchTasksForEnquiry, createTask, setTaskStatus, subscribeToMyTasks } from '../lib/api';

interface Props {
  enquiryId: string;
  staffId: string;
}

function formatDue(iso: string): { label: string; overdue: boolean } {
  const due = new Date(iso);
  const overdue = due.getTime() < Date.now();
  return { label: due.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), overdue };
}

export const TasksPanel: React.FC<Props> = ({ enquiryId, staffId }) => {
  const [tasks, setTasks] = useState<EnquiryTask[]>([]);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setTasks(await fetchTasksForEnquiry(enquiryId));
  }, [enquiryId]);

  useEffect(() => {
    load();
    // Scoped broadly to this staff member (there's no per-enquiry realtime
    // channel for tasks — the pipeline dashboard already subscribes the
    // same way), filtered client-side to this enquiry below.
    return subscribeToMyTasks(staffId, load);
  }, [load, staffId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueAt) return;
    setSaving(true);
    try {
      await createTask(enquiryId, staffId, title.trim(), new Date(dueAt).toISOString());
      setTitle('');
      setDueAt('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (task: EnquiryTask) => {
    await setTaskStatus(task.id, task.status === 'done' ? 'pending' : 'done');
    await load();
  };

  const pending = tasks.filter((t) => t.status === 'pending');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <form onSubmit={handleAdd} className="bg-white border border-slate-100 rounded-2xl p-5 flex flex-col sm:flex-row gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Follow up about venue shortlist…"
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="px-4 py-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
        <button
          type="submit"
          disabled={saving || !title.trim() || !dueAt}
          className="bg-[#1e293b] text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? 'Adding…' : 'Add Reminder'}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-400 uppercase">Pending ({pending.length})</h3>
        {pending.length === 0 && <p className="text-sm text-slate-400 py-2">Nothing pending for this lead.</p>}
        {pending.map((task) => {
          const due = formatDue(task.due_at);
          return (
            <div key={task.id} className={`flex items-center gap-3 p-3.5 rounded-xl border ${due.overdue ? 'bg-red-50 border-red-100' : 'bg-white border-slate-100'}`}>
              <button
                onClick={() => handleToggle(task)}
                aria-label="Mark done"
                className="w-5 h-5 rounded-full border-2 border-slate-300 hover:border-emerald-500 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-700">{task.title}</p>
                <p className={`text-xs mt-0.5 ${due.overdue ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                  {due.overdue ? 'Overdue — ' : 'Due '}{due.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase">Done ({done.length})</h3>
          {done.map((task) => (
            <div key={task.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50">
              <button
                onClick={() => handleToggle(task)}
                aria-label="Mark pending"
                className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0"
              >
                <span className="material-symbols-outlined text-[14px] text-white">check</span>
              </button>
              <p className="text-sm text-slate-400 line-through flex-1 truncate">{task.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
