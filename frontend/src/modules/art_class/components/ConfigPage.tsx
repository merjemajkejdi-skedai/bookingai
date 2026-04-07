import { useState, useEffect } from 'react';
import { Save, Phone, MapPin, Smile, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { Button, Input, Spinner } from '../ui';

const EMOJI_PRESETS = [
  { label: 'Art & Creative', value: '🎨 🖌️ ✨' },
  { label: 'Kids & Fun',     value: '🎉 🌟 😊' },
  { label: 'Minimal',        value: '✅ 📅 👋' },
  { label: 'Warm',           value: '🌸 💛 🎀' },
];

export function ConfigPage() {
  const [form, setForm] = useState({
    ownerWhatsapp:  '',
    studioLocation: '',
    studioEmojis:   '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getConfig()
      .then(c => setForm({
        ownerWhatsapp:  c.ownerWhatsapp  || '',
        studioLocation: c.studioLocation || '',
        studioEmojis:   c.studioEmojis   || '',
      }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      await api.updateConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center pt-16"><Spinner /></div>;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 max-w-lg pb-8">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Studio Settings</h1>
          <p className="text-xs text-slate-400">Configure how the AI assistant presents and communicates on behalf of your studio</p>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">

          {/* Owner WhatsApp */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Phone size={15} className="text-brand-500" />
              <p className="text-sm font-semibold text-slate-700">Owner WhatsApp</p>
            </div>
            <Input
              label="Phone number (with country code)"
              value={form.ownerWhatsapp}
              onChange={e => set('ownerWhatsapp', e.target.value)}
              placeholder="e.g. +355691234567"
            />
            <p className="text-xs text-slate-400 leading-relaxed">
              When a customer inquires about a special event the agent sends a WhatsApp notification with their contact and details to this number.
              It's also shared when a customer asks to speak with a human.
            </p>
          </div>

          {/* Studio Location */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-brand-500" />
              <p className="text-sm font-semibold text-slate-700">Studio Location</p>
            </div>
            <Input
              label="Address"
              value={form.studioLocation}
              onChange={e => set('studioLocation', e.target.value)}
              placeholder="e.g. Rruga Ismail Qemali 10, Tirana"
            />
            <p className="text-xs text-slate-400 leading-relaxed">
              The agent will share this address when customers ask where the studio is located.
            </p>
          </div>

          {/* Emojis */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Smile size={15} className="text-brand-500" />
              <p className="text-sm font-semibold text-slate-700">Agent Emojis</p>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-2 font-medium">Presets</p>
              <div className="flex flex-wrap gap-2">
                {EMOJI_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('studioEmojis', p.value)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      form.studioEmojis === p.value
                        ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p.value} <span className="ml-1 text-slate-400">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Custom emojis (space-separated)"
              value={form.studioEmojis}
              onChange={e => set('studioEmojis', e.target.value)}
              placeholder="e.g. 🎨 🖌️ ✨"
            />
            <p className="text-xs text-slate-400 leading-relaxed">
              The agent will use these emojis in its messages. Keep it to 2–4 emojis that match your studio's personality.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : <><Save size={14} /> Save settings</>}
            </Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle2 size={14} /> Saved
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
