import { useState } from 'react';
import { Save, Phone, CalendarDays, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import type { SkedAIConfig } from '../types';

interface Props { config: SkedAIConfig; onSaved: (c: Partial<SkedAIConfig>) => void }

export function AdminTab({ config, onSaved }: Props) {
  const [forwardPhone, setForwardPhone] = useState(config.forwardPhone);
  const [calendlyUrl,  setCalendlyUrl]  = useState(config.calendlyUrl);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.saveAdmin({ forwardPhone, calendlyUrl });
      onSaved({ forwardPhone, calendlyUrl });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-5 max-w-lg">

      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Phone size={15} className="text-brand-500" />
          <p className="text-sm font-semibold text-slate-700">Forward Phone</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-500 font-medium">WhatsApp number (with country code)</span>
          <input value={forwardPhone} onChange={e => setForwardPhone(e.target.value)}
            placeholder="+355691234567"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
        </label>
        <p className="text-xs text-slate-400">Support requests and new sales leads are forwarded to this number via WhatsApp.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-brand-500" />
          <p className="text-sm font-semibold text-slate-700">Calendly Demo Link</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-slate-500 font-medium">URL</span>
          <input value={calendlyUrl} onChange={e => setCalendlyUrl(e.target.value)}
            placeholder="https://calendly.com/yourname/skedai-demo"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400" />
        </label>
        <p className="text-xs text-slate-400">Shared with prospects when they ask for a demo. Goes directly into the sales agent's response.</p>
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
