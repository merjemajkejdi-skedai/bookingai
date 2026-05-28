import { useState, useEffect } from 'react';
import { Plus, Pencil, RefreshCw, Power, Phone, ExternalLink, BarChart2, Copy, Check, Star } from 'lucide-react';
import { adminApi } from '../shared/lib/auth';
import type { AdminTenant } from '../shared/lib/auth';
import { Button, Modal, Input, Select, Spinner } from '../components/ui';
import clsx from 'clsx';

const PLANS = ['starter', 'growth', 'pro'];
const TYPES = ['barbershop', 'salon', 'dentist', 'medical', 'hotel', 'art_class', 'art_event', 'restaurant', 'skedai'];

interface AdminPageProps {
  onViewShop?: (tenant: AdminTenant) => void;
  onTenantsLoaded?: (tenants: AdminTenant[]) => void;
}

export function AdminPage({ onViewShop, onTenantsLoaded }: AdminPageProps = {}) {
  const [tenants, setTenants]     = useState<any[]>([]);
  const [stats, setStats]         = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [editing, setEditing]     = useState<any>(null);
  const [resetting, setResetting] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([adminApi.getTenants(), adminApi.getStats()]);
      setTenants(t); setStats(s);
      onTenantsLoaded?.(t.map((x: any) => ({ id: x.id, name: x.name, type: x.type })));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(tenant: any) {
    await adminApi.updateTenant(tenant.id, { isActive: !tenant.is_active });
    load();
  }

  const planColor: Record<string, string> = {
    starter: 'bg-slate-100 text-slate-600',
    growth:  'bg-brand-50 text-brand-700',
    pro:     'bg-amber-50 text-amber-700',
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Admin dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">Manage all shops and accounts</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus size={14} /> New shop</Button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Active shops',      value: stats.totalTenants },
            { label: 'Total bookings',    value: stats.totalBookings },
            { label: 'Bookings today',    value: stats.bookingsToday },
            { label: 'Active users',      value: stats.totalUsers },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className="text-2xl font-semibold text-slate-800 mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tenant list */}
      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {tenants.map(t => (
            <div key={t.id} className={clsx(
              'bg-white rounded-xl border px-5 py-4 flex items-center gap-4',
              t.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
            )}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-800">{t.name}</p>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium capitalize', planColor[t.plan] || planColor.starter)}>
                    {t.plan}
                  </span>
                  <span className="text-xs text-slate-400 capitalize">{t.type}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="text-xs text-slate-400">{t.owner_email || 'No owner'}</span>
                  {t.whatsapp_number && (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Phone size={10} /> {t.whatsapp_number}
                    </span>
                  )}
                  <span className="text-xs text-slate-300">·</span>
                  <span className="text-xs text-slate-400">{t.total_bookings} bookings · {t.specialist_count} specialists</span>
                  <span className="text-xs text-slate-300">·</span>
                  <CopyId id={t.id} />
                </div>
              </div>
              <div className="flex gap-1.5">
                {onViewShop && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewShop({ id: t.id, name: t.name, type: t.type })}
                    title="Open shop view">
                    <ExternalLink size={13} /> View
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  <Pencil size={13} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setResetting(t)}>
                  <RefreshCw size={13} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => toggleActive(t)}>
                  <Power size={13} className={t.is_active ? 'text-green-500' : 'text-slate-300'} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => adminApi.updateTenant(t.id, { hasAnalytics: !t.has_analytics }).then(load)}
                  title={t.has_analytics ? 'Disable analytics' : 'Enable analytics'}>
                  <BarChart2 size={13} className={t.has_analytics ? 'text-brand-500' : 'text-slate-300'} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => adminApi.updateTenant(t.id, { reviewsEnabled: !t.reviews_enabled }).then(load)}
                  title={t.reviews_enabled ? 'Disable Reviews tab' : 'Enable Reviews tab'}>
                  <Star size={13} className={t.reviews_enabled ? 'text-amber-500' : 'text-slate-300'} />
                </Button>
              </div>
            </div>
          ))}
          {tenants.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-sm">No shops yet.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreating(true)}>
                Create your first shop
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <CreateTenantModal
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <EditTenantModal
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {/* Reset password modal */}
      {resetting && (
        <ResetPasswordModal
          tenant={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => setResetting(null)}
        />
      )}
    </div>
  );
}

// --- Copy tenant ID button ---------------------------------------------------
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors font-mono"
      title="Copy tenant ID (set as TENANT_ID in Railway)">
      {copied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
      <span className="truncate max-w-[120px]">{id}</span>
    </button>
  );
}

// --- Create tenant modal ----------------------------------------------------
function CreateTenantModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '', type: 'barbershop', timezone: 'Europe/Tirane',
    ownerEmail: '', ownerPassword: '',
    whatsappNumber: '', plan: 'starter', billingEmail: '',
    provider: 'twilio',
    metaPhoneNumberId: '', metaAccessToken: '', metaWabaId: '',
    twilioAccountSid: '', twilioAuthToken: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true); setError('');
    try {
      await adminApi.createTenant(form);
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="Create new shop" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Shop name" value={form.name} onChange={set('name')} placeholder="Gentian's Barbershop" />
          <Select label="Type" value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm(f => ({ ...f, type: e.target.value }))}>
            {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Owner email" type="email" value={form.ownerEmail} onChange={set('ownerEmail')} placeholder="owner@shop.com" />
          <Input label="Owner password" type="password" value={form.ownerPassword} onChange={set('ownerPassword')} placeholder="min 8 chars" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="WhatsApp number" value={form.whatsappNumber} onChange={set('whatsappNumber')} placeholder="+355691234567" />
          <Select label="Plan" value={form.plan} onChange={set('plan')}>
            {PLANS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
          </Select>
        </div>
        <Input label="Billing email (optional)" type="email" value={form.billingEmail} onChange={set('billingEmail')} placeholder="billing@shop.com" />

        {/* Provider selector */}
        <div className="grid grid-cols-2 gap-3">
          <Select label="WhatsApp provider" value={form.provider} onChange={set('provider')}>
            <option value="twilio">Twilio</option>
            <option value="meta">Meta Cloud API</option>
          </Select>
        </div>

        {/* Meta credentials — shown only when Meta is selected */}
        {form.provider === 'meta' && (
          <div className="space-y-3 p-3 bg-green-50 rounded-lg border border-green-200">
            <p className="text-xs font-medium text-green-700">
              Meta Cloud API credentials — get these from Meta Developer Portal
            </p>
            <Input label="Phone Number ID" value={form.metaPhoneNumberId} onChange={set('metaPhoneNumberId')} placeholder="e.g. 123456789012345" />
            <Input label="Access Token" value={form.metaAccessToken} onChange={set('metaAccessToken')} placeholder="EAAxxxxxxxxx…" />
            <Input label="WABA ID (optional)" value={form.metaWabaId} onChange={set('metaWabaId')} placeholder="WhatsApp Business Account ID" />
          </div>
        )}

        {/* Custom Twilio credentials — shown only when Twilio is selected */}
        {form.provider === 'twilio' && (
          <div className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs font-medium text-slate-500">
              Custom Twilio credentials — only needed if this tenant uses their own Twilio account.
              Leave blank to use the platform default.
            </p>
            <Input label="Twilio Account SID (optional)" value={form.twilioAccountSid} onChange={set('twilioAccountSid')} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <Input label="Twilio Auth Token (optional)" type="password" value={form.twilioAuthToken} onChange={set('twilioAuthToken')} placeholder="Your Twilio auth token" />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create shop'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Edit tenant modal -------------------------------------------------------
function EditTenantModal({ tenant, onClose, onSaved }: { tenant: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName]                       = useState(tenant.name);
  const [whatsapp, setWhatsapp]               = useState(tenant.whatsapp_number || '');
  const [plan, setPlan]                       = useState(tenant.plan || 'starter');
  const [billingEmail, setBilling]            = useState(tenant.billing_email || '');
  const [type, setType]                       = useState(tenant.type || 'barbershop');
  const [provider, setProvider]               = useState(tenant.provider || 'twilio');
  const [metaPhoneNumberId, setMetaPhoneId]   = useState(tenant.meta_phone_number_id || '');
  const [metaAccessToken, setMetaToken]       = useState(tenant.meta_access_token || '');
  const [metaWabaId, setMetaWabaId]           = useState(tenant.meta_waba_id || '');
  const [twilioAccountSid, setTwilioSid]      = useState(tenant.twilio_account_sid || '');
  const [twilioAuthToken, setTwilioToken]     = useState(tenant.twilio_auth_token || '');
  const [reviewsEnabled, setReviewsEnabled]   = useState(!!tenant.reviews_enabled);
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState('');

  async function save() {
    setSaving(true); setError('');
    try {
      await adminApi.updateTenant(tenant.id, {
        name, whatsappNumber: whatsapp, plan, billingEmail, type,
        provider, reviewsEnabled,
        metaPhoneNumberId: metaPhoneNumberId || null,
        metaAccessToken:   metaAccessToken   || null,
        metaWabaId:        metaWabaId        || null,
        twilioAccountSid:  twilioAccountSid  || null,
        twilioAuthToken:   twilioAuthToken   || null,
      });
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`Edit — ${tenant.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Shop name" value={name} onChange={(e: any) => setName(e.target.value)} />
          <Select label="Type" value={type} onChange={(e: any) => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="WhatsApp number" value={whatsapp} onChange={(e: any) => setWhatsapp(e.target.value)} placeholder="+355691234567" />
          <Select label="Plan" value={plan} onChange={(e: any) => setPlan(e.target.value)}>
            {PLANS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
          </Select>
        </div>
        <Input label="Billing email" value={billingEmail} onChange={(e: any) => setBilling(e.target.value)} />

        {/* Provider selector */}
        <div className="grid grid-cols-2 gap-3">
          <Select label="WhatsApp provider" value={provider} onChange={(e: any) => setProvider(e.target.value)}>
            <option value="twilio">Twilio</option>
            <option value="meta">Meta Cloud API</option>
          </Select>
        </div>

        {/* Meta credentials — shown only when Meta is selected */}
        {provider === 'meta' && (
          <div className="space-y-3 p-3 bg-green-50 rounded-lg border border-green-200">
            <p className="text-xs font-medium text-green-700">
              Meta Cloud API credentials — get these from Meta Developer Portal
            </p>
            <Input label="Phone Number ID" value={metaPhoneNumberId} onChange={(e: any) => setMetaPhoneId(e.target.value)} placeholder="e.g. 123456789012345" />
            <Input label="Access Token" value={metaAccessToken} onChange={(e: any) => setMetaToken(e.target.value)} placeholder="EAAxxxxxxxxx…" />
            <Input label="WABA ID (optional)" value={metaWabaId} onChange={(e: any) => setMetaWabaId(e.target.value)} placeholder="WhatsApp Business Account ID" />
          </div>
        )}

        {/* Custom Twilio credentials — shown only when Twilio is selected */}
        {provider === 'twilio' && (
          <div className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-xs font-medium text-slate-500">
              Custom Twilio credentials — only needed if this tenant uses their own Twilio account.
              Leave blank to use the platform default.
            </p>
            <Input label="Twilio Account SID (optional)" value={twilioAccountSid} onChange={(e: any) => setTwilioSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <Input label="Twilio Auth Token (optional)" type="password" value={twilioAuthToken} onChange={(e: any) => setTwilioToken(e.target.value)} placeholder="Your Twilio auth token" />
          </div>
        )}

        {/* Feature flags */}
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <p className="text-xs font-semibold text-slate-600">Feature flags</p>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={reviewsEnabled}
              onClick={() => setReviewsEnabled(v => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${reviewsEnabled ? 'bg-amber-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${reviewsEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-slate-700">Reviews tab</span>
            <span className="text-xs text-slate-400">{reviewsEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Reset password modal ----------------------------------------------------
function ResetPasswordModal({ tenant, onClose, onSaved }: { tenant: any; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [saving, setSaving]     = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState('');

  async function save() {
    if (password.length < 8) { setError('Min 8 characters'); return; }
    setSaving(true); setError('');
    try {
      await adminApi.resetPassword(tenant.id, password);
      setDone(true);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`Reset password — ${tenant.name}`} onClose={onClose}>
      <div className="space-y-4">
        {done ? (
          <>
            <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">Password reset successfully.</p>
            <Button onClick={onClose} className="w-full">Close</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">Set a new password for <strong>{tenant.owner_email}</strong></p>
            <Input label="New password" type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="min 8 characters" />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Resetting…' : 'Reset password'}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
