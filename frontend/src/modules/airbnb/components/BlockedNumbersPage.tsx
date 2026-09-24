import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, ShieldOff } from 'lucide-react';
import { airbnbApi } from '../api';
import type { AirbnbBlockedNumber } from '../types';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function AirbnbBlockedNumbersPage() {
  const [numbers, setNumbers] = useState<AirbnbBlockedNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ phone_number: '', reason: '' });

  const load = useCallback(async () => {
    try { setNumbers(await airbnbApi.getBlockedNumbers()); } catch { /* silent */ }
  }, []);
  useEffect(() => { load().then(() => setLoading(false)); }, [load]);

  async function handleAdd() {
    try {
      await airbnbApi.addBlockedNumber(form);
      setForm({ phone_number: '', reason: '' });
      setShowForm(false);
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleRemove(id: string) {
    if (!confirm('Unblock this number?')) return;
    try { await airbnbApi.removeBlockedNumber(id); await load(); } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Blocked Numbers</h2>
          <p className="text-xs text-slate-400 mt-0.5">A blocked number gets no AI response at all — no reply, no conversation logged.</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors">
          <Plus size={14} /> Block a number
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 mb-4">
          <input value={form.phone_number} onChange={e => setForm({ ...form, phone_number: e.target.value })} placeholder="+355691234567"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Reason (optional)"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={!form.phone_number.trim()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors">
              Block
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {numbers.map(n => (
          <div key={n.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <ShieldOff size={16} className="text-red-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{n.phone_number}</p>
                {n.reason && <p className="text-xs text-slate-500 truncate">{n.reason}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-[10px] text-slate-400">{timeAgo(n.created_at)}</span>
              <button onClick={() => handleRemove(n.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {numbers.length === 0 && !showForm && (
          <p className="text-sm text-slate-400 text-center py-8">No blocked numbers</p>
        )}
      </div>
    </div>
  );
}
