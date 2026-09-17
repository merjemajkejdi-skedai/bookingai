import { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../api';
import type { ArtClassFaq, UnansweredQuestion } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

function FaqItem({ entry, onEdit, onDelete }: {
  entry: ArtClassFaq;
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
        <p className="flex-1 min-w-0 text-sm font-medium text-slate-800 leading-snug">{entry.question}</p>
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
  const [entries, setEntries]   = useState<ArtClassFaq[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState<ArtClassFaq | null>(null);
  const [form, setForm]         = useState({ question: '', answer: '' });
  const [editForm, setEditForm] = useState({ question: '', answer: '' });
  const [saving, setSaving]     = useState(false);
  const [suggestions, setSuggestions] = useState<UnansweredQuestion[]>([]);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [suggestionSaving, setSuggestionSaving] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.getFaq().then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }

  function loadSuggestions() {
    api.getUnansweredQuestions().then(setSuggestions).catch(() => {});
  }

  useEffect(() => { load(); loadSuggestions(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createFaq(form);
      setShowAdd(false);
      setForm({ question: '', answer: '' });
      load();
    } finally {
      setSaving(false);
    }
  }

  function openEdit(entry: ArtClassFaq) {
    setEditing(entry);
    setEditForm({ question: entry.question, answer: entry.answer });
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

  async function handleSaveSuggestion(id: string) {
    setSuggestionSaving(id);
    try {
      await api.updateUnansweredQuestion(id, { action: 'add_to_faq', editedAnswer: draftAnswers[id] });
      setSuggestions(s => s.filter(x => x.id !== id));
      load();
    } catch { /* leave the card in place so staff can retry */ }
    finally { setSuggestionSaving(null); }
  }

  async function handleDismissSuggestion(id: string) {
    setSuggestionSaving(id);
    try {
      await api.updateUnansweredQuestion(id, { action: 'dismiss' });
      setSuggestions(s => s.filter(x => x.id !== id));
    } catch { /* leave the card in place so staff can retry */ }
    finally { setSuggestionSaving(null); }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">FAQ</h1>
          <p className="text-xs text-slate-400">Answers the AI uses automatically</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add FAQ
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="flex-shrink-0 border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
            Suggested FAQs — {suggestions.length} question{suggestions.length !== 1 ? 's' : ''} the AI couldn't answer
          </p>
          {suggestions.map(q => (
            <div key={q.id} className="bg-white rounded-lg border border-amber-100 p-3 space-y-2">
              <p className="text-sm font-medium text-slate-800">"{q.guest_question}"</p>
              <textarea
                value={draftAnswers[q.id] ?? q.suggested_answer ?? ''}
                onChange={e => setDraftAnswers(d => ({ ...d, [q.id]: e.target.value }))}
                rows={2}
                placeholder="Write the answer to save…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleSaveSuggestion(q.id)} disabled={suggestionSaving === q.id}>
                  {suggestionSaving === q.id ? 'Saving…' : 'Save as FAQ'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleDismissSuggestion(q.id)} disabled={suggestionSaving === q.id}>
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <BookOpen size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No FAQ entries yet</p>
            <p className="text-xs mt-1">Add questions parents commonly ask</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => (
              <FaqItem
                key={entry.id}
                entry={entry}
                onEdit={() => openEdit(entry)}
                onDelete={() => handleDelete(entry.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <Modal title="Add FAQ Entry" onClose={() => setShowAdd(false)} wide>
          <form onSubmit={handleAdd} className="space-y-4">
            <Input
              label="Question"
              placeholder="e.g. What age groups do you accept?"
              value={form.question}
              onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
              required
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Answer</span>
              <textarea
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                rows={3}
                placeholder="The full answer the AI will give…"
                value={form.answer}
                onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
                required
              />
            </label>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : 'Add Entry'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title="Edit FAQ Entry" onClose={() => setEditing(null)} wide>
          <form onSubmit={handleEdit} className="space-y-4">
            <Input
              label="Question"
              value={editForm.question}
              onChange={e => setEditForm(f => ({ ...f, question: e.target.value }))}
              required
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Answer</span>
              <textarea
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400"
                rows={3}
                value={editForm.answer}
                onChange={e => setEditForm(f => ({ ...f, answer: e.target.value }))}
                required
              />
            </label>
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
