import { useState, useEffect } from 'react';
import { Save, Wifi, Coffee, Waves, UtensilsCrossed, Clock, Phone, Mail, Plus, Trash2, CheckCircle, XCircle, Loader } from 'lucide-react';
import { api } from '../api';
import { Button, Input, Select, Spinner } from '../ui';
import type { EmailAccount } from '../types';

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
};

// ---------------------------------------------------------------------------
// Email settings sub-component
// ---------------------------------------------------------------------------
type TestResult = { readAccess: boolean; sendAccess: boolean; folderAccess: boolean; error?: string } | null;

function EmailSection() {
  const [accounts, setAccounts]     = useState<EmailAccount[]>([]);
  const [loadingAccts, setLoading]  = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [provider, setProvider]     = useState<'imap' | 'graph'>('imap');
  const [form, setForm]             = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState(false);
  const [testing, setTesting]       = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, TestResult>>({});

  async function loadAccounts() {
    setLoading(true);
    try { setAccounts(await api.getEmailAccounts()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAccounts(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createEmailAccount({ ...form, provider });
      setShowForm(false);
      setForm({});
      await loadAccounts();
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this email account?')) return;
    try { await api.deleteEmailAccount(id); await loadAccounts(); } catch (e: any) { alert(e.message); }
  }

  async function handleToggle(id: string, field: 'is_enabled' | 'ai_enabled') {
    try {
      const updated = await api.toggleEmailAccount(id, field);
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
    } catch (e: any) { alert(e.message); }
  }

  async function handleTest(id: string) {
    setTesting(id);
    setTestResult(prev => ({ ...prev, [id]: null }));
    try {
      const result = await api.testEmailConnection(id);
      setTestResult(prev => ({ ...prev, [id]: result }));
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [id]: { readAccess: false, sendAccess: false, folderAccess: false, error: e.message } }));
    } finally { setTesting(null); }
  }

  function f(key: string) {
    return {
      value: form[key] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [key]: e.target.value })),
    };
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail size={15} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Email Channel</h2>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus size={13} /> Add account
        </Button>
      </div>

      {loadingAccts ? <Spinner /> : accounts.length === 0 && !showForm ? (
        <p className="text-xs text-slate-400">No email accounts connected. Add one to enable the email channel.</p>
      ) : null}

      {/* Account list */}
      {accounts.map(acct => {
        const tr = testResult[acct.id];
        return (
          <div key={acct.id} className="border border-slate-100 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">{acct.email_address}</p>
                <p className="text-xs text-slate-400">{acct.provider === 'graph' ? 'Microsoft 365' : 'IMAP / SMTP'}</p>
              </div>
              <button onClick={() => handleDelete(acct.id)} className="text-slate-300 hover:text-red-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Toggle label="Enabled" active={!!acct.is_enabled} onToggle={() => handleToggle(acct.id, 'is_enabled')} />
              <Toggle label="AI replies" active={!!acct.ai_enabled} onToggle={() => handleToggle(acct.id, 'ai_enabled')} />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleTest(acct.id)} disabled={testing === acct.id}>
                {testing === acct.id ? <Loader size={12} className="animate-spin" /> : null}
                Test connection
              </Button>
              {tr && (
                <div className="flex items-center gap-2 text-xs">
                  <StatusDot ok={tr.readAccess} label="Read" />
                  <StatusDot ok={tr.sendAccess} label="Send" />
                  <StatusDot ok={tr.folderAccess} label="Folder" />
                  {tr.error && <span className="text-red-500 truncate max-w-[200px]">{tr.error}</span>}
                </div>
              )}
            </div>

            {acct.last_error && (
              <p className="text-xs text-red-500">Last error: {acct.last_error}</p>
            )}
            {acct.last_checked_at && (
              <p className="text-xs text-slate-400">Last checked: {new Date(acct.last_checked_at).toLocaleString()}</p>
            )}
          </div>
        );
      })}

      {/* Add account form */}
      {showForm && (
        <form onSubmit={handleCreate} className="border border-brand-200 bg-brand-50/30 rounded-lg p-4 space-y-3">
          <Select label="Provider" value={provider} onChange={(e: any) => setProvider(e.target.value)}>
            <option value="imap">IMAP / SMTP (Gmail, cPanel, etc.)</option>
            <option value="graph">Microsoft 365 / Outlook (OAuth)</option>
          </Select>

          {provider === 'imap' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Email address" type="email" required placeholder="info@hotel.com" {...f('email_address')} />
                <Input label="Display name" placeholder="Grand Hotel" {...f('display_name')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="IMAP host" required placeholder="imap.gmail.com" {...f('imap_host')} />
                <Input label="IMAP port" type="number" placeholder="993" {...f('imap_port')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="SMTP host" required placeholder="smtp.gmail.com" {...f('smtp_host')} />
                <Input label="SMTP port" type="number" placeholder="587" {...f('smtp_port')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Username" placeholder="info@hotel.com" {...f('username')} />
                <Input label="Password / App password" type="password" required {...f('password')} />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Input label="Email address" type="email" required placeholder="info@hotel.com" {...f('email_address')} />
              <p className="text-xs text-slate-500">
                After saving, click "Connect Microsoft account" to authorise via OAuth.
              </p>
              <a
                href={api.getOAuthUrl()}
                className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                Connect Microsoft account →
              </a>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save account'}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Toggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-slate-50 border-slate-200 text-slate-500'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-brand-500' : 'bg-slate-300'}`} />
      {label}
    </button>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-0.5">
      {ok ? <CheckCircle size={11} className="text-emerald-500" /> : <XCircle size={11} className="text-red-400" />}
      <span className={ok ? 'text-slate-600' : 'text-red-500'}>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main ConfigPage
// ---------------------------------------------------------------------------
export function ConfigPage() {
  const [config, setConfig] = useState<Config>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    api.getConfig()
      .then((c: any) => {
        if (c && Object.keys(c).length > 0) setConfig({ ...EMPTY, ...c });
      })
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
      await api.updateConfig(config as any);
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

          <Button type="submit" disabled={saving} className="w-full">
            <Save size={14} />
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Configuration'}
          </Button>
        </form>

        <EmailSection />
      </div>
    </div>
  );
}
