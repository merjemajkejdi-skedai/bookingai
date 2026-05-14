import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { FaqEntry } from '../types';
import { Button, Input, Textarea, Select, Modal, Spinner } from '../ui';

const CATEGORIES = ['facilities', 'dining', 'rooms', 'transport', 'services', 'general'];

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    facilities: 'bg-blue-50 text-blue-700',
    dining:     'bg-orange-50 text-orange-700',
    rooms:      'bg-indigo-50 text-indigo-700',
    transport:  'bg-green-50 text-green-700',
    services:   'bg-purple-50 text-purple-700',
    general:    'bg-slate-100 text-slate-600',
  };
  return (
    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full capitalize', colors[category] || colors.general)}>
      {category}
    </span>
  );
}

function FaqItem({ entry, onEdit, onDelete }: {
  entry: FaqEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CategoryBadge category={entry.category} />
          </div>
          <p className="text-sm font-medium text-slate-800 leading-snug">{entry.question}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEdit(); }}
            className="p-1 rounded text-slate-300 hover:text-brand-500 hover:bg-brand-50 transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={13} />
          </button>
          {open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50">
          <p className="text-sm text-slate-600 leading-relaxed">{entry.answer}</p>
        </div>
      )}
    </div>
  );
}

export function FaqPage() {
  const [entries, setEntries]   = useState<FaqEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState<FaqEntry | null>(null);
  const [form, setForm]         = useState({ question: '', answer: '', category: 'general' });
  const [editForm, setEditForm] = useState({ question: '', answer: '', category: 'general' });
  const [saving, setSaving]     = useState(false);

  function load() {
    setLoading(true);
    api.getFaq().then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createFaq(form);
      setShowAdd(false);
      setForm({ question: '', answer: '', category: 'general' });
      load();
    } finally {
      setSaving(false);
    }
  }

  function openEdit(entry: FaqEntry) {
    setEditing(entry);
    setEditForm({ question: entry.question, answer: entry.answer, category: entry.category });
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await api.updateFaq(editing.id, editForm);
      setEntries(es => es.map(x => x.id === editing.id ? updated : x));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await api.deleteFaq(id);
    setEntries(e => e.filter(x => x.id !== id));
  }

  // Group by category
  const grouped: Record<string, FaqEntry[]> = {};
  for (const e of entries) {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e);
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">FAQ</h1>
          <p className="text-xs text-slate-400">Answers the AI concierge uses automatically</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add FAQ
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <BookOpen size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No FAQ entries yet</p>
            <p className="text-xs mt-1">Add questions your guests commonly ask</p>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2">
                  {category}
                </p>
                <div className="space-y-2">
                  {items.map(entry => (
                    <FaqItem
                      key={entry.id}
                      entry={entry}
                      onEdit={() => openEdit(entry)}
                      onDelete={() => handleDelete(entry.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <Modal title="Add FAQ Entry" onClose={() => setShowAdd(false)} wide>
          <form onSubmit={handleAdd} className="space-y-4">
            <Select
              label="Category"
              value={form.category}
              onChange={(e: any) => setForm(f => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </Select>
            <Input
              label="Question"
              placeholder="e.g. What is the wifi password?"
              value={form.question}
              onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
              required
            />
            <Textarea
              label="Answer"
              placeholder="The full answer the AI will give to guests…"
              value={form.answer}
              onChange={(e: any) => setForm(f => ({ ...f, answer: e.target.value }))}
              required
            />
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : 'Add Entry'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit FAQ Entry" onClose={() => setEditing(null)} wide>
          <form onSubmit={handleEdit} className="space-y-4">
            <Select
              label="Category"
              value={editForm.category}
              onChange={(e: any) => setEditForm(f => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </Select>
            <Input
              label="Question"
              value={editForm.question}
              onChange={e => setEditForm(f => ({ ...f, question: e.target.value }))}
              required
            />
            <Textarea
              label="Answer"
              value={editForm.answer}
              onChange={(e: any) => setEditForm(f => ({ ...f, answer: e.target.value }))}
              required
            />
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
