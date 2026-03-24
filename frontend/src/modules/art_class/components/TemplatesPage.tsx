import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, AlertCircle, BookTemplate, Users } from 'lucide-react';
import { api } from '../api';
import type { EventTemplate } from '../types';
import { Button, Modal, Input } from '../ui';

// ── TemplateFormModal ─────────────────────────────────────────────────────────
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
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    const payload = {
      title:       form.title.trim(),
      description: form.description.trim(),
      teacherId:   null,
      ageMin:      null,
      ageMax:      null,
      maxCapacity: form.maxCapacity !== '' ? Number(form.maxCapacity) : null,
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
          label="Template name *"
          value={form.title}
          onChange={e => set('title', e.target.value)}
          placeholder="e.g. Painting for Kids"
          autoFocus
        />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
            placeholder="Describe what this class is about..."
          />
        </label>

        <Input
          label="Default max capacity (optional)"
          type="number"
          min={1}
          value={form.maxCapacity}
          onChange={e => set('maxCapacity', e.target.value)}
          placeholder="Leave empty for unlimited"
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

// ── TemplatesPage ─────────────────────────────────────────────────────────────
export function TemplatesPage() {
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [editing, setEditing]     = useState<EventTemplate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try { setTemplates(await api.getTemplates()); }
    catch (e: any) { setLoadError(e.message || 'Failed to load templates'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  async function handleDelete(tmpl: EventTemplate) {
    if (!confirm(`Delete template "${tmpl.title}"? This cannot be undone.`)) return;
    setDeletingId(tmpl.id);
    try { await api.deleteTemplate(tmpl.id); setTemplates(ts => ts.filter(t => t.id !== tmpl.id)); }
    catch (e: any) { alert(e.message || 'Failed to delete template'); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Predefined Class Templates</h2>
          <p className="text-xs text-slate-400 mt-0.5">Reusable templates to speed up class creation</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New template
        </Button>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm border-b border-red-100">
          <AlertCircle size={15} className="flex-shrink-0" /> {loadError}
          <button onClick={loadTemplates} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center">
              <BookTemplate size={22} className="text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">No templates yet</p>
              <p className="text-xs text-slate-400 mt-1">Create templates to pre-fill class details quickly</p>
            </div>
            <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} /> Create first template</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map(tmpl => (
              <div key={tmpl.id}
                className="group relative flex flex-col gap-2 p-4 rounded-xl border border-slate-200 bg-white hover:border-brand-300 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800 leading-snug">{tmpl.title}</h3>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => setEditing(tmpl)}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-500 transition-colors"
                      title="Edit">
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(tmpl)}
                      disabled={deletingId === tmpl.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                      title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {tmpl.description && (
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{tmpl.description}</p>
                )}

                {tmpl.maxCapacity != null && (
                  <div className="flex items-center gap-1 mt-auto pt-2 border-t border-slate-100">
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Users size={11} className="text-slate-400" />
                      {tmpl.maxCapacity} spots max
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <TemplateFormModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); loadTemplates(); }}
        />
      )}
      {editing && (
        <TemplateFormModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadTemplates(); }}
        />
      )}
    </div>
  );
}
