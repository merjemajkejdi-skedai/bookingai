import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import { airbnbApi } from '../api';
import type { AirbnbListing, AirbnbListingConfig } from '../types';

const EMPTY_CONFIG: AirbnbListingConfig = {
  check_in_time: '', check_out_time: '', wifi_network: '', wifi_password: '',
  door_code: '', house_rules: '', local_recommendations: '',
};

const CONFIG_FIELDS: { key: keyof AirbnbListingConfig; label: string; multiline?: boolean }[] = [
  { key: 'check_in_time',  label: 'Check-in time' },
  { key: 'check_out_time', label: 'Check-out time' },
  { key: 'wifi_network',   label: 'WiFi network' },
  { key: 'wifi_password',  label: 'WiFi password' },
  { key: 'door_code',      label: 'Door / lockbox code' },
  { key: 'house_rules',           label: 'House rules',           multiline: true },
  { key: 'local_recommendations', label: 'Local recommendations', multiline: true },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center gap-1.5 text-xs text-slate-600">
      {on ? <ToggleRight size={18} className="text-brand-500" /> : <ToggleLeft size={18} className="text-slate-400" />}
      {on ? 'Active' : 'Inactive'}
    </button>
  );
}

interface FormState { name: string; address: string; config: AirbnbListingConfig; }
const EMPTY_FORM: FormState = { name: '', address: '', config: { ...EMPTY_CONFIG } };

export function AirbnbListingsPage() {
  const [listings, setListings] = useState<AirbnbListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AirbnbListing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    try { setListings(await airbnbApi.getListings()); } catch { /* silent */ }
  }, []);
  useEffect(() => { load().then(() => setLoading(false)); }, [load]);

  function startCreate() { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }
  function startEdit(l: AirbnbListing) {
    setEditing(l);
    setForm({ name: l.name, address: l.address, config: { ...EMPTY_CONFIG, ...(l.config || {}) } });
    setShowForm(true);
  }

  async function handleSave() {
    try {
      if (editing) await airbnbApi.updateListing(editing.id, form);
      else await airbnbApi.createListing(form);
      setShowForm(false); setEditing(null); setForm(EMPTY_FORM);
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this listing? Its FAQs will also stop being reachable.')) return;
    try { await airbnbApi.deleteListing(id); await load(); } catch (e: any) { alert(e.message); }
  }

  async function toggleActive(l: AirbnbListing) {
    try { await airbnbApi.updateListing(l.id, { is_active: !l.is_active }); await load(); }
    catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Listings</h2>
        <button onClick={startCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Add Listing
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nickname, e.g. Downtown Loft"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            {CONFIG_FIELDS.map(f => f.multiline ? (
              <textarea key={f.key} value={form.config[f.key] || ''} rows={2}
                onChange={e => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                placeholder={f.label}
                className="sm:col-span-2 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-300" />
            ) : (
              <input key={f.key} value={form.config[f.key] || ''}
                onChange={e => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                placeholder={f.label}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setShowForm(false); setEditing(null); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!form.name.trim() || !form.address.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              {editing ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {listings.map(l => (
          <div key={l.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{l.name}</p>
                <p className="text-xs text-slate-500">{l.address}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Toggle on={l.is_active} onChange={() => toggleActive(l)} />
                <button onClick={() => startEdit(l)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition-colors"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(l.id)}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
        {listings.length === 0 && !showForm && (
          <p className="text-sm text-slate-400 text-center py-8">No listings yet — add your first property above.</p>
        )}
      </div>
    </div>
  );
}
