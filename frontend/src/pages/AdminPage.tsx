import { useState, useEffect } from 'react';
import { Plus, Pencil, RefreshCw, Power, Phone, ExternalLink, BarChart2, Copy, Check, Star, SmilePlus, UtensilsCrossed } from 'lucide-react';
import { adminApi } from '../shared/lib/auth';
import type { AdminTenant } from '../shared/lib/auth';
import { Button, Modal, Input, Select, Spinner } from '../components/ui';
import clsx from 'clsx';

const PLANS = ['starter', 'growth', 'pro'];
const TYPES = ['barbershop', 'salon', 'dentist', 'medical', 'hotel', 'art_class', 'art_event', 'restaurant', 'skedai', 'shop'];

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
                {t.type === 'hotel' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => adminApi.updateTenant(t.id, { surveyEnabled: !t.survey_enabled }).then(load)}
                    title={t.survey_enabled ? 'Disable Survey feature' : 'Enable Survey feature'}>
                    <SmilePlus size={13} className={t.survey_enabled ? 'text-green-500' : 'text-slate-300'} />
                  </Button>
                )}
                {t.type === 'hotel' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => adminApi.updateTenant(t.id, { menusEnabled: !t.menus_enabled }).then(load)}
                    title={t.menus_enabled ? 'Disable Menus feature' : 'Enable Menus feature'}>
                    <UtensilsCrossed size={13} className={t.menus_enabled ? 'text-orange-500' : 'text-slate-300'} />
                  </Button>
                )}
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

const CHANNELS = [
  { key: 'whatsapp',  label: 'WhatsApp',           icon: '💬' },
  { key: 'instagram', label: 'Instagram',           icon: '📷' },
  { key: 'facebook',  label: 'Facebook Messenger',  icon: '💙' },
  { key: 'email',     label: 'Email',               icon: '✉️' },
] as const;

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
  const [twilioAccountSid, setTwilioSid]            = useState(tenant.twilio_account_sid || '');
  const [twilioAuthToken, setTwilioToken]           = useState(tenant.twilio_auth_token || '');
  const [twilioDeptTemplateSid, setDeptTemplateSid] = useState(tenant.twilio_dept_template_sid || '');
  const [reviewsEnabled, setReviewsEnabled]         = useState(!!tenant.reviews_enabled);
  const [surveyEnabled,  setSurveyEnabled]    = useState(!!tenant.survey_enabled);
  const [menusEnabled,   setMenusEnabled]     = useState(!!tenant.menus_enabled);
  const [shopPhotosEnabled, setShopPhotosEnabled] = useState(!!tenant.shop_photos_enabled);
  const [notificationEmail, setNotificationEmail] = useState(tenant.notification_email || '');
  const [emailFallbackEnabled, setEmailFallbackEnabled] = useState(!!tenant.email_fallback_enabled);
  const [channels, setChannels]               = useState<Record<string, { connected: boolean; ai_enabled: boolean }>>({});
  const [togglingChannel, setTogglingChannel] = useState<string | null>(null);
  // Instagram connect form
  const [igFormOpen, setIgFormOpen]           = useState(false);
  const [igToken, setIgToken]                 = useState('');
  const [igAccountId, setIgAccountId]         = useState('');
  const [igConnecting, setIgConnecting]       = useState(false);
  const [igConnectError, setIgConnectError]   = useState('');
  // Instagram disconnect confirm
  const [igDisconnectOpen, setIgDisconnectOpen]   = useState(false);
  const [igDisconnecting, setIgDisconnecting]     = useState(false);
  // Email accounts
  const [emailAccounts, setEmailAccounts]     = useState<any[]>([]);
  const [emailFormOpen, setEmailFormOpen]     = useState(false);
  const [emailForm, setEmailForm]             = useState<Record<string, string>>({});
  const [emailSaving, setEmailSaving]         = useState(false);
  const [emailError, setEmailError]           = useState('');
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState('');

  useEffect(() => {
    adminApi.getTenant(tenant.id)
      .then(d => { if (d.channels) setChannels(d.channels); })
      .catch(() => {});
    adminApi.getEmailAccounts(tenant.id)
      .then(setEmailAccounts)
      .catch(() => {});
  }, [tenant.id]);

  async function handleChannelToggle(channel: string, ai_enabled: boolean) {
    setTogglingChannel(channel);
    try {
      await adminApi.toggleChannelAI(tenant.id, channel, ai_enabled);
      setChannels(prev => ({ ...prev, [channel]: { ...prev[channel], ai_enabled } }));
    } catch (e: any) { setError(e.message); }
    finally { setTogglingChannel(null); }
  }

  async function handleInstagramConnect() {
    if (!igToken.trim() || !igAccountId.trim()) {
      setIgConnectError('Both fields are required');
      return;
    }
    setIgConnecting(true); setIgConnectError('');
    try {
      await adminApi.connectInstagram(tenant.id, {
        access_token: igToken.trim(),
        instagram_account_id: igAccountId.trim(),
      });
      setChannels(prev => ({ ...prev, instagram: { connected: true, ai_enabled: false } }));
      setIgFormOpen(false); setIgToken(''); setIgAccountId('');
    } catch (e: any) { setIgConnectError(e.message); }
    finally { setIgConnecting(false); }
  }

  async function handleEmailCreate() {
    if (!emailForm.email_address || !emailForm.imap_host || !emailForm.smtp_host || !emailForm.password) {
      setEmailError('Email, IMAP host, SMTP host and password are required');
      return;
    }
    setEmailSaving(true); setEmailError('');
    try {
      const acct = await adminApi.createEmailAccount(tenant.id, { ...emailForm, provider: 'imap' });
      setEmailAccounts(prev => [...prev, acct]);
      setEmailFormOpen(false); setEmailForm({});
    } catch (e: any) { setEmailError(e.message); }
    finally { setEmailSaving(false); }
  }

  async function handleEmailToggle(accountId: string, field: 'is_enabled' | 'ai_enabled') {
    try {
      const updated = await adminApi.toggleEmailAccount(tenant.id, accountId, field);
      setEmailAccounts(prev => prev.map((a: any) => a.id === accountId ? { ...a, ...updated } : a));
    } catch (e: any) { setError(e.message); }
  }

  async function handleEmailDelete(accountId: string) {
    try {
      await adminApi.deleteEmailAccount(tenant.id, accountId);
      setEmailAccounts(prev => prev.filter((a: any) => a.id !== accountId));
    } catch (e: any) { setError(e.message); }
  }

  async function handleInstagramDisconnect() {
    setIgDisconnecting(true);
    try {
      await adminApi.disconnectInstagram(tenant.id);
      setChannels(prev => ({ ...prev, instagram: { connected: false, ai_enabled: false } }));
      setIgDisconnectOpen(false);
    } catch (e: any) { setError(e.message); }
    finally { setIgDisconnecting(false); }
  }

  async function save() {
    setSaving(true); setError('');
    try {
      await adminApi.updateTenant(tenant.id, {
        name, whatsappNumber: whatsapp, plan, billingEmail, type,
        provider, reviewsEnabled, surveyEnabled, menusEnabled, shopPhotosEnabled,
        notificationEmail, emailFallbackEnabled,
        metaPhoneNumberId: metaPhoneNumberId || null,
        metaAccessToken:   metaAccessToken   || null,
        metaWabaId:        metaWabaId        || null,
        twilioAccountSid:       twilioAccountSid       || null,
        twilioAuthToken:        twilioAuthToken        || null,
        twilioDeptTemplateSid:  twilioDeptTemplateSid  || null,
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
            {type === 'hotel' && (
              <Input
                label="Dept Notification Template SID (hotel only)"
                value={twilioDeptTemplateSid}
                onChange={(e: any) => setDeptTemplateSid(e.target.value)}
                placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            )}
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
          {type === 'hotel' && (
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={surveyEnabled}
                onClick={() => setSurveyEnabled(v => !v)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${surveyEnabled ? 'bg-green-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${surveyEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-sm text-slate-700">Guest Satisfaction Survey</span>
              <span className="text-xs text-slate-400">{surveyEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          )}
          {type === 'hotel' && (
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={menusEnabled}
                onClick={() => setMenusEnabled(v => !v)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${menusEnabled ? 'bg-orange-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${menusEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-sm text-slate-700">Hotel Menus</span>
              <span className="text-xs text-slate-400">{menusEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          )}
          {type === 'shop' && (
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={shopPhotosEnabled}
                onClick={() => setShopPhotosEnabled(v => !v)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${shopPhotosEnabled ? 'bg-teal-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${shopPhotosEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-sm text-slate-700">Menu item photos</span>
              <span className="text-xs text-slate-400">{shopPhotosEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          )}
        </div>

        {/* Email fallback — all tenant types */}
        <div className="border border-slate-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email fallback</p>
          <Input
            label="Notification email"
            type="email"
            value={notificationEmail}
            onChange={(e: any) => setNotificationEmail(e.target.value)}
            placeholder="manager@hotel.com"
          />
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={emailFallbackEnabled}
              onClick={() => setEmailFallbackEnabled(v => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${emailFallbackEnabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${emailFallbackEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-slate-700">Forward failed messages to email</span>
            <span className="text-xs text-slate-400">{emailFallbackEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
          <p className="text-xs text-slate-400">When ON: only messages that fail to send via WhatsApp are forwarded to the email above, including the guest's message and the AI reply that could not be delivered.</p>
          {emailFallbackEnabled && !notificationEmail && (
            <p className="text-xs text-amber-600 font-medium">⚠️ Enter a notification email above for forwarding to work.</p>
          )}
          {emailFallbackEnabled && notificationEmail && (
            <p className="text-xs text-teal-700 font-medium">✓ Active — undelivered messages will be forwarded to <strong>{notificationEmail}</strong>.</p>
          )}
        </div>

        {/* Channels */}
        <div className="border border-slate-200 rounded-lg p-4 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Channels</p>
          {CHANNELS.map(({ key, label, icon }) => {
            const ch         = channels[key];
            const connected  = ch?.connected  ?? false;
            const aiEnabled  = ch?.ai_enabled ?? false;
            const isToggling = togglingChannel === key;

            // ── Instagram: special connect / disconnect UI ────────────────────
            if (key === 'instagram') {
              return (
                <div key={key} className="border-b border-slate-100 last:border-0 pb-2">
                  {/* Row */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold ${connected ? 'text-green-500' : 'text-slate-300'}`}>●</span>
                      <span className="text-sm text-slate-700">{icon} {label}</span>
                      <span className="text-xs text-slate-400">{connected ? 'Connected' : 'Not connected'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {connected ? (
                        <>
                          <span className="text-xs text-slate-500">AI</span>
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => handleChannelToggle(key, !aiEnabled)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${aiEnabled ? 'bg-green-500' : 'bg-slate-200'} disabled:opacity-50`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${aiEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                          <span className="text-xs">{aiEnabled ? '✅' : '❌'}</span>
                          <button
                            type="button"
                            onClick={() => setIgDisconnectOpen(true)}
                            className="ml-2 text-xs text-red-500 hover:text-red-700 underline"
                          >
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setIgFormOpen(v => !v); setIgConnectError(''); }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {igFormOpen ? 'Cancel ▲' : 'Connect ▼'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline connect form */}
                  {!connected && igFormOpen && (
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                      <Input
                        label="Access Token"
                        value={igToken}
                        onChange={(e: any) => setIgToken(e.target.value)}
                        placeholder="EAAxxxxxxxxx…"
                      />
                      <Input
                        label="Instagram Account ID"
                        value={igAccountId}
                        onChange={(e: any) => setIgAccountId(e.target.value)}
                        placeholder="17841458604442481"
                      />
                      {igConnectError && <p className="text-xs text-red-500">{igConnectError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm" onClick={() => { setIgFormOpen(false); setIgConnectError(''); }}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleInstagramConnect} disabled={igConnecting}>
                          {igConnecting ? 'Saving…' : 'Save & Connect'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Disconnect confirmation */}
                  {connected && igDisconnectOpen && (
                    <div className="mt-1 p-3 bg-red-50 rounded-lg border border-red-200 space-y-2">
                      <p className="text-xs text-red-700 font-medium">
                        Are you sure? This will stop receiving Instagram DMs immediately.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setIgDisconnectOpen(false)}>
                          Cancel
                        </Button>
                        <button
                          type="button"
                          onClick={handleInstagramDisconnect}
                          disabled={igDisconnecting}
                          className="px-3 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          {igDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // ── Email: account list + IMAP add form ──────────────────────────
            if (key === 'email') {
              const anyEnabled = emailAccounts.some((a: any) => a.is_enabled);
              const ef = (k: string) => ({
                value: emailForm[k] ?? '',
                onChange: (e: any) => setEmailForm(p => ({ ...p, [k]: e.target.value })),
              });
              return (
                <div key={key} className="border-b border-slate-100 last:border-0 pb-2">
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold ${anyEnabled ? 'text-green-500' : 'text-slate-300'}`}>●</span>
                      <span className="text-sm text-slate-700">{icon} {label}</span>
                      <span className="text-xs text-slate-400">
                        {emailAccounts.length === 0
                          ? 'No accounts'
                          : `${emailAccounts.filter((a: any) => a.is_enabled).length}/${emailAccounts.length} enabled`}
                      </span>
                    </div>
                    <button type="button"
                      onClick={() => { setEmailFormOpen(v => !v); setEmailError(''); setEmailForm({}); }}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                      {emailFormOpen ? 'Cancel ▲' : 'Add ▼'}
                    </button>
                  </div>

                  {emailAccounts.map((acct: any) => (
                    <div key={acct.id} className="ml-4 mt-1 p-2 bg-slate-50 rounded border border-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-slate-700">{acct.email_address}</p>
                          <p className="text-[10px] text-slate-400">{acct.provider === 'graph' ? 'Microsoft 365' : 'IMAP/SMTP'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" title="Enable/disable"
                            onClick={() => handleEmailToggle(acct.id, 'is_enabled')}
                            className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${acct.is_enabled ? 'bg-green-500' : 'bg-slate-200'}`}>
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${acct.is_enabled ? 'translate-x-3' : 'translate-x-0'}`} />
                          </button>
                          <span className="text-[10px] text-slate-400">On</span>
                          <button type="button" title="AI replies"
                            onClick={() => handleEmailToggle(acct.id, 'ai_enabled')}
                            className={`relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${acct.ai_enabled ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${acct.ai_enabled ? 'translate-x-3' : 'translate-x-0'}`} />
                          </button>
                          <span className="text-[10px] text-slate-400">AI</span>
                          <button type="button" onClick={() => handleEmailDelete(acct.id)}
                            className="text-[10px] text-red-400 hover:text-red-600 ml-1 font-bold">✕</button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {emailFormOpen && (
                    <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                      <p className="text-xs font-medium text-slate-600">Gmail: use an App Password (Google Account → Security → App passwords)</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Email address" type="email" required {...ef('email_address')} />
                        <Input label="Display name" {...ef('display_name')} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="IMAP host" required placeholder="imap.gmail.com" {...ef('imap_host')} />
                        <Input label="IMAP port" placeholder="993" {...ef('imap_port')} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="SMTP host" required placeholder="smtp.gmail.com" {...ef('smtp_host')} />
                        <Input label="SMTP port" placeholder="587" {...ef('smtp_port')} />
                      </div>
                      <Input label="Username" placeholder="same as email" {...ef('username')} />
                      <Input label="Password / App password" type="password" required {...ef('password')} />
                      {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm"
                          onClick={() => { setEmailFormOpen(false); setEmailError(''); }}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleEmailCreate} disabled={emailSaving}>
                          {emailSaving ? 'Saving…' : 'Save & Connect'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // ── Default row (WhatsApp, Facebook) ─────────────────────────────
            return (
              <div key={key} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold ${connected ? 'text-green-500' : 'text-slate-300'}`}>●</span>
                  <span className="text-sm text-slate-700">{icon} {label}</span>
                  <span className="text-xs text-slate-400">{connected ? 'Connected' : 'Not connected'}</span>
                </div>
                {connected && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">AI</span>
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => handleChannelToggle(key, !aiEnabled)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${aiEnabled ? 'bg-green-500' : 'bg-slate-200'} disabled:opacity-50`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${aiEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <span className="text-xs">{aiEnabled ? '✅' : '❌'}</span>
                  </div>
                )}
              </div>
            );
          })}
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
