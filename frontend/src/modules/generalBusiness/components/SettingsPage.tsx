import { useState, useEffect, useCallback } from 'react';
import { Save, Plus, Pencil, Trash2, RefreshCw, ToggleLeft, ToggleRight, Building, MapPin, Users, HelpCircle, FileText, Radio } from 'lucide-react';
import clsx from 'clsx';
import { gbApi } from '../api';
import type { GbConfig, GbLocation, GbDepartment, GbFaq, GbDocument } from '../types';

type SubTab = 'config' | 'locations' | 'departments' | 'faqs' | 'documents' | 'channels';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm text-slate-600">
      {on ? <ToggleRight size={20} className="text-brand-500" /> : <ToggleLeft size={20} className="text-slate-400" />}
      {label}
    </button>
  );
}

// ── Config Sub-Tab ───────────────────────────────────────────────────────────

function ConfigTab({ onMenuToggle }: { onMenuToggle: (v: boolean) => void }) {
  const [config, setConfig] = useState<Partial<GbConfig & { menu_enabled: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    gbApi.getConfig().then(c => { if (c) setConfig(c as any); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await gbApi.updateConfig(config as any);
      onMenuToggle(!!(config as any).menu_enabled);
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  }

  if (!loaded) return <div className="flex items-center justify-center h-32"><RefreshCw className="animate-spin text-slate-400" size={20} /></div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Business Name</label>
          <input value={config.business_name || ''} onChange={e => setConfig({ ...config, business_name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
          <input value={config.phone || ''} onChange={e => setConfig({ ...config, phone: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input value={config.email || ''} onChange={e => setConfig({ ...config, email: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Website</label>
          <input value={config.website || ''} onChange={e => setConfig({ ...config, website: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Business Description</label>
        <textarea value={config.business_description || ''} onChange={e => setConfig({ ...config, business_description: e.target.value })} rows={3}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Notification WhatsApp</label>
        <input value={(config as any).notification_whatsapp || ''} onChange={e => setConfig({ ...config, notification_whatsapp: e.target.value } as any)}
          placeholder="+1234567890"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Fallback Message</label>
        <textarea value={config.fallback_message || ''} onChange={e => setConfig({ ...config, fallback_message: e.target.value })} rows={2}
          placeholder="Sorry, I couldn't process your request. Please try again."
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
      </div>

      <div className="flex items-center gap-6 pt-2">
        <Toggle on={config.ai_enabled ?? true} onChange={v => setConfig({ ...config, ai_enabled: v })} label="AI Enabled" />
        <Toggle on={(config as any).menu_enabled ?? false} onChange={v => setConfig({ ...config, menu_enabled: v } as any)} label="Menu & Orders" />
      </div>

      <h3 className="text-sm font-semibold text-slate-700 pt-2">Opening Hours</h3>
      <div className="space-y-2">
        {DAYS.map(day => {
          const hours = (config.opening_hours || {})[day];
          const closed = !hours;
          return (
            <div key={day} className="flex items-center gap-3">
              <span className="w-24 text-sm text-slate-600 capitalize">{day}</span>
              <Toggle on={!closed} onChange={v => {
                const h = { ...(config.opening_hours || {}) };
                h[day] = v ? { open: '09:00', close: '17:00' } : null;
                setConfig({ ...config, opening_hours: h });
              }} label="" />
              {!closed && (
                <>
                  <input type="time" value={hours?.open || '09:00'}
                    onChange={e => {
                      const h = { ...(config.opening_hours || {}) };
                      h[day] = { ...(h[day] || { open: '', close: '' }), open: e.target.value };
                      setConfig({ ...config, opening_hours: h });
                    }}
                    className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm" />
                  <span className="text-slate-400">—</span>
                  <input type="time" value={hours?.close || '17:00'}
                    onChange={e => {
                      const h = { ...(config.opening_hours || {}) };
                      h[day] = { ...(h[day] || { open: '', close: '' }), close: e.target.value };
                      setConfig({ ...config, opening_hours: h });
                    }}
                    className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm" />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-4">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
          <Save size={14} /> {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ── Locations Sub-Tab ────────────────────────────────────────────────────────

function LocationsTab() {
  const [locations, setLocations] = useState<GbLocation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GbLocation | null>(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '' });

  const load = useCallback(async () => {
    try { setLocations(await gbApi.getLocations()); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    try {
      if (editing) await gbApi.updateLocation(editing.id, form);
      else await gbApi.createLocation(form);
      setShowForm(false); setEditing(null); setForm({ name: '', address: '', phone: '' });
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this location?')) return;
    try { await gbApi.deleteLocation(id); await load(); } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', address: '', phone: '' }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Add Location
        </button>
      </div>
      {(showForm || editing) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Location name"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone (optional)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.name.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              {editing ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}
      {locations.map(l => (
        <div key={l.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">{l.name}</p>
            <p className="text-xs text-slate-500">{l.address}{l.phone ? ` | ${l.phone}` : ''}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setEditing(l); setForm({ name: l.name, address: l.address, phone: l.phone || '' }); setShowForm(false); }}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
            <button onClick={() => handleDelete(l.id)}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      {locations.length === 0 && !showForm && <p className="text-sm text-slate-400 text-center py-6">No locations yet</p>}
    </div>
  );
}

// ── Departments Sub-Tab ──────────────────────────────────────────────────────

function DepartmentsTab() {
  const [departments, setDepartments] = useState<GbDepartment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GbDepartment | null>(null);
  const [form, setForm] = useState({ name: '', whatsapp_number: '', request_types: '', response_time_minutes: '60' });

  const load = useCallback(async () => {
    try { setDepartments(await gbApi.getDepartments()); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    try {
      const data = {
        name: form.name,
        whatsapp_number: form.whatsapp_number || undefined,
        request_types: form.request_types.split(',').map(s => s.trim()).filter(Boolean),
        response_time_minutes: parseInt(form.response_time_minutes) || 60,
      };
      if (editing) await gbApi.updateDepartment(editing.id, data as any);
      else await gbApi.createDepartment(data as any);
      setShowForm(false); setEditing(null);
      setForm({ name: '', whatsapp_number: '', request_types: '', response_time_minutes: '60' });
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this department?')) return;
    try { await gbApi.deleteDepartment(id); await load(); } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', whatsapp_number: '', request_types: '', response_time_minutes: '60' }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Add Department
        </button>
      </div>
      {(showForm || editing) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Department name"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.whatsapp_number} onChange={e => setForm({ ...form, whatsapp_number: e.target.value })} placeholder="WhatsApp number (optional)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.request_types} onChange={e => setForm({ ...form, request_types: e.target.value })} placeholder="Request types (comma-separated)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input type="number" value={form.response_time_minutes} onChange={e => setForm({ ...form, response_time_minutes: e.target.value })} placeholder="Response time (minutes)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.name.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              {editing ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}
      {departments.map(d => (
        <div key={d.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">{d.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {d.whatsapp_number && <span className="text-xs text-slate-500">{d.whatsapp_number}</span>}
              {d.request_types?.length > 0 && (
                <span className="text-xs text-slate-400">{d.request_types.join(', ')}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setEditing(d); setForm({ name: d.name, whatsapp_number: d.whatsapp_number || '', request_types: (d.request_types || []).join(', '), response_time_minutes: String(d.response_time_minutes) }); setShowForm(false); }}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
            <button onClick={() => handleDelete(d.id)}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      {departments.length === 0 && !showForm && <p className="text-sm text-slate-400 text-center py-6">No departments yet</p>}
    </div>
  );
}

// ── FAQs Sub-Tab ─────────────────────────────────────────────────────────────

function FaqsTab() {
  const [faqs, setFaqs] = useState<GbFaq[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GbFaq | null>(null);
  const [form, setForm] = useState({ question: '', answer: '' });

  const load = useCallback(async () => {
    try { setFaqs(await gbApi.getFaqs()); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    try {
      if (editing) await gbApi.updateFaq(editing.id, form);
      else await gbApi.createFaq(form);
      setShowForm(false); setEditing(null); setForm({ question: '', answer: '' });
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this FAQ?')) return;
    try { await gbApi.deleteFaq(id); await load(); } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setShowForm(true); setEditing(null); setForm({ question: '', answer: '' }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Add FAQ
        </button>
      </div>
      {(showForm || editing) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <input value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} placeholder="Question"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <textarea value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} placeholder="Answer" rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.question.trim() || !form.answer.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              {editing ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}
      {faqs.map(f => (
        <div key={f.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{f.question}</p>
              <p className="text-xs text-slate-500 mt-1">{f.answer}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
              <button onClick={() => { setEditing(f); setForm({ question: f.question, answer: f.answer }); setShowForm(false); }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
              <button onClick={() => handleDelete(f.id)}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      ))}
      {faqs.length === 0 && !showForm && <p className="text-sm text-slate-400 text-center py-6">No FAQs yet</p>}
    </div>
  );
}

// ── Documents Sub-Tab ────────────────────────────────────────────────────────

function DocumentsTab() {
  const [documents, setDocuments] = useState<GbDocument[]>([]);

  const load = useCallback(async () => {
    try { setDocuments(await gbApi.getDocuments()); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleToggle(id: string, active: boolean) {
    try { await gbApi.toggleDocument(id, active); await load(); } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document?')) return;
    try { await gbApi.deleteDocument(id); await load(); } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Documents are uploaded via the API. Toggle them on/off to include in the AI's knowledge base.</p>
      {documents.map(d => (
        <div key={d.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <FileText size={16} className="text-slate-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{d.name}</p>
              <p className="text-xs text-slate-400">{d.file_type} {d.file_size_bytes ? `| ${(d.file_size_bytes / 1024).toFixed(0)} KB` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Toggle on={d.is_active} onChange={v => handleToggle(d.id, v)} label="" />
            <button onClick={() => handleDelete(d.id)}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      {documents.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No documents uploaded</p>}
    </div>
  );
}

// ── Channels Sub-Tab ─────────────────────────────────────────────────────────

function ChannelsTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Channel connections are managed at the tenant level. The General Business AI agent will automatically respond on all connected channels:</p>
      <div className="space-y-3">
        {[
          { name: 'WhatsApp', desc: 'Connected via Twilio. Configure in admin panel.' },
          { name: 'Instagram', desc: 'Connected via Meta API. Configure in admin panel.' },
          { name: 'Messenger', desc: 'Connected via Facebook Page. Configure in admin panel.' },
          { name: 'Email', desc: 'Connected via IMAP/SMTP or Microsoft Graph. Configure in hotel settings.' },
        ].map(ch => (
          <div key={ch.name} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <Radio size={16} className="text-brand-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">{ch.name}</p>
              <p className="text-xs text-slate-500">{ch.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Settings Page ───────────────────────────────────────────────────────

export function GbSettingsPage({ onMenuToggle }: { onMenuToggle: (v: boolean) => void }) {
  const [subTab, setSubTab] = useState<SubTab>('config');

  const tabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'config',      label: 'General',     icon: <Building size={14} /> },
    { id: 'locations',   label: 'Locations',    icon: <MapPin size={14} /> },
    { id: 'departments', label: 'Departments',  icon: <Users size={14} /> },
    { id: 'faqs',        label: 'FAQs',         icon: <HelpCircle size={14} /> },
    { id: 'documents',   label: 'Documents',    icon: <FileText size={14} /> },
    { id: 'channels',    label: 'Channels',     icon: <Radio size={14} /> },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              subTab === t.id ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {subTab === 'config'      && <ConfigTab onMenuToggle={onMenuToggle} />}
        {subTab === 'locations'   && <LocationsTab />}
        {subTab === 'departments' && <DepartmentsTab />}
        {subTab === 'faqs'        && <FaqsTab />}
        {subTab === 'documents'   && <DocumentsTab />}
        {subTab === 'channels'    && <ChannelsTab />}
      </div>
    </div>
  );
}
