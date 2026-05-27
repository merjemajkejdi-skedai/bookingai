import { useState, useEffect } from 'react';
import { Save, Wifi, Coffee, Waves, UtensilsCrossed, Clock, Phone, MapPin, BookOpen, UserCheck } from 'lucide-react';
import { api } from '../api';
import { Button, Input, Spinner } from '../ui';

interface Config {
  hotel_name: string;
  check_in_time: string;
  check_out_time: string;
  wifi_password: string;
  breakfast_hours: string;
  pool_hours: string;
  restaurant_hours: string;
  reception_phone: string;
  emergency_phone: string;
  location_url: string;
  menu_url: string;
  ask_guest_identity: boolean;
}

const EMPTY: Config = {
  hotel_name: '',
  check_in_time: '14:00',
  check_out_time: '11:00',
  wifi_password: '',
  breakfast_hours: '',
  pool_hours: '',
  restaurant_hours: '',
  reception_phone: '',
  emergency_phone: '',
  location_url: '',
  menu_url: '',
  ask_guest_identity: true,
};

export function ConfigPage() {
  const [config, setConfig] = useState<Config>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getConfig()
      .then((c: any) => {
        if (c && Object.keys(c).length > 0) {
          setConfig({
            ...EMPTY,
            ...c,
            // Backend stores as INTEGER (1/0); convert to boolean for local state.
            // Default to true when column is absent (null/undefined).
            ask_guest_identity: c.ask_guest_identity !== 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function field(k: Exclude<keyof Config, 'ask_guest_identity'>) {
    return {
      value: (config[k] as string) || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setConfig(c => ({ ...c, [k]: e.target.value })),
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateConfig({
        ...config,
        ask_guest_identity: config.ask_guest_identity ? 1 : 0,
      } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-slate-800">Hotel Configuration</h1>
          <p className="text-xs text-slate-400">Info the AI concierge shares with guests</p>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* General */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">General</h2>
            <Input label="Hotel Name" placeholder="e.g. Grand Hotel Tirana" {...field('hotel_name')} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Check-in Time" placeholder="14:00" {...field('check_in_time')} />
              <Input label="Check-out Time" placeholder="11:00" {...field('check_out_time')} />
            </div>
          </section>

          {/* Facilities */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Facilities</h2>
            <div className="flex items-end gap-2">
              <Wifi size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Wifi Password" placeholder="e.g. Welcome2024" className="flex-1" {...field('wifi_password')} />
            </div>
            <div className="flex items-end gap-2">
              <Coffee size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Breakfast Hours" placeholder="e.g. 07:00 – 10:30" className="flex-1" {...field('breakfast_hours')} />
            </div>
            <div className="flex items-end gap-2">
              <Waves size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Pool Hours" placeholder="e.g. 08:00 – 20:00" className="flex-1" {...field('pool_hours')} />
            </div>
            <div className="flex items-end gap-2">
              <UtensilsCrossed size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Restaurant Hours" placeholder="e.g. 12:00 – 22:00" className="flex-1" {...field('restaurant_hours')} />
            </div>
          </section>

          {/* Location & Menu */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Location &amp; Menu</h2>
            <p className="text-xs text-slate-400 -mt-1">The AI concierge sends these links when guests ask for directions or the menu.</p>
            <div className="flex items-end gap-2">
              <MapPin size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Google Maps URL" placeholder="https://maps.app.goo.gl/..." className="flex-1" {...field('location_url')} />
            </div>
            <div className="flex items-end gap-2">
              <BookOpen size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Menu URL" placeholder="https://yourdomain.com/menu" className="flex-1" {...field('menu_url')} />
            </div>
          </section>

          {/* Contact */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Contact</h2>
            <div className="flex items-end gap-2">
              <Phone size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Reception Phone" placeholder="+355 4 123 4567" className="flex-1" {...field('reception_phone')} />
            </div>
            <div className="flex items-end gap-2">
              <Clock size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input label="Emergency Phone" placeholder="+355 4 123 4568" className="flex-1" {...field('emergency_phone')} />
            </div>
          </section>

          {/* Agent Behaviour */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Agent Behaviour</h2>
            <div className="flex items-start gap-3">
              <UserCheck size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Room number &amp; guest name check</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      When on, the AI asks every guest for their room number and name before helping.
                      When off, it skips this step and assists immediately.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.ask_guest_identity}
                    onClick={() => setConfig(c => ({ ...c, ask_guest_identity: !c.ask_guest_identity }))}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                      config.ask_guest_identity ? 'bg-brand-600' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        config.ask_guest_identity ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <Button type="submit" disabled={saving} className="w-full">
            <Save size={14} />
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Configuration'}
          </Button>
        </form>
      </div>
    </div>
  );
}
