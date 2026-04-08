import { useState } from 'react';
import { Plus, Trash2, Save, CheckCircle2, HelpCircle, Activity } from 'lucide-react';
import { api } from '../api';
import type { SkedAIConfig, FaqItem, HealthCheck } from '../types';

function uid() { return Math.random().toString(36).slice(2); }

interface Props { config: SkedAIConfig; onSaved: (c: Partial<SkedAIConfig>) => void }

export function SupportTab({ config, onSaved }: Props) {
  const [faq,    setFaq]    = useState<FaqItem[]>(() => config.supportFaq || []);
  const [checks, setChecks] = useState<HealthCheck[]>(() => config.healthCheckUrls || []);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  // ── FAQ helpers ─────────────────────────────────────────────────────────────
  function addFaq()         { setFaq(f => [...f, { id: uid(), q: '', a: '' }]); }
  function removeFaq(id: string) { setFaq(f => f.filter(x => x.id !== id)); }
  function setFaqField(id: string, k: 'q' | 'a', v: string) {
    setFaq(f => f.map(x => x.id === id ? { ...x, [k]: v } : x));
  }

  // ── Health check helpers ─────────────────────────────────────────────────────
  function addCheck()            { setChecks(c => [...c, { id: uid(), name: '', url: '' }]); }
  function removeCheck(id: string) { setChecks(c => c.filter(x => x.id !== id)); }
  function setCheckField(id: string, k: 'name' | 'url', v: string) {
    setChecks(c => c.map(x => x.id === id ? { ...x, [k]: v } : x));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.saveSupport({ supportFaq: faq, healthCheckUrls: checks });
      onSaved({ supportFaq: faq, healthCheckUrls: checks });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-5 max-w-2xl">

      {/* FAQ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle size={15} className="text-brand-500" />
            <p className="text-sm font-semibold text-slate-700">FAQ — Common Questions</p>
          </div>
          <button type="button" onClick={addFaq}
            className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium">
            <Plus size={12} /> Add question
          </button>
        </div>
        <p className="text-xs text-slate-400">The support agent answers these directly before escalating to a human.</p>

        {faq.length === 0
          ? <p className="text-xs text-slate-400 italic py-2">No FAQ entries yet. Add common questions customers ask.</p>
          : (
            <div className="flex flex-col gap-3">
              {faq.map(item => (
                <div key={item.id} className="flex gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex-1 flex flex-col gap-2">
                    <input value={item.q} onChange={e => setFaqField(item.id, 'q', e.target.value)}
                      placeholder="Question e.g. How do I reset my password?"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 font-medium" />
                    <textarea value={item.a} onChange={e => setFaqField(item.id, 'a', e.target.value)}
                      rows={2} placeholder="Answer…"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none" />
                  </div>
                  <button type="button" onClick={() => removeFaq(item.id)}
                    className="p-1.5 h-fit rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Health check URLs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-brand-500" />
            <p className="text-sm font-semibold text-slate-700">Service Health Checks</p>
          </div>
          <button type="button" onClick={addCheck}
            className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium">
            <Plus size={12} /> Add service
          </button>
        </div>
        <p className="text-xs text-slate-400">When a support request arrives the agent pings these URLs and includes their status in the alert sent to you.</p>

        {checks.length === 0
          ? <p className="text-xs text-slate-400 italic py-2">No services added yet. Add your backend, dashboard, and API endpoints.</p>
          : (
            <div className="flex flex-col gap-2">
              {checks.map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  <input value={item.name} onChange={e => setCheckField(item.id, 'name', e.target.value)}
                    placeholder="Service name"
                    className="w-36 flex-shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
                  <input value={item.url} onChange={e => setCheckField(item.id, 'url', e.target.value)}
                    placeholder="https://your-service.com/health"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
                  <button type="button" onClick={() => removeCheck(item.id)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )
        }
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors">
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle2 size={14} /> Saved</span>}
      </div>
    </form>
  );
}
