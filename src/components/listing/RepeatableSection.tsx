import React, { useState } from 'react';
import { addListingChild, updateListingChild, deleteListingChild, ListingChildTable } from '../../lib/api';

// The banquet-hall table, the room-type table and the package list are the
// same interaction three times over: a list of rows, each with a few typed
// fields, added and removed inline. One generic component rather than three
// copies — the copies drift, and the one that drifts is always the one that
// forgets to persist an edit.
//
// Rows save on blur rather than on every keystroke: an agent tabbing through
// "Lawrence Hall / 2799 / 112" should cost three writes, not thirty.

export type ColumnKind = 'text' | 'number' | 'select';

export interface ColumnDef<T> {
  key: keyof T & string;
  label: string;
  kind: ColumnKind;
  width?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

interface Props<T extends { id: string; position: number }> {
  table: ListingChildTable;
  listingId: string;
  rows: T[];
  columns: ColumnDef<T>[];
  onChange: (rows: T[]) => void;
  addLabel: string;
  emptyLabel: string;
  newRow: () => Record<string, unknown>;
  disabled?: boolean;
}

export function RepeatableSection<T extends { id: string; position: number }>({
  table, listingId, rows, columns, onChange, addLabel, emptyLabel, newRow, disabled,
}: Props<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await addListingChild<T>(table, listingId, newRow(), rows.length);
      onChange([...rows, created]);
    } catch (err: any) {
      setError(err?.message || 'Could not add that row');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: T) => {
    // Optimistic: the row vanishes immediately and comes back if the delete
    // fails. A row that lingers for a second after you click the bin reads
    // as a broken button and gets clicked again.
    const previous = rows;
    onChange(rows.filter((r) => r.id !== row.id));
    try {
      await deleteListingChild(table, row.id);
    } catch (err: any) {
      onChange(previous);
      setError(err?.message || 'Could not delete that row');
    }
  };

  const commit = async (row: T, key: string, raw: string, kind: ColumnKind) => {
    const value = kind === 'number' ? (raw === '' ? null : Number(raw)) : raw === '' ? null : raw;
    if ((row as any)[key] === value) return;
    try {
      const updated = await updateListingChild<T>(table, row.id, { [key]: value });
      onChange(rows.map((r) => (r.id === row.id ? updated : r)));
    } catch (err: any) {
      setError(err?.message || 'Could not save that change');
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-2.5 rounded-xl">{error}</div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-slate-400">
                {columns.map((c) => (
                  <th key={c.key} className="text-left pb-2 font-semibold px-2" style={{ width: c.width }}>
                    {c.label}
                  </th>
                ))}
                {!disabled && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.key} className="py-1 px-1 align-top">
                      <RowInput
                        column={c}
                        // `key` forces a remount when the persisted value
                        // changes, so a server-side coercion (a number
                        // rounding, say) is reflected instead of the stale
                        // text the agent typed staying on screen.
                        defaultValue={(row as any)[c.key]}
                        disabled={disabled}
                        onCommit={(raw) => commit(row, c.key, raw, c.kind)}
                      />
                    </td>
                  ))}
                  {!disabled && (
                    <td className="py-1 px-1 align-middle">
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        className="text-slate-300 hover:text-rose-500 transition-colors p-1.5"
                        aria-label="Remove row"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          {busy ? 'Adding…' : addLabel}
        </button>
      )}
    </div>
  );
}

const RowInput: React.FC<{
  column: ColumnDef<any>;
  defaultValue: any;
  disabled?: boolean;
  onCommit: (raw: string) => void;
}> = ({ column, defaultValue, disabled, onCommit }) => {
  const [value, setValue] = useState<string>(defaultValue ?? '');
  const cls =
    'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-500 ' +
    'disabled:bg-slate-50 disabled:text-slate-400';

  if (column.kind === 'select') {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          onCommit(e.target.value);
        }}
        className={cls}
      >
        <option value="">—</option>
        {(column.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={column.kind === 'number' ? 'number' : 'text'}
      value={value}
      disabled={disabled}
      placeholder={column.placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      className={cls}
    />
  );
};
