import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { SubscriptionPlan } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

// ── Plan Form Modal ───────────────────────────────────────────────────────────
function PlanModal({ plan, onClose, onSaved }: {
  plan?: SubscriptionPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name:            plan?.name            ?? '',
    description:     plan?.description     ?? '',
    classesPerMonth: plan?.classesPerMonth != null ? String(plan.classesPerMonth) : '4',
    price:           plan?.price           != null ? String(plan.price)           : '0',
    isActive:        plan?.isActive        ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k: keyof typeof form, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Plan name is required'); return; }
    setSaving(true); setError('');
    const payload = {
      name:            form.name.trim(),
      description:     form.description.trim(),
      classesPerMonth: Number(form.classesPerMonth) || 4,
      price:           Number(form.price)           || 0,
      isActive:        form.isActive,
    };
    try {
      if (plan) await api.updatePlan(plan.id, payload);
      else      await api.createPlan(payload);
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={plan ? 'Edit Plan' : 'New Subscription Plan'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Plan name *" value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Monthly Basic, Premium" autoFocus />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
            placeholder="What's included in this plan..." />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Classes / month" type="number" min={1} max={50}
            value={form.classesPerMonth}
            onChange={e => set('classesPerMonth', e.target.value)} />
          <Input label="Monthly price (ALL)" type="number" min={0}
            value={form.price}
            onChange={e => set('price', e.target.value)}
            placeholder="e.g. 8000" />
        </div>

        {plan && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={form.isActive}
              onChange={e => set('isActive', e.target.checked)}
              className="w-4 h-4 rounded accent-brand-500" />
            <span className="text-slate-700 font-medium">Active (visible to customers)</span>
          </label>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function SubscriptionPlansPage() {
  const [plans, setPlans]     = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.getPlans().then(setPlans).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(plan: SubscriptionPlan) {
    if (!confirm(`Delete "${plan.name}"?`)) return;
    setDeletingId(plan.id);
    try { await api.deletePlan(plan.id); setPlans(p => p.filter(x => x.id !== plan.id)); }
    catch (e: any) { alert(e.message || 'Failed to delete'); }
    finally { setDeletingId(null); }
  }

  async function toggleActive(plan: SubscriptionPlan) {
    try {
      await api.updatePlan(plan.id, { ...plan, isActive: !plan.isActive });
      setPlans(p => p.map(x => x.id === plan.id ? { ...x, isActive: !x.isActive } : x));
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Subscription Plans</h1>
          <p className="text-xs text-slate-400">{plans.length} plan{plans.length !== 1 ? 's' : ''} configured</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New plan
        </Button>
      </div>

      {/* Plans grid */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <CheckCircle2 size={32} className="opacity-30" />
            <p className="text-sm">No subscription plans yet</p>
            <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
              <Plus size={13} /> Create your first plan
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {plans.map(plan => (
              <div key={plan.id}
                className={clsx(
                  'bg-white rounded-2xl border p-5 flex flex-col gap-4 transition-all',
                  plan.isActive ? 'border-slate-200 shadow-sm' : 'border-slate-100 opacity-60',
                )}>
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{plan.name}</p>
                    {plan.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{plan.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => setEditing(plan)}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-500 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(plan)} disabled={deletingId === plan.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-brand-600">
                      {plan.price.toLocaleString()}
                      <span className="text-sm font-normal text-slate-400 ml-1">ALL/mo</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {plan.classesPerMonth} class{plan.classesPerMonth !== 1 ? 'es' : ''} per month
                    </p>
                  </div>
                  {/* Active toggle */}
                  <button onClick={() => toggleActive(plan)}
                    className={clsx(
                      'flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors',
                      plan.isActive
                        ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
                    )}>
                    {plan.isActive
                      ? <><CheckCircle2 size={11} /> Active</>
                      : <><XCircle size={11} /> Inactive</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew  && <PlanModal onClose={() => setShowNew(false)}  onSaved={() => { setShowNew(false);  load(); }} />}
      {editing  && <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
