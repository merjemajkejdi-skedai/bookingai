import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import { airbnbApi } from '../api';
import type { AirbnbDepartment } from '../types';

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center gap-1.5 text-xs text-slate-600">
      {on ? <ToggleRight size={18} className="text-brand-500" /> : <ToggleLeft size={18} className="text-slate-400" />}
      {on ? 'Active' : 'Inactive'}
    </button>
  );
}

const EMPTY_FORM = { name: '', notification_number: '' };

export function AirbnbDepartmentsPage() {
  const [departments, setDepartments] = useState<AirbnbDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AirbnbDepartment | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try { setDepartments(await airbnbApi.getDepartments()); } catch { /* silent */ }
  }, []);
  useEffect(() => { load().then(() => setLoading(false)); }, [load]);

  function startCreate() { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }
  function startEdit(d: AirbnbDepartment) {
    setEditing(d);
    setForm({ name: d.name, notification_number: d.notification_number });
    setShowForm(true);
  }

  async function handleSave() {
    try {
      if (editing) await airbnbApi.updateDepartment(editing.id, form);
      else await airbnbApi.createDepartment(form);
      setShowForm(false); setEditing(null); setForm(EMPTY_FORM);
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this department?')) return;
    try { await airbnbApi.deleteDepartment(id); await load(); } catch (e: any) { alert(e.message); }
  }

  async function toggleActive(d: AirbnbDepartment) {
    try { await airbnbApi.updateDepartment(d.id, { is_active: !d.is_active }); await load(); }
    catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Departments</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Requests are routed to a department whose name matches the request category (e.g. "Cleaning") — otherwise they go to your own number.
          </p>
        </div>
        <button onClick={startCreate}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Add Department
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name, e.g. Cleaning"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.notification_number} onChange={e => setForm({ ...form, notification_number: e.target.value })} placeholder="WhatsApp number, e.g. +355691234567"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.name.trim() || !form.notification_number.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              {editing ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {departments.map(d => (
          <div key={d.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{d.name}</p>
              <p className="text-xs text-slate-500">{d.notification_number}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Toggle on={d.is_active} onChange={() => toggleActive(d)} />
              <button onClick={() => startEdit(d)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
              <button onClick={() => handleDelete(d.id)}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {departments.length === 0 && !showForm && (
          <p className="text-sm text-slate-400 text-center py-8">No departments yet — requests go to your own number until you add one.</p>
        )}
      </div>
    </div>
  );
}
