import React, { useMemo, useState } from 'react';

// A compact month grid on the pipeline dashboard. Plots one entry per
// dated thing across a manager's leads — both an enquiry's headline
// event_date AND, since 0026, every individual event_function date
// (Mehendi, Sangeet, the ceremony, the reception…), so a couple with
// three functions across three different days shows up as three separate
// marked days, not one. Clicking a day with entries jumps straight into
// that event's workspace (or, if more than one entry shares a day, opens
// a small picker instead of guessing which one you meant).

export interface CalendarEntry {
  id: string;
  enquiryId: string;
  date: string; // "YYYY-MM-DD"
  label: string;
}

interface Props {
  entries: CalendarEntry[];
  onOpenEvent: (enquiryId: string) => void;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DashboardCalendar: React.FC<Props> = ({ entries, onOpenEvent }) => {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [pickerDay, setPickerDay] = useState<string | null>(null);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.date) || [];
      list.push(entry);
      map.set(entry.date, list);
    }
    return map;
  }, [entries]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(new Date());

  const cells: (Date | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const handleDayClick = (dateKey: string) => {
    const dayEntries = entriesByDay.get(dateKey);
    if (!dayEntries || dayEntries.length === 0) return;
    if (dayEntries.length === 1) {
      onOpenEvent(dayEntries[0].enquiryId);
    } else {
      setPickerDay(pickerDay === dateKey ? null : dateKey);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-geist font-semibold text-sm">{MONTH_NAMES[month]} {year}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
          <button
            onClick={() => setCursor(new Date(year, month, 1))}
            className="text-[10px] font-bold uppercase text-slate-400 hover:text-slate-600 px-1"
          >
            Today
          </button>
          <button
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-[10px] font-bold text-slate-300 py-1">{w}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const dateKey = toDateKey(date);
          const dayEntries = entriesByDay.get(dateKey);
          const isToday = dateKey === todayKey;
          return (
            <div key={i} className="relative">
              <button
                onClick={() => handleDayClick(dateKey)}
                disabled={!dayEntries}
                className={`w-full aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  isToday ? 'ring-1 ring-emerald-400' : ''
                } ${dayEntries ? 'bg-emerald-50 hover:bg-emerald-100 font-bold text-emerald-800 cursor-pointer' : 'text-slate-500'}`}
              >
                {date.getDate()}
                {dayEntries && <span className="w-1 h-1 rounded-full bg-emerald-500" />}
              </button>

              {pickerDay === dateKey && dayEntries && (
                <div className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1">
                  {dayEntries.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => { setPickerDay(null); onOpenEvent(entry.enquiryId); }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 truncate"
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {entries.length === 0 && (
        <p className="text-[11px] text-slate-400 mt-3">No confirmed dates yet — set one from an event's workspace or itinerary.</p>
      )}
    </div>
  );
};
