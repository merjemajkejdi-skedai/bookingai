import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { airbnbApi } from '../api';
import type { AirbnbFaq, AirbnbListing } from '../types';

export function AirbnbFaqsPage() {
  const [listings, setListings] = useState<AirbnbListing[]>([]);
  const [listingId, setListingId] = useState<string>('');
  const [faqs, setFaqs] = useState<AirbnbFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AirbnbFaq | null>(null);
  const [form, setForm] = useState({ question: '', answer: '', category: '' });

  useEffect(() => {
    airbnbApi.getListings().then(ls => {
      setListings(ls);
      if (ls.length > 0) setListingId(ls[0].id);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadFaqs = useCallback(async () => {
    if (!listingId) { setFaqs([]); return; }
    try { setFaqs(await airbnbApi.getFaqs(listingId)); } catch { /* silent */ }
  }, [listingId]);
  useEffect(() => { loadFaqs(); }, [loadFaqs]);

  function startCreate() { setEditing(null); setForm({ question: '', answer: '', category: '' }); setShowForm(true); }
  function startEdit(f: AirbnbFaq) {
    setEditing(f);
    setForm({ question: f.question, answer: f.answer, category: f.category || '' });
    setShowForm(true);
  }

  async function handleSave() {
    try {
      if (editing) await airbnbApi.updateFaq(editing.id, form);
      else await airbnbApi.createFaq({ listing_id: listingId, ...form });
      setShowForm(false); setEditing(null); setForm({ question: '', answer: '', category: '' });
      await loadFaqs();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this FAQ?')) return;
    try { await airbnbApi.deleteFaq(id); await loadFaqs(); } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  if (listings.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-8">Add a listing first, then come back to add its FAQs.</p>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-800">FAQs</h2>
          <select value={listingId} onChange={e => setListingId(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300">
            {listings.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <button onClick={startCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Add FAQ
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <input value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} placeholder="Question"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <textarea value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} placeholder="Answer" rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Category (optional)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.question.trim() || !form.answer.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              {editing ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {faqs.map(f => (
          <div key={f.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                {f.category && <span className="text-[10px] uppercase tracking-wide text-slate-400">{f.category}</span>}
                <p className="text-sm font-medium text-slate-800">{f.question}</p>
                <p className="text-xs text-slate-500 mt-1">{f.answer}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                <button onClick={() => startEdit(f)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(f.id)}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
        {faqs.length === 0 && !showForm && <p className="text-sm text-slate-400 text-center py-6">No FAQs yet for this listing</p>}
      </div>
    </div>
  );
}
