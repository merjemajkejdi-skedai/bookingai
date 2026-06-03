import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, UserCog, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { BlockedNumber } from '../types';
import { Spinner } from '../ui';

const STAFF_ROLES = [
  'Maintenance',
  'Housekeeping',
  'Reception',
  'F&B / Room Service',
  'Security',
  'Management',
  'Other',
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatPhone(phone: string) {
  return phone.replace('whatsapp:', '');
}

function initials(name: string | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Add form ──────────────────────────────────────────────────────────────────

function AddForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [form, setForm]   = useState({ phone: '', staff_name: '', staff_role: 'Maintenance' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const phone = form.phone.trim();
    const name  = form.staff_name.trim();
    if (!phone) { setError('Phone number is required'); return; }
    if (!name)  { setError('Staff name is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.addBlocked({
        phone,
        staff_name: name,
        staff_role: form.staff_role,
        is_staff:   true,
      });
      onSave();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="+355691234567"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <input
          placeholder="Full name"
          value={form.staff_name}
          onChange={e => setForm(f => ({ ...f, staff_name: e.target.value }))}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={form.staff_role}
          onChange={e => setForm(f => ({ ...f, staff_role: e.target.value }))}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {STAFF_ROLES.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !form.phone || !form.staff_name}
          className="text-xs font-medium px-3 py-1.5 bg-brand-500 text-white rounded-lg disabled:opacity-40 hover:bg-brand-600 transition-colors"
        >
          {saving ? <RefreshCw size={12} className="animate-spin inline" /> : 'Add staff member'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BlockedPage() {
  const [staff, setStaff]     = useState<BlockedNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getBlocked()
      .then(setStaff)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRemove(phone: string, name: string | null) {
    if (!confirm(`Remove ${name || formatPhone(phone)} from staff list?`)) return;
    setRemoving(phone);
    try {
      await api.removeBlocked(phone);
      setStaff(s => s.filter(b => b.phone !== phone));
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Staff Numbers</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Staff can text the hotel number to update request statuses — their messages never trigger the guest AI
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors"
            >
              <Plus size={13} /> Add staff
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="flex-shrink-0">
          <AddForm
            onSave={() => { setAdding(false); load(); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {/* Staff list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
        {loading ? <Spinner /> : staff.length === 0 && !adding ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <UserCog size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No staff numbers added yet</p>
            <p className="text-xs mt-1">Add staff so they can update requests via WhatsApp</p>
          </div>
        ) : (
          staff.map(s => (
            <div
              key={s.phone}
              className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5"
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-brand-600">
                  {initials(s.staff_name)}
                </span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {s.staff_name || 'Unknown'}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {formatPhone(s.phone)}
                  {s.staff_role ? ` · ${s.staff_role}` : ''}
                </p>
              </div>

              {/* Role badge */}
              {s.staff_role && (
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex-shrink-0">
                  {s.staff_role}
                </span>
              )}

              <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(s.created_at)}</span>

              {/* Remove */}
              <button
                onClick={() => handleRemove(s.phone, s.staff_name)}
                disabled={removing === s.phone}
                className={clsx(
                  'p-1.5 rounded-lg transition-colors flex-shrink-0',
                  removing === s.phone
                    ? 'text-slate-300'
                    : 'text-slate-300 hover:text-red-500 hover:bg-red-50'
                )}
              >
                {removing === s.phone
                  ? <RefreshCw size={14} className="animate-spin" />
                  : <Trash2 size={14} />}
              </button>
            </div>
          ))
        )}
      </div>

      {/* How it works */}
      <div className="flex-shrink-0 bg-blue-50 border border-blue-100 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare size={13} className="text-blue-600" />
          <p className="text-xs font-semibold text-blue-700">How staff update requests</p>
        </div>
        <div className="text-xs text-blue-600 space-y-0.5">
          <p>📱 Text <strong>"205 done"</strong> → marks room 205 request as resolved</p>
          <p>📱 Text <strong>"205 in progress"</strong> → marks as in progress</p>
          <p>📱 Text <strong>"205 AC needed a part"</strong> → saves note on the request</p>
          <p>📱 Multiple open requests → AI lists them, reply with <strong>"205-1 done"</strong></p>
        </div>
      </div>
    </div>
  );
}
