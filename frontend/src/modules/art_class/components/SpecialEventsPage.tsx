import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, AlertCircle, MapPin, ExternalLink, CalendarDays, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { api } from '../api';
import type { SpecialEvent } from '../types';
import { Button, Input, Modal, Spinner } from '../ui';

// ── Event Form Modal ──────────────────────────────────────────────────────────
function SpecialEventModal({ event, onClose, onSaved }: {
  event?: SpecialEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title:           event?.title           ?? '',
    description:     event?.description     ?? '',
    date:            event?.date            ?? '',
    startTime:       event?.startTime       ?? '10:00',
    endTime:         event?.endTime         ?? '12:00',
    locationName:    event?.locationName    ?? '',
    locationAddress: event?.locationAddress ?? '',
    locationUrl:     event?.locationUrl     ?? '',
    maxCapacity:     event?.maxCapacity     != null ? String(event.maxCapacity) : '',
    price:           event?.price           != null ? String(event.price)       : '0',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (!form.date)          { setError('Date is required');  return; }
    setSaving(true); setError('');
    const payload = {
      title:           form.title.trim(),
      description:     form.description.trim(),
      date:            form.date,
      startTime:       form.startTime,
      endTime:         form.endTime,
      locationName:    form.locationName.trim(),
      locationAddress: form.locationAddress.trim(),
      locationUrl:     form.locationUrl.trim(),
      maxCapacity:     form.maxCapacity !== '' ? Number(form.maxCapacity) : null,
      price:           Number(form.price) || 0,
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
            placeholder="Describe the event..." />
        </label>

        {/* Date + times */}
        <Input label="Date *" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start time" type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} />
          <Input label="End time"   type="time" value={form.endTime}   onChange={e => set('endTime',   e.target.value)} />
        </div>

        {/* Location section */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-3">
          <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
            <MapPin size={12} className="text-brand-500" /> Location
          </p>
          <Input label="Venue name" value={form.locationName}
            onChange={e => set('locationName', e.target.value)}
            placeholder="e.g. Art Center Tirana, Studio 12" />
          <Input label="Address" value={form.locationAddress}
            onChange={e => set('locationAddress', e.target.value)}
            placeholder="e.g. Rruga Ismail Qemali 10, Tirana" />
          <Input label="Google Maps / location URL" value={form.locationUrl}
            onChange={e => set('locationUrl', e.target.value)}
            placeholder="https://maps.google.com/..." />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Max capacity" type="number" min={1}
            value={form.maxCapacity}
            onChange={e => set('maxCapacity', e.target.value)}
            placeholder="Leave empty = unlimited" />
          <Input label="Price (ALL)" type="number" min={0}
            value={form.price}
            onChange={e => set('price', e.target.value)}
            placeholder="e.g. 1500" />
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
export function SpecialEventsPage() {
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

  const upcoming = events.filter(e => e.date >= new Date().toISOString().slice(0, 10));
  const past     = events.filter(e => e.date <  new Date().toISOString().slice(0, 10));

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Special Events</h1>
          <p className="text-xs text-slate-400">{upcoming.length} upcoming · {past.length} past</p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New event
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
        {loading ? <Spinner /> : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <CalendarDays size={32} className="opacity-30" />
            <p className="text-sm">No special events yet</p>
            <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
              <Plus size={13} /> Add your first event
            </Button>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">Upcoming</p>
                <div className="space-y-2">
                  {upcoming.map(ev => <EventCard key={ev.id} event={ev} onEdit={() => setEditing(ev)} onDelete={() => handleDelete(ev)} deleting={deletingId === ev.id} />)}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">Past events</p>
                <div className="space-y-2 opacity-60">
                  {past.map(ev => <EventCard key={ev.id} event={ev} onEdit={() => setEditing(ev)} onDelete={() => handleDelete(ev)} deleting={deletingId === ev.id} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {showNew && <SpecialEventModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {editing  && <SpecialEventModal event={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// ── Event Card ────────────────────────────────────────────────────────────────
function EventCard({ event, onEdit, onDelete, deleting }: {
  event: SpecialEvent; onEdit: () => void; onDelete: () => void; deleting: boolean;
}) {
  const hasLocation = event.locationName || event.locationAddress;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-4">
      {/* Date block */}
      <div className="flex-shrink-0 w-12 flex flex-col items-center justify-center bg-brand-50 rounded-xl py-2">
        <span className="text-[10px] font-medium text-brand-400 uppercase">
          {format(parseISO(event.date), 'MMM')}
        </span>
        <span className="text-xl font-bold text-brand-700 leading-none">
          {format(parseISO(event.date), 'd')}
        </span>
        <span className="text-[10px] text-brand-400">
          {format(parseISO(event.date), 'yyyy')}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 truncate">{event.title}</p>
        {event.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{event.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Clock size={10} /> {event.startTime}–{event.endTime}
          </span>
          {event.price > 0 && (
            <span className="text-xs font-medium text-brand-600">{event.price.toLocaleString()} ALL</span>
          )}
          {event.maxCapacity && (
            <span className="text-xs text-slate-400">{event.maxCapacity} spots</span>
          )}
        </div>

        {hasLocation && (
          <div className="flex items-start gap-1 mt-2">
            <MapPin size={11} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              {event.locationName && (
                <p className="text-xs font-medium text-slate-600 truncate">{event.locationName}</p>
              )}
              {event.locationAddress && (
                <p className="text-xs text-slate-400 truncate">{event.locationAddress}</p>
              )}
            </div>
            {event.locationUrl && (
              <a href={event.locationUrl} target="_blank" rel="noopener noreferrer"
                className="ml-1 flex-shrink-0 text-brand-500 hover:text-brand-600"
                title="Open in Maps" onClick={e => e.stopPropagation()}>
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 flex-shrink-0">
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
  );
}
