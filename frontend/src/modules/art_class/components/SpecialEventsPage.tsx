import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, AlertCircle, Star, Clock, Users, User } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { SpecialEvent, Specialist } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

// ── Duration helpers ──────────────────────────────────────────────────────────
const DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 45,  label: '45 min' },
  { value: 60,  label: '1 h' },
  { value: 90,  label: '1 h 30 min' },
  { value: 120, label: '2 h' },
  { value: 150, label: '2 h 30 min' },
  { value: 180, label: '3 h' },
  { value: 240, label: '4 h' },
];

function formatDuration(mins: number): string {
  const opt = DURATION_OPTIONS.find(o => o.value === mins);
  if (opt) return opt.label;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ── Event Form Modal ──────────────────────────────────────────────────────────
function SpecialEventModal({ event, specialists, onClose, onSaved }: {
  event?: SpecialEvent | null;
  specialists: Specialist[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title:           event?.title           ?? '',
    description:     event?.description     ?? '',
    durationMinutes: event?.durationMinutes ?? 60,
    price:           event?.price           != null ? String(event.price) : '0',
    minCapacity:     event?.minCapacity     != null ? String(event.minCapacity) : '',
    maxCapacity:     event?.maxCapacity     != null ? String(event.maxCapacity) : '',
    teacherId:       event?.teacherId       ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k: keyof typeof form, v: string | number) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    const payload = {
      title:           form.title.trim(),
      description:     form.description.trim(),
      durationMinutes: Number(form.durationMinutes),
      price:           Number(form.price) || 0,
      minCapacity:     form.minCapacity !== '' ? Number(form.minCapacity) : null,
      maxCapacity:     form.maxCapacity !== '' ? Number(form.maxCapacity) : null,
      teacherId:       form.teacherId || null,
    };
    try {
      if (event) await api.updateSpecialEvent(event.id, payload);
      else       await api.createSpecialEvent(payload as any);
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={event ? 'Edit Special Event' : 'New Special Event'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Event title *" value={form.title}
          onChange={e => set('title', e.target.value)}
          placeholder="e.g. Summer Art Workshop, Family Paint Night" autoFocus />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
            placeholder="Describe the event, what's included, age range, materials…" />
        </label>

        {/* Duration */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Duration</span>
          <select value={form.durationMinutes}
            onChange={e => set('durationMinutes', Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400">
            {DURATION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {/* Responsible teacher */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Responsible teacher</span>
          <select value={form.teacherId}
            onChange={e => set('teacherId', e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400">
            <option value="">— No teacher assigned —</option>
            {specialists.filter(s => s.isActive).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>

        {/* Price + capacity */}
        <div className="grid grid-cols-3 gap-3">
          <Input label="Price / child (ALL)" type="number" min={0}
            value={form.price}
            onChange={e => set('price', e.target.value)}
            placeholder="e.g. 1500" />
          <Input label="Min capacity" type="number" min={1}
            value={form.minCapacity}
            onChange={e => set('minCapacity', e.target.value)}
            placeholder="Optional" />
          <Input label="Max capacity" type="number" min={1}
            value={form.maxCapacity}
            onChange={e => set('maxCapacity', e.target.value)}
            placeholder="Optional" />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : event ? 'Save changes' : 'Create event'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function SpecialEventsPage({ specialists }: { specialists: Specialist[] }) {
  const [events, setEvents]   = useState<SpecialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SpecialEvent | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.getSpecialEvents().then(setEvents).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(ev: SpecialEvent) {
    if (!confirm(`Delete "${ev.title}"? This cannot be undone.`)) return;
    setDeletingId(ev.id);
    try {
      await api.deleteSpecialEvent(ev.id);
      setEvents(e => e.filter(x => x.id !== ev.id));
    } catch (e: any) { alert(e.message || 'Failed to delete'); }
    finally { setDeletingId(null); }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Special Events</h1>
          <p className="text-xs text-slate-400">
            {events.length} event{events.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New event
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <Star size={32} className="opacity-30" />
            <p className="text-sm">No special events configured yet</p>
            <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
              <Plus size={13} /> Add your first event
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {events.map(ev => (
              <EventCard
                key={ev.id}
                event={ev}
                onEdit={() => setEditing(ev)}
                onDelete={() => handleDelete(ev)}
                deleting={deletingId === ev.id}
              />
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <SpecialEventModal
          specialists={specialists}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
      {editing && (
        <SpecialEventModal
          event={editing}
          specialists={specialists}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Event Card ────────────────────────────────────────────────────────────────
function EventCard({ event, onEdit, onDelete, deleting }: {
  event: SpecialEvent; onEdit: () => void; onDelete: () => void; deleting: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4 shadow-sm">
      {/* Title row + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 truncate">{event.title}</p>
          {event.description && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{event.description}</p>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={onEdit}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-500 transition-colors">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} disabled={deleting}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {/* Duration */}
        <span className="flex items-center gap-1 text-xs text-slate-600">
          <Clock size={11} className="text-brand-400" />
          {formatDuration(event.durationMinutes)}
        </span>

        {/* Price */}
        {event.price > 0 && (
          <span className="text-xs font-semibold text-brand-600">
            {event.price.toLocaleString()} ALL / child
          </span>
        )}

        {/* Capacity */}
        {(event.minCapacity || event.maxCapacity) && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Users size={11} />
            {event.minCapacity && event.maxCapacity
              ? `${event.minCapacity}–${event.maxCapacity} children`
              : event.maxCapacity
                ? `Up to ${event.maxCapacity} children`
                : `Min ${event.minCapacity} children`}
          </span>
        )}
      </div>

      {/* Teacher */}
      {event.teacherName ? (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <span
            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
            style={{ backgroundColor: event.teacherColor || '#6366f1' }}>
            {event.teacherName.charAt(0).toUpperCase()}
          </span>
          <span className="text-xs text-slate-600 truncate">{event.teacherName}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <User size={13} className="text-slate-300 flex-shrink-0" />
          <span className="text-xs text-slate-400 italic">No teacher assigned</span>
        </div>
      )}
    </div>
  );
}
