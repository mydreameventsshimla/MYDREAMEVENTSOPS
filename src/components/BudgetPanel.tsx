import React, { useCallback, useEffect, useState } from 'react';
import { EnquiryPayment, PaymentKind, PaymentStatus } from '../types';
import { fetchPaymentsForEnquiry, addPayment, updatePaymentStatus, deletePayment, subscribeToPayments } from '../lib/api';

interface Props {
  enquiryId: string;
  staffId: string;
  estimatedBudget: number | null;
}

const CLIENT_CATEGORIES = ['Deposit', 'Installment', 'Final Payment', 'Other'];
const VENDOR_CATEGORIES = ['Venue', 'Catering', 'Decor', 'Photography', 'Makeup', 'DJ / Music', 'Mehendi', 'Other'];

function money(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

const emptyForm = { kind: 'client_payment' as PaymentKind, category: 'Deposit', amount: '', status: 'pending' as PaymentStatus, dueDate: '', notes: '' };

export const BudgetPanel: React.FC<Props> = ({ enquiryId, staffId, estimatedBudget }) => {
  const [payments, setPayments] = useState<EnquiryPayment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setPayments(await fetchPaymentsForEnquiry(enquiryId));
  }, [enquiryId]);

  useEffect(() => {
    load();
    return subscribeToPayments(enquiryId, load);
  }, [load, enquiryId]);

  const clientPayments = payments.filter((p) => p.kind === 'client_payment');
  const vendorCosts = payments.filter((p) => p.kind === 'vendor_cost');

  const collected = clientPayments.filter((p) => p.status === 'received').reduce((s, p) => s + p.amount, 0);
  const pendingFromClient = clientPayments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const paidToVendors = vendorCosts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const pendingToVendors = vendorCosts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      await addPayment({
        enquiryId,
        kind: form.kind,
        category: form.category,
        amount,
        status: form.status,
        dueDate: form.dueDate || null,
        recordedBy: staffId,
        notes: form.notes || undefined,
      });
      setForm({ ...emptyForm, kind: form.kind });
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (p: EnquiryPayment) => {
    const next: PaymentStatus = p.status === 'pending' ? (p.kind === 'client_payment' ? 'received' : 'paid') : 'pending';
    await updatePaymentStatus(p.id, next);
    await load();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryTile label="Estimated Budget" value={estimatedBudget ? money(estimatedBudget) : '—'} />
        <SummaryTile label="Collected" value={money(collected)} tone="emerald" />
        <SummaryTile label="Pending from Client" value={money(pendingFromClient)} tone={pendingFromClient > 0 ? 'amber' : undefined} />
        <SummaryTile label="Paid to Vendors" value={money(paidToVendors)} />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-bold uppercase bg-[#1e293b] text-white px-4 py-2.5 rounded-lg hover:bg-slate-800"
        >
          <span className="material-symbols-outlined text-[16px]">add</span> Record Payment
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-slate-100 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as PaymentKind, category: e.target.value === 'client_payment' ? CLIENT_CATEGORIES[0] : VENDOR_CATEGORIES[0] })}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2"
          >
            <option value="client_payment">Money in — from client</option>
            <option value="vendor_cost">Money out — to a vendor</option>
          </select>

          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
            {(form.kind === 'client_payment' ? CLIENT_CATEGORIES : VENDOR_CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <input
            type="number"
            min="1"
            step="1"
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Amount (₹)"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          />

          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PaymentStatus })} className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
            <option value="pending">Pending</option>
            <option value={form.kind === 'client_payment' ? 'received' : 'paid'}>{form.kind === 'client_payment' ? 'Received' : 'Paid'}</option>
          </select>

          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
          />

          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm sm:col-span-2"
          />

          <button disabled={saving} type="submit" className="sm:col-span-2 bg-[#1e293b] text-white py-2.5 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      <PaymentList title="Client Payments" rows={clientPayments} onCycle={cycleStatus} onDelete={async (id) => { await deletePayment(id); await load(); }} />
      <PaymentList title="Vendor Costs" rows={vendorCosts} onCycle={cycleStatus} onDelete={async (id) => { await deletePayment(id); await load(); }} />
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; value: string; tone?: 'emerald' | 'amber' }> = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-100 rounded-xl p-4">
    <p className={`text-lg font-geist font-bold ${tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-[#1e293b]'}`}>{value}</p>
    <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">{label}</p>
  </div>
);

const PaymentList: React.FC<{
  title: string;
  rows: EnquiryPayment[];
  onCycle: (p: EnquiryPayment) => void;
  onDelete: (id: string) => void;
}> = ({ title, rows, onCycle, onDelete }) => (
  <div className="space-y-2">
    <h3 className="text-xs font-bold text-slate-400 uppercase">{title} ({rows.length})</h3>
    {rows.length === 0 && <p className="text-sm text-slate-400 py-1">Nothing recorded yet.</p>}
    {rows.map((p) => (
      <div key={p.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-3.5">
        <button
          onClick={() => onCycle(p)}
          className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
            p.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {p.status}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-700">{p.category || '—'} · {money(p.amount)}</p>
          {p.notes && <p className="text-xs text-slate-400 truncate">{p.notes}</p>}
        </div>
        {p.due_date && <span className="text-[10px] text-slate-400 shrink-0">Due {new Date(p.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
        <button onClick={() => onDelete(p.id)} className="text-slate-300 hover:text-red-500 shrink-0">
          <span className="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    ))}
  </div>
);
