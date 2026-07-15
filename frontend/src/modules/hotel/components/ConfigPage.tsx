import { useState, useEffect } from 'react';
import { Save, Wifi, Coffee, Waves, UtensilsCrossed, Clock, Phone, MapPin, BookOpen, UserCheck, Star, MessageSquare, SmilePlus, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { Button, Input, Spinner } from '../ui';

// ── Review Management section ─────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { value: 'immediate',   label: 'Immediately',              description: 'WhatsApp sent as soon as a negative review arrives' },
  { value: 'daily',       label: 'Once per day (09:00)',     description: 'All new negative reviews batched in one morning message' },
  { value: 'twice_daily', label: 'Twice per day (09 & 18)', description: 'Morning batch + evening batch' },
  { value: 'weekly',      label: 'Once per week (Monday)',   description: 'Weekly summary every Monday at 09:00' },
  { value: 'mon_thu',     label: 'Mon & Thu',                description: 'Two batches a week — Monday and Thursday at 09:00' },
  { value: 'never',       label: 'Never',                    description: 'No WhatsApp notifications — reviews are still saved to the dashboard' },
];

function ReviewSettings() {
  const [slug, setSlug]             = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [frequency, setFrequency]   = useState('immediate');
  const [email, setEmail]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  useEffect(() => {
    api.getReviewConfig()
      .then(d => {
        setSlug(d.slug ?? '');
        setOwnerPhone(d.owner_phone ?? '');
        setFrequency(d.notification_frequency ?? 'immediate');
        setEmail(d.email ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const d = await api.updateReviewConfig({
        slug,
        owner_phone: ownerPhone,
        notification_frequency: frequency,
      });
      setEmail(d.email ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Star size={15} className="text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700">Review Management</h2>
      </div>
      <p className="text-xs text-slate-400 -mt-1">
        Forward Booking.com and TripAdvisor review emails to your SkedAI address — the AI
        will analyse them and suggest responses automatically.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        {/* Email slug */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Your review inbox address</label>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="lafavorita"
              maxLength={40}
              className="w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
            />
            <span className="text-sm text-slate-400 select-all">@reviews.skedai.net</span>
          </div>
          {email ? (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded px-2 py-1 inline-block mt-1 font-mono">
              ✓ {email}
            </p>
          ) : (
            <p className="text-xs text-slate-400">Letters and numbers only. E.g. <em>grandhotel</em></p>
          )}
        </div>

        {/* Owner WhatsApp */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">
            WhatsApp number for negative review alerts
          </label>
          <input
            value={ownerPhone}
            onChange={e => setOwnerPhone(e.target.value)}
            placeholder="+355 69 123 4567"
            className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
          />
        </div>

        {/* Notification frequency */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">
            How often to notify you about negative reviews
          </label>
          <div className="grid gap-1.5">
            {FREQUENCY_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  frequency === opt.value
                    ? 'border-brand-400 bg-brand-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="review_frequency"
                  value={opt.value}
                  checked={frequency === opt.value}
                  onChange={() => setFrequency(opt.value)}
                  className="mt-0.5 accent-brand-500 flex-shrink-0"
                />
                <div>
                  <p className={`text-sm font-medium leading-tight ${frequency === opt.value ? 'text-brand-700' : 'text-slate-700'}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
          {frequency !== 'immediate' && (
            <p className="text-xs text-slate-400">
              Reviews are always saved to the dashboard in real time — you'll just get the WhatsApp alert {FREQUENCY_OPTIONS.find(o => o.value === frequency)?.label.toLowerCase()}.
            </p>
          )}
        </div>

        {/* Setup instructions — shown once email is set */}
        {email && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-semibold text-slate-700">How to forward reviews automatically:</p>
            <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
              <li>Log in to your Booking.com Extranet</li>
              <li>Go to <strong>Account → Notifications → Email settings</strong></li>
              <li>Add <strong className="font-mono">{email}</strong> as a CC for review notifications</li>
              <li>Repeat in TripAdvisor Management Center if applicable</li>
              <li>New reviews appear in your <strong>Reviews</strong> tab automatically</li>
            </ol>
          </div>
        )}

        <Button type="submit" size="sm" disabled={saving || !slug}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save review settings'}
        </Button>
      </form>
    </section>
  );
}

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
  message_forward: boolean;
  // Survey config
  review_platform_url: string;
  review_platform_name: string;
  survey_positive_threshold: number;
  survey_positive_message: string;
  survey_negative_message: string;
  // Fallback
  front_office_phone: string;
  fallback_message: string;
  // Behaviour flags
  ask_maintenance_photo: boolean;
}

const DEFAULT_POSITIVE_MSG =
  'We are so glad you enjoyed your stay! It would mean the world to us if you could share your experience online — it only takes a minute and helps us welcome more wonderful guests like you.';
const DEFAULT_NEGATIVE_MSG =
  'We are truly sorry your experience did not meet your expectations. Your feedback is very important to us and we will use it to improve. We hope to have the opportunity to welcome you back for a much better stay.';

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
  message_forward: true,
  review_platform_url: '',
  review_platform_name: 'Booking.com',
  survey_positive_threshold: 8,
  survey_positive_message: DEFAULT_POSITIVE_MSG,
  survey_negative_message: DEFAULT_NEGATIVE_MSG,
  front_office_phone: '',
  fallback_message: '',
  ask_maintenance_photo: true,
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
            message_forward:    c.message_forward    !== 0,
            // Survey fields — use defaults if not yet configured
            review_platform_url:         c.review_platform_url         ?? '',
            review_platform_name:        c.review_platform_name        ?? 'Booking.com',
            survey_positive_threshold:   Number(c.survey_positive_threshold) || 8,
            survey_positive_message:     c.survey_positive_message     ?? DEFAULT_POSITIVE_MSG,
            survey_negative_message:     c.survey_negative_message     ?? DEFAULT_NEGATIVE_MSG,
            front_office_phone:          c.front_office_phone          ?? '',
            fallback_message:            c.fallback_message            ?? '',
            ask_maintenance_photo:       c.ask_maintenance_photo       !== 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function field(k: Exclude<keyof Config, 'ask_guest_identity' | 'message_forward' | 'survey_positive_threshold'>) {
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
        ask_guest_identity:         config.ask_guest_identity ? 1 : 0,
        message_forward:            config.message_forward    ? 1 : 0,
        review_platform_url:        config.review_platform_url        || null,
        review_platform_name:       config.review_platform_name       || 'Booking.com',
        survey_positive_threshold:  config.survey_positive_threshold,
        survey_positive_message:    config.survey_positive_message    || null,
        survey_negative_message:    config.survey_negative_message    || null,
        front_office_phone:         config.front_office_phone         || null,
        fallback_message:           config.fallback_message           || null,
        ask_maintenance_photo:      config.ask_maintenance_photo      ? 1 : 0,
      } as any);
      // Reload from server to confirm what was actually persisted
      const fresh = await api.getConfig() as any;
      if (fresh && Object.keys(fresh).length > 0) {
        setConfig(prev => ({
          ...prev,
          ...fresh,
          ask_guest_identity: fresh.ask_guest_identity !== 0,
          message_forward:    fresh.message_forward    !== 0,
          review_platform_url:        fresh.review_platform_url         ?? '',
          review_platform_name:       fresh.review_platform_name        ?? 'Booking.com',
          survey_positive_threshold:  Number(fresh.survey_positive_threshold) || 8,
          survey_positive_message:    fresh.survey_positive_message     ?? DEFAULT_POSITIVE_MSG,
          survey_negative_message:    fresh.survey_negative_message     ?? DEFAULT_NEGATIVE_MSG,
          front_office_phone:         fresh.front_office_phone          ?? '',
          fallback_message:           fresh.fallback_message            ?? '',
          ask_maintenance_photo:      fresh.ask_maintenance_photo       !== 0,
        }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
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

          {/* Offline Fallback */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Offline Fallback</h2>
            </div>
            <p className="text-xs text-slate-400 -mt-1">
              Sent to guests when the AI assistant is temporarily unavailable (timeout, outage, etc.).
              If left blank, a generic error message is used instead.
            </p>
            <div className="flex items-end gap-2">
              <Phone size={15} className="text-slate-400 mb-2.5 flex-shrink-0" />
              <Input
                label="Front Office WhatsApp (for fallback link)"
                placeholder="+355691234567"
                className="flex-1"
                {...field('front_office_phone')}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">Fallback message</label>
              <textarea
                rows={3}
                value={config.fallback_message}
                onChange={e => setConfig(c => ({ ...c, fallback_message: e.target.value }))}
                placeholder={`e.g. Our assistant is temporarily unavailable. For urgent requests please contact the front office directly.`}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
              <p className="text-xs text-slate-400">
                If blank, a generic "technical issue" message is sent. The front office WhatsApp link is appended automatically when a number is set.
              </p>
            </div>
          </section>

          {/* Agent Behaviour */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Agent Behaviour</h2>

            {/* Toggle helper */}
            {([
              {
                key:   'ask_guest_identity' as const,
                icon:  <UserCheck size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />,
                label: 'Room number & guest name check',
                desc:  'When on, the AI asks every guest for their room number and name before helping. When off, it skips this step and assists immediately.',
              },
              {
                key:   'message_forward' as const,
                icon:  <MessageSquare size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />,
                label: 'Message forwarding',
                desc:  'When on, unresolved requests are forwarded to the relevant department via WhatsApp. When off, the AI only answers from FAQ and hotel info — if it can\'t help, it gives guests the front office WhatsApp number to contact directly.',
              },
              {
                key:   'ask_maintenance_photo' as const,
                icon:  <AlertTriangle size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />,
                label: 'Ask guests for maintenance photos',
                desc:  'When on, the AI gently asks once for a photo when a guest reports a maintenance issue. Helps staff arrive prepared with the right tools. When off, photos are accepted if sent but never requested.',
              },
            ] as const).map(({ key, icon, label, desc }) => (
              <div key={key} className="flex items-start gap-3">
                {icon}
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                      {/* Extra hint when message_forward is off */}
                      {key === 'message_forward' && !config.message_forward && config.reception_phone && (
                        <p className="text-xs text-brand-600 mt-1 font-mono">
                          Guests will be directed to: wa.me/{config.reception_phone.replace(/\D/g, '')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config[key]}
                      onClick={() => setConfig(c => ({ ...c, [key]: !c[key] }))}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                        config[key] ? 'bg-brand-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          config[key] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* Guest Satisfaction Survey */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <SmilePlus size={15} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Guest Satisfaction Survey</h2>
            </div>
            <p className="text-xs text-slate-400 -mt-1">
              Sent automatically when a guest is checked out from the Conversations tab.
              The guest rates their stay 1–10; high scores get a review link, low scores get a personal apology.
            </p>

            <Input
              label="Review platform name"
              placeholder="Booking.com"
              {...field('review_platform_name')}
            />
            <Input
              label="Review platform URL"
              placeholder="https://www.booking.com/hotel/…#tab-reviews"
              {...field('review_platform_url')}
            />

            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">
                Positive score threshold
              </label>
              <select
                value={config.survey_positive_threshold}
                onChange={e => setConfig(c => ({ ...c, survey_positive_threshold: Number(e.target.value) }))}
                className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              >
                {[6, 7, 8, 9].map(n => (
                  <option key={n} value={n}>{n} or above = positive</option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                Guests scoring at or above this receive the review link. Below this gets the apology.
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">
                Message for happy guests
              </label>
              <textarea
                rows={3}
                value={config.survey_positive_message}
                onChange={e => setConfig(c => ({ ...c, survey_positive_message: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
              <p className="text-xs text-slate-400">Sent before the review link.</p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-slate-700">
                Message for unhappy guests
              </label>
              <textarea
                rows={3}
                value={config.survey_negative_message}
                onChange={e => setConfig(c => ({ ...c, survey_negative_message: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
              <p className="text-xs text-slate-400">
                The manager also receives a WhatsApp alert with the guest score and phone number.
              </p>
            </div>
          </section>

          <Button type="submit" disabled={saving} className="w-full">
            <Save size={14} />
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Configuration'}
          </Button>
        </form>

        {/* Review Management — own form/state, outside main form */}
        <div className="mt-5">
          <ReviewSettings />
        </div>
      </div>
    </div>
  );
}
