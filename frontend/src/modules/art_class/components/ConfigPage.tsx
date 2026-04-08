import { useState, useEffect } from 'react';
import { Save, Phone, MapPin, Smile, MessageCircle, LogOut, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { Button, Input, Spinner } from '../ui';

const EMOJI_PRESETS = [
  { label: 'Art & Creative', value: '🎨 🖌️ ✨' },
  { label: 'Kids & Fun',     value: '🎉 🌟 😊' },
  { label: 'Minimal',        value: '✅ 📅 👋' },
  { label: 'Warm',           value: '🌸 💛 🎀' },
];

const GREETING_PLACEHOLDER =
  `Hi! Welcome to [Studio Name] 🎨 I'm here to help you register your child for art classes or organise a special event. How can I help you today?`;

const FAREWELL_PLACEHOLDER =
  `You're all set! We can't wait to see you at the studio. If you have any questions before then, feel free to message us here anytime. See you soon! 🎨`;

interface Config {
  ownerWhatsapp:  string;
  studioLocation: string;
  studioEmojis:   string;
  studioGreeting: string;
  studioFarewell: string;
}

const EMPTY: Config = {
  ownerWhatsapp:  '',
  studioLocation: '',
  studioEmojis:   '',
  studioGreeting: '',
  studioFarewell: '',
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-brand-500">{icon}</span>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
      </div>
      {children}
    </div>
  );
}

export function ConfigPage() {
  const [form, setForm] = useState<Config>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getConfig()
      .then(c => setForm({ ...EMPTY, ...c }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set(k: keyof Config, v: string) {
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
          <p className="text-xs text-slate-400">All fields are used by the AI assistant to personalise its responses for your studio</p>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">

          {/* Greeting message */}
          <Section icon={<MessageCircle size={15} />} title="Greeting Message">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-500">Shown when a customer first contacts the studio</span>
              <textarea
                value={form.studioGreeting}
                onChange={e => set('studioGreeting', e.target.value)}
                rows={4}
                placeholder={GREETING_PLACEHOLDER}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
              />
            </label>
            <p className="text-xs text-slate-400">
              Leave blank to use the default greeting. You can use your studio name, a tagline, or set the tone for the conversation.
            </p>
          </Section>

          {/* Farewell message */}
          <Section icon={<LogOut size={15} />} title="Closing Message">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-500">Sent after a registration or booking is confirmed</span>
              <textarea
                value={form.studioFarewell}
                onChange={e => set('studioFarewell', e.target.value)}
                rows={4}
                placeholder={FAREWELL_PLACEHOLDER}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
              />
            </label>
            <p className="text-xs text-slate-400">
              Leave blank to use the default closing. Add practical info (what to bring, parking, etc.) or a warm send-off.
            </p>
          </Section>

          {/* Owner WhatsApp */}
          <Section icon={<Phone size={15} />} title="Owner WhatsApp">
            <Input
              label="Phone number (with country code)"
              value={form.ownerWhatsapp}
              onChange={e => set('ownerWhatsapp', e.target.value)}
              placeholder="e.g. +355691234567"
            />
            <p className="text-xs text-slate-400">
              Receives a notification when a customer inquires about a special event.
              Also shared when a customer asks to speak with a human.
            </p>
          </Section>

          {/* Location */}
          <Section icon={<MapPin size={15} />} title="Studio Location">
            <Input
              label="Address"
              value={form.studioLocation}
              onChange={e => set('studioLocation', e.target.value)}
              placeholder="e.g. Rruga Ismail Qemali 10, Tirana"
            />
            <p className="text-xs text-slate-400">
              Shared when customers ask where the studio is located.
            </p>
          </Section>

          {/* Emojis */}
          <Section icon={<Smile size={15} />} title="Agent Emojis">
            <div>
              <p className="text-xs text-slate-500 mb-2 font-medium">Presets</p>
              <div className="flex flex-wrap gap-2">
                {EMOJI_PRESETS.map(p => (
                  <button key={p.value} type="button" onClick={() => set('studioEmojis', p.value)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      form.studioEmojis === p.value
                        ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}>
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
            <p className="text-xs text-slate-400">
              The agent uses only these emojis (1–2 per message). Pick 2–4 that match your studio's personality.
            </p>
          </Section>

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
