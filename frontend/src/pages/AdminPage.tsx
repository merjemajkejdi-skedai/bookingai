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
  const [adminTab, setAdminTab]   = useState<'shops' | 'leads' | 'ig_leads'>('shops');

  async function load() {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([adminApi.getTenants(), adminApi.getStats()]);
      setTenants(t); setStats(s);
      onTenantsLoaded?.(t.map((x: any) => ({ id: x.id, name: x.name, type: x.type })));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Handle Meta Embedded Signup OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    let state: any = {};
    try { state = JSON.parse(params.get('state') || '{}'); } catch {}
    window.history.replaceState({}, '', window.location.pathname);

    if (state.source !== 'tenant_settings') return;

    const baseUrl = (import.meta as any).env?.VITE_API_URL || '';
    const redirectUri = window.location.origin + '/';
    fetch(`${baseUrl}/api/whatsapp/embedded-signup/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, source: 'tenant_settings', tenantId: state.tenantId, redirect_uri: redirectUri }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          alert(`WhatsApp connected! Phone: ${data.data?.phoneNumber || 'detected'}`);
          load();
        } else {
          alert(`Connection failed: ${data.error || 'Unknown error'}`);
        }
      })
      .catch(() => alert('Connection failed. Please try again.'));
  }, []);

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

      {/* Tab buttons */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {(['shops', 'leads', 'ig_leads'] as const).map(tab => (
          <button key={tab} onClick={() => setAdminTab(tab)}
            className={clsx('px-3 py-1.5 text-sm font-medium border-b-2 transition-colors capitalize', adminTab === tab ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600')}>
            {tab === 'leads' ? 'WA Leads' : tab === 'ig_leads' ? 'IG Leads' : tab}
          </button>
        ))}
      </div>

      {/* WhatsApp Leads */}
      {adminTab === 'leads' && <WhatsAppLeadsView tenants={tenants} onCreateTenant={() => setCreating(true)} onReload={load} />}

      {/* Instagram Leads */}
      {adminTab === 'ig_leads' && <InstagramLeadsView tenants={tenants} onCreateTenant={() => setCreating(true)} onReload={load} />}

      {/* Tenant list */}
      {adminTab === 'shops' && (loading ? <Spinner /> : (
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
      ))}

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
  const [channels, setChannels]               = useState<Record<string, { connected: boolean; ai_enabled: boolean; page_name?: string | null; connection_type?: string | null }>>({});
  const [togglingChannel, setTogglingChannel] = useState<string | null>(null);
  // Instagram connect form
  const [igFormOpen, setIgFormOpen]           = useState(false);
  const [igToken, setIgToken]                 = useState('');
  const [igAccountId, setIgAccountId]         = useState('');
  const [igConnecting, setIgConnecting]       = useState(false);
  const [igConnectError, setIgConnectError]   = useState('');
  // Instagram OAuth connect
  const [igOAuthConnecting, setIgOAuthConnecting] = useState(false);
  const [igOAuthError, setIgOAuthError]           = useState('');
  const [igOAuthSuccess, setIgOAuthSuccess]       = useState('');
  // Instagram disconnect confirm
  const [igDisconnectOpen, setIgDisconnectOpen]   = useState(false);
  const [igDisconnecting, setIgDisconnecting]     = useState(false);
  // Messenger connect form
  const [fbFormOpen, setFbFormOpen]               = useState(false);
  const [fbPageId, setFbPageId]                   = useState('');
  const [fbToken, setFbToken]                     = useState('');
  const [fbConnecting, setFbConnecting]           = useState(false);
  const [fbConnectError, setFbConnectError]       = useState('');
  const [fbDisconnectOpen, setFbDisconnectOpen]   = useState(false);
  const [fbDisconnecting, setFbDisconnecting]     = useState(false);
  // Email accounts
  const [emailAccounts, setEmailAccounts]     = useState<any[]>([]);
  const [emailFormOpen, setEmailFormOpen]     = useState(false);
  const [emailForm, setEmailForm]             = useState<Record<string, string>>({});
  const [emailSaving, setEmailSaving]         = useState(false);
  const [emailError, setEmailError]           = useState('');
  const [emailProvider, setEmailProvider]     = useState<'imap' | 'microsoft'>('imap');
  const [emailOauthLoading, setEmailOauthLoading] = useState(false);
  const [sendModeLoading, setSendModeLoading]     = useState<string | null>(null); // accountId
  const [sendModeConfirm, setSendModeConfirm]     = useState<{ id: string; mode: 'resend' | 'graph' } | null>(null);
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

  function handleInstagramOAuthConnect() {
    setIgOAuthError('');
    setIgOAuthConnecting(true);

    const loadFbSdk = (): Promise<void> => {
      if ((window as any).FB) return Promise.resolve();
      return new Promise((resolve) => {
        (window as any).fbAsyncInit = () => {
          (window as any).FB.init({ appId: '1507114490265475', cookie: true, xfbml: true, version: 'v26.0' });
          resolve();
        };
        const s = document.createElement('script');
        s.src = 'https://connect.facebook.net/en_US/sdk.js';
        s.async = true;
        document.body.appendChild(s);
      });
    };

    loadFbSdk().then(() => {
      const FB = (window as any).FB;
      FB.login((response: any) => {
        if (!response.authResponse) {
          setIgOAuthConnecting(false);
          return;
        }
        const base = (import.meta.env.VITE_API_URL as string) ?? '';
        fetch(`${base}/api/instagram/oauth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: response.authResponse.code,
            source: 'tenant_settings',
            tenantId: tenant.id,
            redirect_uri: window.location.origin + '/settings/instagram/oauth/callback',
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              setIgOAuthSuccess(data.data?.username ? `Connected @${data.data.username}` : 'Connected');
              setChannels(prev => ({ ...prev, instagram: { connected: true, ai_enabled: false, connection_type: 'oauth' } }));
            } else {
              setIgOAuthError(data.error || 'Connection failed');
            }
          })
          .catch(() => setIgOAuthError('Connection failed'))
          .finally(() => setIgOAuthConnecting(false));
      }, {
        config_id: '2847372545620772',
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureName: 'instagram_onboarding', sessionInfoVersion: '3' },
      });
    });
  }

  async function handleEmailCreate() {
    if (!emailForm.email_address || !emailForm.imap_host || !emailForm.password) {
      setEmailError('Email address, IMAP host and password are required');
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

  async function handleSendModeChange(accountId: string, mode: 'resend' | 'graph') {
    setSendModeConfirm(null);
    setSendModeLoading(accountId);
    try {
      const updated = await adminApi.patchEmailSendMode(tenant.id, accountId, mode);
      setEmailAccounts(prev => prev.map((a: any) => a.id === accountId ? { ...a, ...updated } : a));
    } catch (e: any) { setError(e.message); }
    finally { setSendModeLoading(null); }
  }

  async function handleEmailDelete(accountId: string) {
    try {
      await adminApi.deleteEmailAccount(tenant.id, accountId);
      setEmailAccounts(prev => prev.filter((a: any) => a.id !== accountId));
    } catch (e: any) { setError(e.message); }
  }

  function handleMicrosoftConnect(reconnectFor?: string) {
    setEmailOauthLoading(true);
    setEmailError('');
    const base = (import.meta.env.VITE_API_URL as string) ?? '';
    const oauthUrl = `${base}/hotel/email/oauth/microsoft/start?tenantId=${encodeURIComponent(tenant.id)}`;
    const popup = window.open(oauthUrl, '_blank', 'width=600,height=700,left=200,top=100');

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'MICROSOFT_OAUTH_SUCCESS') {
        window.removeEventListener('message', handler);
        setEmailOauthLoading(false);
        setEmailFormOpen(false);
        setEmailProvider('imap');
        adminApi.getEmailAccounts(tenant.id).then(setEmailAccounts).catch(() => {});
      } else if (event.data?.type === 'MICROSOFT_OAUTH_ERROR') {
        window.removeEventListener('message', handler);
        setEmailOauthLoading(false);
        setEmailError(event.data.error ?? 'Microsoft connection failed');
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      setEmailOauthLoading(false);
      if (popup && !popup.closed) popup.close();
    }, 5 * 60 * 1000);
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

  async function handleMessengerConnect() {
    if (!fbPageId.trim() || !fbToken.trim()) {
      setFbConnectError('Page ID and Page Token are required');
      return;
    }
    setFbConnecting(true); setFbConnectError('');
    try {
      const result = await adminApi.connectMessenger(tenant.id, {
        page_id: fbPageId.trim(),
        access_token: fbToken.trim(),
      });
      setChannels(prev => ({
        ...prev,
        facebook: { connected: true, ai_enabled: true, page_name: result?.page_name },
      }));
      setFbFormOpen(false); setFbPageId(''); setFbToken('');
    } catch (e: any) { setFbConnectError(e.message); }
    finally { setFbConnecting(false); }
  }

  async function handleMessengerDisconnect() {
    setFbDisconnecting(true);
    try {
      await adminApi.disconnectMessenger(tenant.id);
      setChannels(prev => ({ ...prev, facebook: { connected: false, ai_enabled: false } }));
      setFbDisconnectOpen(false);
    } catch (e: any) { setError(e.message); }
    finally { setFbDisconnecting(false); }
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
            {whatsapp ? (
              <div className="p-2 bg-white rounded border border-green-300 text-xs text-green-700 flex items-center gap-2">
                <Phone size={12} /> Connected: {whatsapp.replace(/^whatsapp:/, '')}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const configId = '1757192855330030';
                  const appId = '1507114490265475';
                  const redirectUri = window.location.origin + '/';
                  const state = JSON.stringify({ source: 'tenant_settings', tenantId: tenant.id });
                  window.location.href = 'https://www.facebook.com/v26.0/dialog/oauth'
                    + '?client_id=' + appId
                    + '&config_id=' + configId
                    + '&response_type=code'
                    + '&override_default_response_type=true'
                    + '&redirect_uri=' + encodeURIComponent(redirectUri)
                    + '&state=' + encodeURIComponent(state)
                    + '&extras=' + encodeURIComponent(JSON.stringify({
                        setup: {},
                        featureName: 'whatsapp_embedded_signup',
                        sessionInfoVersion: '3',
                      }));
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#25D366] text-white text-xs font-semibold rounded-lg hover:bg-[#20bd5a] transition-colors">
                Connect via Embedded Signup
              </button>
            )}
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
                      <span className="text-xs text-slate-400">
                        {connected
                          ? `Connected (${ch?.connection_type === 'oauth' ? 'OAuth — auto-renews' : 'manual token'})`
                          : 'Not connected'}
                      </span>
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
                          {igFormOpen ? 'Cancel ▲' : 'Manual Connect ▼'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* OAuth connect (admin) */}
                  {!connected && (
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Connect via OAuth</p>
                      <button
                        type="button"
                        onClick={handleInstagramOAuthConnect}
                        disabled={igOAuthConnecting}
                        className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm font-medium text-white hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 transition-all"
                      >
                        📷 {igOAuthConnecting ? 'Connecting…' : 'Connect Instagram Account'}
                      </button>
                      {igOAuthError && <p className="text-xs text-red-500">{igOAuthError}</p>}
                      {igOAuthSuccess && <p className="text-xs text-green-600">{igOAuthSuccess}</p>}
                    </div>
                  )}

                  {/* Manual connect form (admin only) */}
                  {!connected && igFormOpen && (
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Admin — Manual override</p>
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

            // ── Facebook Messenger: connect / disconnect UI ─────────────────
            if (key === 'facebook') {
              return (
                <div key={key} className="border-b border-slate-100 last:border-0 pb-2">
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold ${connected ? 'text-green-500' : 'text-slate-300'}`}>●</span>
                      <span className="text-sm text-slate-700">{icon} {label}</span>
                      <span className="text-xs text-slate-400">
                        {connected ? (ch?.page_name || 'Connected') : 'Not connected'}
                      </span>
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
                            onClick={() => setFbDisconnectOpen(true)}
                            className="ml-2 text-xs text-red-500 hover:text-red-700 underline"
                          >
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setFbFormOpen(v => !v); setFbConnectError(''); }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {fbFormOpen ? 'Cancel ▲' : 'Connect ▼'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!connected && fbFormOpen && (
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                      <Input
                        label="Page ID"
                        value={fbPageId}
                        onChange={(e: any) => setFbPageId(e.target.value)}
                        placeholder="123456789012345"
                      />
                      <Input
                        label="Page Token"
                        value={fbToken}
                        onChange={(e: any) => setFbToken(e.target.value)}
                        placeholder="EAAxxxxxxxxx…"
                      />
                      {fbConnectError && <p className="text-xs text-red-500">{fbConnectError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm" onClick={() => { setFbFormOpen(false); setFbConnectError(''); }}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleMessengerConnect} disabled={fbConnecting}>
                          {fbConnecting ? 'Saving…' : 'Save & Connect'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {connected && fbDisconnectOpen && (
                    <div className="mt-1 p-3 bg-red-50 rounded-lg border border-red-200 space-y-2">
                      <p className="text-xs text-red-700 font-medium">
                        Are you sure? This will stop receiving Messenger messages immediately.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setFbDisconnectOpen(false)}>
                          Cancel
                        </Button>
                        <button
                          type="button"
                          onClick={handleMessengerDisconnect}
                          disabled={fbDisconnecting}
                          className="px-3 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          {fbDisconnecting ? 'Disconnecting…' : 'Disconnect'}
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
                      onClick={() => { setEmailFormOpen(v => !v); setEmailError(''); setEmailForm({}); setEmailProvider('imap'); }}
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
                      {acct.provider === 'graph' && acct.last_error === 'oauth_refresh_failed' && (
                        <div className="mt-1.5 flex items-center gap-2 p-1.5 bg-amber-50 border border-amber-200 rounded">
                          <span className="text-[10px] text-amber-700 font-medium">⚠ Token expired — reconnect needed</span>
                          <button type="button"
                            onClick={() => handleMicrosoftConnect(acct.id)}
                            disabled={emailOauthLoading}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold underline disabled:opacity-50">
                            {emailOauthLoading ? 'Connecting…' : 'Reconnect Microsoft'}
                          </button>
                        </div>
                      )}
                      {acct.provider === 'graph' && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">Send via:</span>
                          <button type="button"
                            title="Send replies via SkedAI Resend (recommended — always works)"
                            disabled={sendModeLoading === acct.id}
                            onClick={() => (acct.send_mode ?? 'resend') !== 'resend' && setSendModeConfirm({ id: acct.id, mode: 'resend' })}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${(acct.send_mode ?? 'resend') === 'resend' ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                            Resend
                          </button>
                          <button type="button"
                            title="Send replies directly via Microsoft Graph (saves to your Sent Items)"
                            disabled={sendModeLoading === acct.id || acct.last_error === 'oauth_refresh_failed'}
                            onClick={() => (acct.send_mode ?? 'resend') !== 'graph' && setSendModeConfirm({ id: acct.id, mode: 'graph' })}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${(acct.send_mode ?? 'resend') === 'graph' ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40'}`}>
                            {sendModeLoading === acct.id ? '…' : 'Graph'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {sendModeConfirm && (
                    <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 space-y-2">
                      <p className="font-medium">
                        {sendModeConfirm.mode === 'graph'
                          ? 'Switch to Graph send? Replies will be sent via Microsoft Graph and saved to your Sent Items automatically. Requires a valid Microsoft token.'
                          : 'Switch to Resend? Replies will be sent via SkedAI (noreply@skedai.net). The Reply-To will point to your email address.'}
                      </p>
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => handleSendModeChange(sendModeConfirm.id, sendModeConfirm.mode)}
                          className="px-2 py-1 bg-amber-600 text-white rounded text-[10px] font-medium hover:bg-amber-700">
                          Confirm
                        </button>
                        <button type="button"
                          onClick={() => setSendModeConfirm(null)}
                          className="px-2 py-1 bg-white border border-amber-300 rounded text-[10px] font-medium text-amber-700 hover:bg-amber-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {emailFormOpen && (
                    <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                      <div className="p-2 bg-blue-50 border border-blue-100 rounded text-[11px] text-blue-700 space-y-0.5">
                        <p className="font-medium">How replies are sent</p>
                        <p>AI replies go out from <strong>noreply@skedai.net</strong> via SkedAI. The Reply-To header is set to your email address, so when a guest replies it lands back in your inbox.</p>
                      </div>

                      {/* Provider radio */}
                      <div className="flex gap-4">
                        {(['imap', 'microsoft'] as const).map(p => (
                          <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="emailProvider" value={p}
                              checked={emailProvider === p}
                              onChange={() => setEmailProvider(p)}
                              className="accent-indigo-600" />
                            <span className="text-xs text-slate-700">
                              {p === 'imap' ? 'IMAP / Gmail' : 'Microsoft 365 / Outlook'}
                            </span>
                          </label>
                        ))}
                      </div>

                      {emailProvider === 'imap' && (<>
                        <p className="text-xs font-medium text-slate-600">Gmail: use an App Password (Google Account → Security → App passwords)</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Input label="Email address" type="email" required {...ef('email_address')} />
                          <Input label="Display name" {...ef('display_name')} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input label="IMAP host" required placeholder="imap.gmail.com" {...ef('imap_host')} />
                          <Input label="IMAP port" placeholder="993" {...ef('imap_port')} />
                        </div>
                        <Input label="Username" placeholder="same as email" {...ef('username')} />
                        <Input label="Password / App password" type="password" required {...ef('password')} />
                      </>)}

                      {emailProvider === 'microsoft' && (
                        <div className="py-2 text-center space-y-2">
                          <p className="text-xs text-slate-500">Sign in with your Microsoft / Outlook account. We'll only access your SkedAI inbox folder.</p>
                          <button type="button"
                            onClick={() => handleMicrosoftConnect()}
                            disabled={emailOauthLoading}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2f2f2f] text-white text-xs font-medium hover:bg-black disabled:opacity-50 transition-colors">
                            <svg width="16" height="16" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                            {emailOauthLoading ? 'Connecting…' : 'Sign in with Microsoft'}
                          </button>
                        </div>
                      )}

                      {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm"
                          onClick={() => { setEmailFormOpen(false); setEmailError(''); setEmailProvider('imap'); }}>
                          Cancel
                        </Button>
                        {emailProvider === 'imap' && (
                          <Button size="sm" onClick={handleEmailCreate} disabled={emailSaving}>
                            {emailSaving ? 'Saving…' : 'Save & Connect'}
                          </Button>
                        )}
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

// --- WhatsApp Signup Leads View -----------------------------------------------
function WhatsAppLeadsView({ tenants, onCreateTenant, onReload }: { tenants: any[]; onCreateTenant: () => void; onReload: () => void }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');

  async function loadLeads() {
    setLoading(true);
    try { setLeads(await adminApi.getWhatsAppLeads()); }
    catch (e: any) { console.error('Failed to load leads:', e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadLeads(); }, []);

  async function updateStatus(leadId: string, status: string) {
    try {
      await adminApi.updateWhatsAppLead(leadId, { status });
      loadLeads();
    } catch (e: any) { alert(e.message); }
  }

  async function saveNotes(leadId: string) {
    try {
      await adminApi.updateWhatsAppLead(leadId, { notes: notesText });
      setEditingNotes(null);
      loadLeads();
    } catch (e: any) { alert(e.message); }
  }

  const statusColor: Record<string, string> = {
    pending:        'bg-amber-100 text-amber-700',
    contacted:      'bg-blue-100 text-blue-700',
    tenant_created: 'bg-green-100 text-green-700',
    rejected:       'bg-red-100 text-red-700',
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {leads.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">No WhatsApp signup leads yet.</p>
        </div>
      )}
      {leads.map((lead: any) => (
        <div key={lead.id} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-slate-800">{lead.business_name || 'Unknown Business'}</p>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', statusColor[lead.status] || statusColor.pending)}>
                  {lead.status}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                {lead.phone_number && <span><Phone size={10} className="inline mr-0.5" /> {lead.phone_number}</span>}
                <span>WABA: {lead.waba_id}</span>
                <span>{new Date(lead.created_at).toLocaleString()}</span>
                {lead.tenant_id && (
                  <span className="text-green-600 font-medium">
                    Tenant: {tenants.find(t => t.id === lead.tenant_id)?.name || lead.tenant_id.slice(0, 8)}
                  </span>
                )}
              </div>
              {lead.notes && !editingNotes && (
                <p className="mt-1 text-xs text-slate-500 italic">{lead.notes}</p>
              )}
              {editingNotes === lead.id && (
                <div className="mt-2 flex gap-2">
                  <input type="text" value={notesText} onChange={e => setNotesText(e.target.value)}
                    className="flex-1 text-xs border border-slate-200 rounded px-2 py-1"
                    placeholder="Add notes..." />
                  <Button size="sm" onClick={() => saveNotes(lead.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>Cancel</Button>
                </div>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              {lead.status === 'pending' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => updateStatus(lead.id, 'contacted')}>
                    Mark Contacted
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => updateStatus(lead.id, 'rejected')}>
                    Reject
                  </Button>
                </>
              )}
              {lead.status !== 'tenant_created' && lead.status !== 'rejected' && (
                <Button size="sm" onClick={() => {
                  onCreateTenant();
                }}>
                  Create Tenant
                </Button>
              )}
              {!editingNotes && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditingNotes(lead.id);
                  setNotesText(lead.notes || '');
                }}>
                  <Pencil size={12} />
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InstagramLeadsView({ tenants, onCreateTenant, onReload }: { tenants: any[]; onCreateTenant: () => void; onReload: () => void }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');

  async function loadLeads() {
    setLoading(true);
    try { setLeads(await adminApi.getInstagramLeads()); }
    catch (e: any) { console.error('Failed to load IG leads:', e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadLeads(); }, []);

  async function updateStatus(leadId: string, status: string) {
    try {
      await adminApi.updateInstagramLead(leadId, { status });
      loadLeads();
    } catch (e: any) { alert(e.message); }
  }

  async function saveNotes(leadId: string) {
    try {
      await adminApi.updateInstagramLead(leadId, { notes: notesText });
      setEditingNotes(null);
      loadLeads();
    } catch (e: any) { alert(e.message); }
  }

  const statusColor: Record<string, string> = {
    pending:        'bg-amber-100 text-amber-700',
    contacted:      'bg-blue-100 text-blue-700',
    tenant_created: 'bg-green-100 text-green-700',
    rejected:       'bg-red-100 text-red-700',
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {leads.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">No Instagram signup leads yet.</p>
        </div>
      )}
      {leads.map((lead: any) => (
        <div key={lead.id} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-slate-800">@{lead.instagram_username || 'unknown'}</p>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', statusColor[lead.status] || statusColor.pending)}>
                  {lead.status}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                {lead.facebook_page_name && <span>Page: {lead.facebook_page_name}</span>}
                <span>IG ID: {lead.instagram_account_id}</span>
                <span>{new Date(lead.created_at).toLocaleString()}</span>
                {lead.tenant_id && (
                  <span className="text-green-600 font-medium">
                    Tenant: {tenants.find(t => t.id === lead.tenant_id)?.name || lead.tenant_id.slice(0, 8)}
                  </span>
                )}
              </div>
              {lead.notes && !editingNotes && (
                <p className="mt-1 text-xs text-slate-500 italic">{lead.notes}</p>
              )}
              {editingNotes === lead.id && (
                <div className="mt-2 flex gap-2">
                  <input type="text" value={notesText} onChange={e => setNotesText(e.target.value)}
                    className="flex-1 text-xs border border-slate-200 rounded px-2 py-1"
                    placeholder="Add notes..." />
                  <Button size="sm" onClick={() => saveNotes(lead.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>Cancel</Button>
                </div>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              {lead.status === 'pending' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => updateStatus(lead.id, 'contacted')}>
                    Mark Contacted
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => updateStatus(lead.id, 'rejected')}>
                    Reject
                  </Button>
                </>
              )}
              {lead.status !== 'tenant_created' && lead.status !== 'rejected' && (
                <Button size="sm" onClick={() => {
                  onCreateTenant();
                }}>
                  Create Tenant
                </Button>
              )}
              {!editingNotes && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditingNotes(lead.id);
                  setNotesText(lead.notes || '');
                }}>
                  <Pencil size={12} />
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
