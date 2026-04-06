import { useState, useEffect, useCallback } from 'react';
import { ShieldOff, Plus, Trash2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { BlockedNumber } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

function formatPhone(phone: string) {
  return phone.replace('whatsapp:', '');
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Add modal ─────────────────────────────────────────────────────────────────

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [phone, setPhone]   = useState('');
  const [label, setLabel]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = phone.trim();
    if (!cleaned) { setError('Phone number is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.addBlocked({ phone: cleaned, label: label.trim() || undefined });
      onAdded();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Block a Number" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-500">
          Blocked numbers will be silently ignored by the AI concierge.
          Use this for staff, suppliers and internal lines.
        </p>

        <Input
          label="Phone number *"
          placeholder="+355 69 123 4567"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          required
        />

        <Input
          label="Label (optional)"
          placeholder="e.g. Housekeeping staff, Laundry supplier"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} className="flex-1">
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <ShieldOff size={13} />}
            Block number
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BlockedPage() {
  const [numbers, setNumbers]   = useState<BlockedNumber[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getBlocked()
      .then(setNumbers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRemove(phone: string) {
    if (!confirm(`Unblock ${formatPhone(phone)}?`)) return;
    setRemoving(phone);
    try {
      await api.removeBlocked(phone);
      setNumbers(n => n.filter(b => b.phone !== phone));
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
          <h1 className="text-lg font-semibold text-slate-800">Blocked Numbers</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            AI concierge stays silent for these numbers — messages still appear in WhatsApp normally
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Block number
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex-shrink-0 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3">
        <ShieldOff size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 leading-relaxed">
          <strong>How it works:</strong> When a blocked number messages your hotel WhatsApp,
          the AI does not respond at all. The message appears in your WhatsApp Business app normally
          so staff can still reply manually. Use this for housekeeping staff, suppliers,
          and any internal numbers that should not trigger the AI.
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : numbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <ShieldOff size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No blocked numbers</p>
            <p className="text-xs mt-1 text-slate-300">Add staff and supplier numbers to keep the AI silent</p>
          </div>
        ) : (
          <div className="space-y-2">
            {numbers.map(b => (
              <div
                key={b.phone}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <ShieldOff size={14} className="text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {formatPhone(b.phone)}
                    </p>
                    {b.label && (
                      <p className="text-xs text-slate-400">{b.label}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[10px] text-slate-400">{timeAgo(b.created_at)}</span>
                  <button
                    onClick={() => handleRemove(b.phone)}
                    disabled={removing === b.phone}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    title="Unblock"
                  >
                    {removing === b.phone
                      ? <RefreshCw size={14} className="animate-spin" />
                      : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
