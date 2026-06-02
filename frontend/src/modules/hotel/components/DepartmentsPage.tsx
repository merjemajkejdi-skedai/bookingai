import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Building2, Phone, Check, Clock } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { Department } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

const ALL_REQUEST_TYPES = [
  { id: 'room_service',       label: 'Room Service',       emoji: '🍽️' },
  { id: 'housekeeping',       label: 'Housekeeping',       emoji: '🛏️' },
  { id: 'maintenance',        label: 'Maintenance',        emoji: '🔧' },
  { id: 'concierge_question', label: 'Concierge',          emoji: '💬' },
  { id: 'complaint',          label: 'Complaint',          emoji: '⚠️' },
  { id: 'other',              label: 'Other',              emoji: '📋' },
];

const EMPTY_FORM = { name: '', whatsapp: '', request_types: [] as string[], response_time_minutes: 30 };

function DeptForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: typeof EMPTY_FORM;
  onSave: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);

  function toggleType(t: string) {
    setForm(f => ({
      ...f,
      request_types: f.request_types.includes(t)
        ? f.request_types.filter(x => x !== t)
        : [...f.request_types, t],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.request_types.length) return;
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Department Name"
        placeholder="e.g. Maintenance"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        required
      />
      <Input
        label="WhatsApp Number"
        placeholder="+355691234567"
        value={form.whatsapp}
        onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
        required
      />

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">Response time</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={480}
            value={form.response_time_minutes}
            onChange={e => setForm(f => ({ ...f, response_time_minutes: parseInt(e.target.value) || 30 }))}
            className="w-20 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-xs text-slate-400">minutes</span>
        </div>
        <p className="text-xs text-slate-400">Shown to guests when their request is logged</p>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Handles these request types</p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_REQUEST_TYPES.map(t => {
            const active = form.request_types.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleType(t.id)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all',
                  active
                    ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
              >
                <span>{t.emoji}</span>
                <span className="flex-1 text-left">{t.label}</span>
                {active && <Check size={13} className="text-brand-500" />}
              </button>
            );
          })}
        </div>
        {!form.request_types.length && (
          <p className="text-xs text-red-500 mt-1">Select at least one request type</p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !form.request_types.length} className="flex-1">
          {saving ? 'Saving…' : 'Save Department'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function DepartmentsPage() {
  const [depts, setDepts]     = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [saving, setSaving]   = useState(false);

  function load() {
    setLoading(true);
    api.getDepartments().then(setDepts).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(form: typeof EMPTY_FORM) {
    setSaving(true);
    try {
      await api.createDepartment(form);
      setShowAdd(false);
      load();
    } finally { setSaving(false); }
  }

  async function handleUpdate(form: typeof EMPTY_FORM) {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateDepartment(editing.id, form);
      setEditing(null);
      load();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    await api.deleteDepartment(id);
    setDepts(d => d.filter(x => x.id !== id));
  }

  async function toggleActive(dept: Department) {
    await api.updateDepartment(dept.id, {
      name: dept.name,
      whatsapp: dept.whatsapp,
      request_types: dept.request_types,
      is_active: !dept.is_active,
      response_time_minutes: dept.response_time_minutes || 30,
    });
    load();
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Departments</h1>
          <p className="text-xs text-slate-400">Each department gets a WhatsApp notification when a matching request arrives</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Department
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : depts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <Building2 size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No departments yet</p>
            <p className="text-xs mt-1">Add a department to start routing guest requests</p>
          </div>
        ) : (
          <div className="space-y-2">
            {depts.map(dept => (
              <div
                key={dept.id}
                className={clsx(
                  'bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-4',
                  !dept.is_active && 'opacity-50'
                )}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Building2 size={18} className="text-brand-500" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-slate-800">{dept.name}</p>
                    {!dept.is_active && (
                      <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mb-2">
                    <span className="flex items-center gap-1"><Phone size={11} /> {dept.whatsapp}</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {dept.response_time_minutes || 30} min response</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dept.request_types.map(t => {
                      const info = ALL_REQUEST_TYPES.find(x => x.id === t);
                      return (
                        <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                          {info?.emoji} {info?.label || t}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditing(dept)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => toggleActive(dept)}
                    className={clsx(
                      'p-1.5 rounded-lg transition-colors text-xs font-medium px-2',
                      dept.is_active
                        ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                        : 'text-green-600 hover:bg-green-50'
                    )}
                  >
                    {dept.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleDelete(dept.id)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <Modal title="Add Department" onClose={() => setShowAdd(false)} wide>
          <DeptForm
            initial={EMPTY_FORM}
            onSave={handleCreate}
            onCancel={() => setShowAdd(false)}
            saving={saving}
          />
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title={`Edit — ${editing.name}`} onClose={() => setEditing(null)} wide>
          <DeptForm
            initial={{ name: editing.name, whatsapp: editing.whatsapp, request_types: editing.request_types, response_time_minutes: editing.response_time_minutes || 30 }}
            onSave={handleUpdate}
            onCancel={() => setEditing(null)}
            saving={saving}
          />
        </Modal>
      )}
    </div>
  );
}
