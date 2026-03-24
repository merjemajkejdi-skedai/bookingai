import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, AlertCircle, BookTemplate } from 'lucide-react';
import { api } from '../api';
import type { EventTemplate } from '../types';
import { Button, Modal, Input, Spinner } from '../ui';

// ── Template Form Modal ───────────────────────────────────────────────────────
function TemplateFormModal({
  template, onClose, onSaved,
}: {
  template?: EventTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title:       template?.title       ?? '',
    description: template?.description ?? '',
    maxCapacity: template?.maxCapacity != null ? String(template.maxCapacity) : '',
    price:       template?.price       != null ? String(template.price)       : '3500',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    const payload = {
      title:       form.title.trim(),
      description: form.description.trim(),
      maxCapacity: form.maxCapacity !== '' ? Number(form.maxCapacity) : null,
      price:       form.price !== '' ? Number(form.price) : 0,
    };
    try {
      if (template) {
        await api.updateTemplate(template.id, payload as any);
      } else {
        await api.createTemplate(payload as any);
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={template ? 'Edit Template' : 'New Template'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Title *"
          value={form.title}
          onChange={e => set('title', e.target.value)}
          placeholder="e.g. Abstract Art Night"
          autoFocus
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
            placeholder="Describe what this event is about..."
          />
        </label>
        <Input
          label="Max capacity (optional)"
          type="number"
          min={1}
          value={form.maxCapacity}
          onChange={e => set('maxCapacity', e.target.value)}
          placeholder="Leave empty for unlimited"
        />
        <Input
          label="Price per person (ALL)"
          type="number"
          min={0}
          value={form.price}
          onChange={e => set('price', e.target.value)}
          placeholder="e.g. 3500"
        />
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : template ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main TemplatesPage ────────────────────────────────────────────────────────
export function TemplatesPage() {
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [showNew,   setShowNew]   = useState(false);
  const [editing,   setEditing]   = useState<EventTemplate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setTemplates(await api.getTemplates()); }
    catch (e: any) { setError(e.message || 'Failed to load templates'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(t: EventTemplate) {
    if (!confirm(`Delete template "${t.title}"?`)) return;
    setDeletingId(t.id);
    try { await api.deleteTemplate(t.id); setTemplates(ts => ts.filter(x => x.id !== t.id)); }
    catch (e: any) { alert(e.message || 'Failed to delete'); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BookTemplate size={16} className="text-brand-500" />
          <h2 className="text-sm font-semibold text-slate-800">Event Templates</h2>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{templates.length}</span>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New template
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm border-b border-red-100 flex-shrink-0">
          <AlertCircle size={15} className="flex-shrink-0" /> {error}
          <button onClick={load} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookTemplate size={36} className="text-slate-200 mb-3" />
            <p className="text-sm font-medium text-slate-500">No templates yet</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">Create reusable event templates to speed up scheduling</p>
            <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> New template</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map(t => (
              <div key={t.id} className="flex flex-col gap-2 p-4 rounded-xl border border-slate-200 bg-white hover:border-brand-200 hover:shadow-sm transition-all group">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800 leading-tight">{t.title}</h3>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => setEditing(t)}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-500 transition-colors" title="Edit">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDelete(t)} disabled={deletingId === t.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {t.description && (
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{t.description}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap mt-auto pt-2 border-t border-slate-100">
                  {t.price != null && t.price > 0 && (
                    <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                      {t.price.toLocaleString()} ALL
                    </span>
                  )}
                  {t.maxCapacity != null && (
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      {t.maxCapacity} spots
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <TemplateFormModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
      {editing && (
        <TemplateFormModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
