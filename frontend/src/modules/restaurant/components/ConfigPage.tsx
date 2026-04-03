import { useState, useEffect } from 'react';
import { Save, MapPin, BookOpen } from 'lucide-react';
import { api } from '../api';

interface Config {
  location_url: string;
  menu_url: string;
}

const EMPTY: Config = { location_url: '', menu_url: '' };

function Input({
  label, placeholder, value, onChange,
}: {
  label: string; placeholder: string;
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type="url"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
    </label>
  );
}

export function RestaurantConfigPage() {
  const [config, setConfig] = useState<Config>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getConfig()
      .then((c: any) => { if (c) setConfig({ ...EMPTY, ...c }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function field(k: keyof Config) {
    return {
      value: config[k] || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setConfig(c => ({ ...c, [k]: e.target.value })),
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Loading…</div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-slate-800">Restaurant Configuration</h1>
          <p className="text-xs text-slate-400">Links the AI sends to guests when they ask for location or the menu</p>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Location &amp; Menu</h2>
            <p className="text-xs text-slate-400 -mt-1">
              The AI agent will send these URLs directly when guests ask "where are you?" or "can I see the menu?".
            </p>

            <div className="flex items-end gap-2">
              <MapPin size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <div className="flex-1">
                <Input
                  label="Google Maps URL"
                  placeholder="https://maps.app.goo.gl/..."
                  {...field('location_url')}
                />
              </div>
            </div>

            <div className="flex items-end gap-2">
              <BookOpen size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <div className="flex-1">
                <Input
                  label="Menu URL"
                  placeholder="https://yourdomain.com/menu"
                  {...field('menu_url')}
                />
              </div>
            </div>
          </section>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Configuration'}
          </button>
        </form>
      </div>
    </div>
  );
}
