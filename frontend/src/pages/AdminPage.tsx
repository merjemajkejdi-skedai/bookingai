import { useState, useEffect } from 'react';
import { Plus, Pencil, RefreshCw, Power, Phone, ExternalLink, BarChart2, Copy, Check } from 'lucide-react';
import { adminApi } from '../shared/lib/auth';
import type { AdminTenant } from '../shared/lib/auth';
import { Button, Modal, Input, Select, Spinner } from '../components/ui';
import clsx from 'clsx';

const PLANS = ['starter', 'growth', 'pro'];
const TYPES = ['barbershop', 'salon', 'dentist', 'medical', 'hotel', 'art_class', 'art_event'];

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
  const [name, setName]               = useState(tenant.name);
  const [whatsapp, setWhatsapp]       = useState(tenant.whatsapp_number || '');
  const [plan, setPlan]               = useState(tenant.plan || 'starter');
  const [billingEmail, setBilling]    = useState(tenant.billing_email || '');
  const [type, setType]               = useState(tenant.type || 'barbershop');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  async function save() {
    setSaving(true); setError('');
    try {
      await adminApi.updateTenant(tenant.id, { name, whatsappNumber: whatsapp, plan, billingEmail, type });
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
