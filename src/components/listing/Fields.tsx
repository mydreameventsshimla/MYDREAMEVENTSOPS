import React, { useState } from 'react';

// Shared inputs for the listing editor. Same visual language as
// SalesmanOnboard's local Field/TextArea, but these carry the two things
// that form needed and didn't have: a `disabled` state (a listing in review
// is read-only to its author) and numeric handling that distinguishes
// "cleared" from "zero".

const LABEL = 'text-xs font-semibold text-slate-700 uppercase tracking-wider';
const INPUT =
  'w-full p-3.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none ' +
  'transition-all text-sm disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';

export const FieldShell: React.FC<{
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, required, children }) => (
  <div className="space-y-2">
    <label className={LABEL}>
      {label}
      {required && <span className="text-rose-500 ml-1">*</span>}
    </label>
    {children}
    {hint && <p className="text-[11px] text-slate-400 leading-snug">{hint}</p>}
  </div>
);

export const TextField: React.FC<{
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  type?: string;
}> = ({ label, value, onChange, placeholder, hint, required, disabled, type = 'text' }) => (
  <FieldShell label={label} hint={hint} required={required}>
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT}
    />
  </FieldShell>
);

// Empty string -> null, NOT 0. "Per plate price: 0" and "per plate price:
// not filled in yet" mean completely different things on a listing card —
// the first renders as "₹0+", which reads as free.
export const NumberField: React.FC<{
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  prefix?: string;
  suffix?: string;
}> = ({ label, value, onChange, placeholder, hint, disabled, prefix, suffix }) => (
  <FieldShell label={label} hint={hint}>
    <div className="relative">
      {prefix && (
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${INPUT} ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-14' : ''}`}
      />
      {suffix && (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  </FieldShell>
);

export const TextAreaField: React.FC<{
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
  disabled?: boolean;
  placeholder?: string;
}> = ({ label, value, onChange, rows = 4, hint, disabled, placeholder }) => (
  <FieldShell label={label} hint={hint}>
    <textarea
      value={value ?? ''}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT} resize-none`}
    />
  </FieldShell>
);

export function SelectField<T extends string>({
  label, value, onChange, options, disabled, hint, placeholder,
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
        className={INPUT}
      >
        <option value="">{placeholder ?? '— Select —'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldShell>
  );
}

// Three states, not two: null means "nobody has said", which is different
// from "no". A venue that simply hasn't been asked about alcohol should not
// be published to couples as an alcohol-free venue.
export const TriStateField: React.FC<{
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  disabled?: boolean;
  hint?: string;
}> = ({ label, value, onChange, disabled, hint }) => {
  const options: { v: boolean | null; label: string }[] = [
    { v: null, label: 'Not asked' },
    { v: true, label: 'Yes' },
    { v: false, label: 'No' },
  ];
  return (
    <FieldShell label={label} hint={hint}>
      <div className="flex gap-2">
        {options.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={String(o.v)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.v)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${
                active
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
};

// Free-text tag list (amenities, locality highlights, package inclusions).
// Enter or comma commits; backspace on an empty box removes the last chip,
// which is what anyone who has used a tag input expects.
export const ChipsField: React.FC<{
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  suggestions?: string[];
}> = ({ label, values, onChange, placeholder, hint, disabled, suggestions }) => {
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const next = raw.trim().replace(/,$/, '');
    if (!next) return;
    // Case-insensitive dedupe: "Spa" and "spa" as two amenities on the same
    // venue looks like a data-entry bug to whoever reads the listing.
    if (values.some((v) => v.toLowerCase() === next.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, next]);
    setDraft('');
  };

  const unused = (suggestions ?? []).filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())
  );

  return (
    <FieldShell label={label} hint={hint}>
      <div
        className={`w-full p-2.5 rounded-xl border border-slate-200 flex flex-wrap gap-2 min-h-[52px] ${
          disabled ? 'bg-slate-50' : 'bg-white focus-within:ring-2 focus-within:ring-emerald-500'
        }`}
      >
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-lg"
          >
            {v}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="text-slate-400 hover:text-rose-500 leading-none"
                aria-label={`Remove ${v}`}
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          placeholder={values.length === 0 ? placeholder : ''}
          onChange={(e) => {
            if (e.target.value.endsWith(',')) commit(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          className="flex-1 min-w-[140px] px-1.5 py-1.5 text-sm outline-none bg-transparent disabled:cursor-not-allowed"
        />
      </div>
      {!disabled && unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="text-[11px] text-slate-500 border border-dashed border-slate-300 hover:border-emerald-400 hover:text-emerald-600 px-2.5 py-1 rounded-md transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </FieldShell>
  );
};

export const SectionCard: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}> = ({ title, description, children, aside }) => (
  <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 space-y-6">
    <header className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-geist font-semibold text-slate-800">{title}</h2>
        {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
      </div>
      {aside}
    </header>
    {children}
  </section>
);
