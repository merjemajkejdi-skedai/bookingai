import { useState, useEffect, useCallback } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, eachDayOfInterval, isSameMonth, isToday,
  parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Users, X, AlertCircle, BookTemplate, Repeat2 } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { ArtEvent, EventRegistration, EventTemplate, Specialist } from '../types';
import { Button, Modal, Input, Spinner } from '../ui';

// Art Classes page — isArtClass is always true for this module
const IS_ART_CLASS = true;

interface EventsPageProps {
  specialists: Specialist[];
}

// Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6 Sun=0  (JS getDay() values)
const WEEK_DAY_OPTIONS = [
  { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 }, { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

// ── ClassForm Modal ───────────────────────────────────────────────────────────
function ClassFormModal({
  event, specialists, prefillDate, onClose, onSaved,
}: {
  event?: ArtEvent | null;
  specialists: Specialist[];
  prefillDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    title:       event?.title       ?? '',
    description: event?.description ?? '',
    date:        event?.date        ?? prefillDate ?? today,
    startTime:   event?.startTime   ?? '10:00',
    endTime:     event?.endTime     ?? '11:00',
    teacherId:   event?.teacherId   ?? '',
    ageMin:      event?.ageMin  != null ? String(event.ageMin)  : '',
    ageMax:      event?.ageMax  != null ? String(event.ageMax)  : '',
    maxCapacity: event?.maxCapacity != null ? String(event.maxCapacity) : '',
    price:       event?.price != null ? String(event.price) : '0',
  });

  // Recurrence state (only available when creating, not editing)
  const [recurring, setRecurring]         = useState(false);
  const [recurStart, setRecurStart]       = useState(prefillDate ?? today);
  const [recurEnd, setRecurEnd]           = useState('');
  const [recurDays, setRecurDays]         = useState<number[]>([]);

  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [templates, setTemplates]   = useState<EventTemplate[]>([]);
  const [showTmplPicker, setShowTmplPicker] = useState(false);

  useEffect(() => {
    if (!event) {
      api.getTemplates().then(setTemplates).catch(() => {});
    }
  }, [event]);

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function toggleDay(v: number) {
    setRecurDays(d => d.includes(v) ? d.filter(x => x !== v) : [...d, v]);
  }

  function applyTemplate(tmpl: EventTemplate) {
    setForm(f => ({
      ...f,
      title:       tmpl.title,
      description: tmpl.description,
      maxCapacity: tmpl.maxCapacity != null ? String(tmpl.maxCapacity) : '',
      price:       tmpl.price       != null ? String(tmpl.price)       : '0',
    }));
    setShowTmplPicker(false);
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }

    if (!event && recurring) {
      if (!recurStart)           { setError('Start date is required'); return; }
      if (!recurEnd)             { setError('End date is required'); return; }
      if (recurEnd < recurStart) { setError('End date must be after start date'); return; }
      if (!recurDays.length)     { setError('Select at least one day of the week'); return; }
    } else {
      if (!form.date) { setError('Date is required'); return; }
    }

    setSaving(true); setError('');
    const base = {
      title:       form.title.trim(),
      description: form.description.trim(),
      startTime:   form.startTime,
      endTime:     form.endTime,
      teacherId:   form.teacherId || null,
      ageMin:      form.ageMin      !== '' ? Number(form.ageMin)      : null,
      ageMax:      form.ageMax      !== '' ? Number(form.ageMax)      : null,
      maxCapacity: form.maxCapacity !== '' ? Number(form.maxCapacity) : null,
      price:       form.price !== '' ? Number(form.price) : 0,
    };

    try {
      if (event) {
        await api.updateEvent(event.id, { ...base, date: form.date } as any);
      } else if (recurring) {
        await api.createEvent({ ...base, recurrence: { startDate: recurStart, endDate: recurEnd, days: recurDays } } as any);
      } else {
        await api.createEvent({ ...base, date: form.date } as any);
      }
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={event ? 'Edit Class' : 'New Class'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Template picker — only shown when creating a new class */}
        {!event && templates.length > 0 && (
          <div>
            {showTmplPicker ? (
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-brand-700">Pick a template</span>
                  <button onClick={() => setShowTmplPicker(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={13} />
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {templates.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="flex items-center justify-between w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white hover:shadow-sm transition-all group">
                      <span className="font-medium text-slate-700 group-hover:text-brand-600">{t.title}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {t.price != null && t.price > 0 && <span className="text-xs font-semibold text-brand-600">{t.price.toLocaleString()} ALL</span>}
                        {t.maxCapacity != null && <span className="text-xs text-slate-400">{t.maxCapacity} spots</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTmplPicker(true)}
                className="flex items-center gap-2 text-xs font-medium text-brand-600 hover:text-brand-700 px-3 py-2 rounded-lg border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors w-full justify-center">
                <BookTemplate size={13} />
                Use a predefined template
              </button>
            )}
          </div>
        )}

        <Input label="Title *" value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="e.g. Watercolour for Kids" autoFocus />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
            placeholder="Describe what this class is about..." />
        </label>

        {/* ── Recurring toggle (create only) ── */}
        {!event && (
          <button
            type="button"
            onClick={() => setRecurring(r => !r)}
            className={clsx(
              'flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border transition-colors w-full justify-center',
              recurring
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
            )}>
            <Repeat2 size={13} />
            {recurring ? 'Recurring class ✓' : 'Make recurring'}
          </button>
        )}

        {/* ── Date fields ── */}
        {!event && recurring ? (
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date *" type="date" value={recurStart}
                onChange={e => setRecurStart(e.target.value)} />
              <Input label="End date *"   type="date" value={recurEnd}
                onChange={e => setRecurEnd(e.target.value)} min={recurStart} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-700">Repeat on *</span>
              <div className="flex gap-1.5 flex-wrap">
                {WEEK_DAY_OPTIONS.map(d => (
                  <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                    className={clsx(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      recurDays.includes(d.value)
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-brand-50',
                    )}>
                    {d.label}
                  </button>
                ))}
              </div>
              {recurStart && recurEnd && recurDays.length > 0 && (
                <p className="text-xs text-brand-600 mt-0.5">
                  Creates classes every {recurDays.map(v => WEEK_DAY_OPTIONS.find(d => d.value === v)?.label).join(', ')} from {recurStart} to {recurEnd}
                </p>
              )}
            </div>
          </div>
        ) : (
          <Input label="Date *" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input label="Start time" type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} />
          <Input label="End time"   type="time" value={form.endTime}   onChange={e => set('endTime',   e.target.value)} />
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Teacher</span>
          <select value={form.teacherId} onChange={e => set('teacherId', e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400">
            <option value="">— No teacher —</option>
            {specialists.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Age min" type="number" min={0} max={99} value={form.ageMin}
            onChange={e => set('ageMin', e.target.value)} placeholder="e.g. 3" />
          <Input label="Age max" type="number" min={0} max={99} value={form.ageMax}
            onChange={e => set('ageMax', e.target.value)} placeholder="e.g. 6" />
        </div>

        <Input label="Max capacity (optional)" type="number" min={1} value={form.maxCapacity}
          onChange={e => set('maxCapacity', e.target.value)} placeholder="Leave empty for unlimited" />

        <Input
          label="Price per person (ALL)"
          type="number" min={0} value={form.price}
          onChange={e => set('price', e.target.value)} placeholder="e.g. 3500"
        />

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : event ? 'Save changes' : recurring ? 'Create series' : 'Create class'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── AddRegistrationModal ──────────────────────────────────────────────────────
function AddRegistrationModal({ eventId, onClose, onSaved }: {
  eventId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ participantName: '', parentName: '', parentPhone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.participantName.trim()) { setError('Child name is required'); return; }
    setSaving(true); setError('');
    try {
      await api.createRegistration(eventId, {
        participantName: form.participantName.trim(),
        parentName:  form.parentName.trim()  || undefined,
        parentPhone: form.parentPhone.trim() || undefined,
        notes:       form.notes.trim()       || undefined,
      });
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to add'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="Add Registration" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Child's name *" value={form.participantName} onChange={e => set('participantName', e.target.value)} autoFocus />
        <Input label="Parent's name" value={form.parentName} onChange={e => set('parentName', e.target.value)} />
        <Input label="Parent's phone" type="tel" value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} placeholder="+355691234567" />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Notes</span>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none" />
        </label>
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Adding…' : 'Add registration'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── EventDetailPanel ──────────────────────────────────────────────────────────
function EventDetailPanel({ event, specialists, onClose, onEdit, onDelete, onRegistrationChange }: {
  event: ArtEvent; specialists: Specialist[];
  onClose: () => void; onEdit: () => void;
  onDelete: () => void; onRegistrationChange: () => void;
}) {
  const [regs, setRegs]               = useState<EventRegistration[]>([]);
  const [loadingRegs, setLoadingRegs] = useState(true);
  const [showAddReg, setShowAddReg]   = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const loadRegs = useCallback(async () => {
    setLoadingRegs(true);
    try { setRegs(await api.getRegistrations(event.id)); }
    catch { /* ignore */ }
    finally { setLoadingRegs(false); }
  }, [event.id]);

  useEffect(() => { loadRegs(); }, [loadRegs]);

  async function removeReg(regId: string) {
    if (!confirm('Remove this registration?')) return;
    setDeletingId(regId);
    try {
      await api.deleteRegistration(event.id, regId);
      setRegs(r => r.filter(x => x.id !== regId));
      onRegistrationChange();
    } catch (e: any) { alert(e.message || 'Failed to remove'); }
    finally { setDeletingId(null); }
  }

  const teacher   = specialists.find(s => s.id === event.teacherId);
  const spotsUsed = regs.length;
  const isFull    = event.maxCapacity ? spotsUsed >= event.maxCapacity : false;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 pb-4 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold text-slate-800">{event.title}</h2>
            {event.recurrenceGroupId && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-brand-50 text-brand-600 border border-brand-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                <Repeat2 size={9} /> Recurring
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {format(parseISO(event.date), 'EEEE, d MMMM yyyy')} · {event.startTime}–{event.endTime}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-500 transition-colors"><Pencil size={15} /></button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"><Trash2 size={15} /></button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"><X size={15} /></button>
        </div>
      </div>

      <div className="py-4 space-y-2.5 border-b border-slate-100">
        {event.description && <p className="text-sm text-slate-600 leading-relaxed">{event.description}</p>}
        {teacher && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: teacher.color }} />
            <span className="font-medium">{teacher.name}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-400">{teacher.role}</span>
          </div>
        )}
        {event.ageMin != null && (
          <p className="text-sm text-slate-600">Age group: <span className="font-medium">{event.ageMin}–{event.ageMax} years</span></p>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Capacity:</span>
          <span className={clsx('font-medium', isFull ? 'text-red-500' : 'text-slate-700')}>
            {event.maxCapacity
              ? `${spotsUsed} / ${event.maxCapacity} spots${isFull ? ' · FULL' : ''}`
              : `${spotsUsed} registered · Unlimited`}
          </span>
        </div>
        {event.price != null && event.price > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Price:</span>
            <span className="font-medium text-slate-700">{event.price.toLocaleString()} ALL / person</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Users size={14} className="text-slate-400" /> Registrations ({regs.length})
          </h3>
          <Button size="sm" variant="outline" onClick={() => setShowAddReg(true)}>
            <Plus size={13} /> Add
          </Button>
        </div>

        {loadingRegs ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : regs.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No registrations yet</p>
        ) : (
          <div className="space-y-1.5">
            {regs.map(reg => (
              <div key={reg.id}
                className="flex items-start justify-between gap-2 px-3 py-2.5 rounded-xl bg-slate-50 group hover:bg-slate-100 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{reg.participantName}</p>
                  {reg.parentName && <p className="text-xs text-slate-500">Parent: {reg.parentName}</p>}
                  {reg.parentPhone && <p className="text-xs text-slate-500">{reg.parentPhone}</p>}
                  <p className="text-xs text-slate-400 mt-0.5">{format(new Date(reg.registeredAt), 'd MMM yyyy, HH:mm')}</p>
                </div>
                <button onClick={() => removeReg(reg.id)} disabled={deletingId === reg.id}
                  className="p-1 rounded text-slate-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mt-0.5">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddReg && (
        <AddRegistrationModal
          eventId={event.id}
          onClose={() => setShowAddReg(false)}
          onSaved={() => { setShowAddReg(false); loadRegs(); onRegistrationChange(); }}
        />
      )}
    </div>
  );
}

// ── DeleteSeriesModal ─────────────────────────────────────────────────────────
function DeleteSeriesModal({ event, onClose, onDeleted }: {
  event: ArtEvent; onClose: () => void; onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(mode: 'single' | 'series') {
    setDeleting(true);
    try {
      if (mode === 'series' && event.recurrenceGroupId) {
        await api.deleteEventGroup(event.recurrenceGroupId);
      } else {
        await api.deleteEvent(event.id);
      }
      onDeleted();
    } catch (e: any) { alert(e.message || 'Failed to delete'); setDeleting(false); }
  }

  return (
    <Modal title="Delete recurring class" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          <span className="font-medium">"{event.title}"</span> is part of a recurring series.
          What would you like to delete?
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => handleDelete('single')}
            className="justify-start">
            This class only ({format(parseISO(event.date), 'd MMM yyyy')})
          </Button>
          <Button variant="outline" disabled={deleting} onClick={() => handleDelete('series')}
            className="justify-start text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200">
            <Trash2 size={13} /> Entire series
          </Button>
        </div>
        <div className="flex justify-end pt-1 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main EventsPage ───────────────────────────────────────────────────────────
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function EventsPage({ specialists }: EventsPageProps) {
  const [currentMonth, setCurrentMonth]   = useState(new Date());
  const [events, setEvents]               = useState<ArtEvent[]>([]);
  const [loading, setLoading]             = useState(true);
  const [loadError, setLoadError]         = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ArtEvent | null>(null);
  const [editingEvent, setEditingEvent]   = useState<ArtEvent | null>(null);
  const [showNewEvent, setShowNewEvent]   = useState(false);
  const [newEventDate, setNewEventDate]   = useState<string | undefined>();
  const [filterTeacherId, setFilterTeacherId] = useState<string | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<ArtEvent | null>(null);

  const loadEvents = useCallback(async (): Promise<ArtEvent[]> => {
    setLoading(true); setLoadError(null);
    const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const end   = format(endOfMonth(currentMonth),   'yyyy-MM-dd');
    try {
      const data = await api.getEvents({ start, end });
      setEvents(data); return data;
    } catch (e: any) {
      setLoadError(e.message || 'Failed to load classes'); return [];
    } finally { setLoading(false); }
  }, [currentMonth]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd   = endOfMonth(currentMonth);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,     { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const filteredEvents = filterTeacherId
    ? events.filter(e => e.teacherId === filterTeacherId)
    : events;

  function getEventsForDay(day: Date) {
    return filteredEvents.filter(e => e.date === format(day, 'yyyy-MM-dd'));
  }

  async function handleDeleteEvent(ev: ArtEvent) {
    if (ev.recurrenceGroupId) {
      setDeletingEvent(ev);
      return;
    }
    if (!confirm(`Delete "${ev.title}"? This cannot be undone.`)) return;
    try { await api.deleteEvent(ev.id); setSelectedEvent(null); loadEvents(); }
    catch (e: any) { alert(e.message || 'Failed to delete'); }
  }

  function handleDayClick(day: Date) {
    if (!isSameMonth(day, currentMonth)) return;
    setNewEventDate(format(day, 'yyyy-MM-dd'));
    setShowNewEvent(true);
  }

  const teacherColor = (ev: ArtEvent) =>
    ev.teacherColor || specialists.find(s => s.id === ev.teacherId)?.color || '#6366f1';

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCurrentMonth(d => subMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setCurrentMonth(new Date())}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
            Today
          </button>
          <button onClick={() => setCurrentMonth(d => addMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <ChevronRight size={18} />
          </button>
          <h2 className="text-sm font-semibold text-slate-800 ml-1 whitespace-nowrap">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {specialists.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5">
              <button onClick={() => setFilterTeacherId(null)}
                className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
                  !filterTeacherId ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                All
              </button>
              {specialists.map(sp => (
                <button key={sp.id}
                  onClick={() => setFilterTeacherId(sp.id === filterTeacherId ? null : sp.id)}
                  className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap flex items-center gap-1',
                    filterTeacherId === sp.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sp.color }} />
                  {sp.name.split(' ')[0]}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" onClick={() => { setNewEventDate(undefined); setShowNewEvent(true); }}>
            <Plus size={14} /> New class
          </Button>
        </div>
      </div>

      {/* Mobile teacher filter */}
      {specialists.length > 0 && (
        <div className="md:hidden flex gap-2 overflow-x-auto px-3 py-2 border-b border-slate-100 flex-shrink-0 scrollbar-none">
          <button onClick={() => setFilterTeacherId(null)}
            className={clsx('px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap flex-shrink-0',
              !filterTeacherId ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200')}>
            All
          </button>
          {specialists.map(sp => (
            <button key={sp.id}
              onClick={() => setFilterTeacherId(sp.id === filterTeacherId ? null : sp.id)}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1.5',
                filterTeacherId === sp.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200')}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sp.color }} />
              {sp.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm border-b border-red-100 flex-shrink-0">
          <AlertCircle size={15} className="flex-shrink-0" /> {loadError}
          <button onClick={() => loadEvents()} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className={clsx('flex flex-col min-w-0 overflow-hidden',
          selectedEvent ? 'hidden md:flex md:flex-1' : 'flex flex-1')}>
          <div className="grid grid-cols-7 border-b border-slate-100 flex-shrink-0">
            {WEEK_DAYS.map(d => (
              <div key={d} className="py-2 text-center text-xs font-medium text-slate-400 uppercase tracking-wide">{d}</div>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-64"><Spinner /></div>
            ) : (
              <div className="grid grid-cols-7" style={{ gridAutoRows: 'minmax(90px, auto)' }}>
                {days.map(day => {
                  const dayEvents = getEventsForDay(day);
                  const inMonth = isSameMonth(day, currentMonth);
                  const todayDay = isToday(day);
                  return (
                    <div key={day.toISOString()} onClick={() => handleDayClick(day)}
                      className={clsx('border-b border-r border-slate-100 p-1.5 transition-colors',
                        inMonth ? 'cursor-pointer hover:bg-brand-50/40 bg-white' : 'bg-slate-50/50 cursor-default')}>
                      <span className={clsx('inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-medium mb-1',
                        todayDay ? 'bg-brand-500 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300')}>
                        {format(day, 'd')}
                      </span>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map(ev => (
                          <button key={ev.id}
                            onClick={e => { e.stopPropagation(); setSelectedEvent(ev); }}
                            className="w-full text-left px-1.5 py-0.5 rounded text-xs font-medium truncate transition-opacity hover:opacity-75 flex items-center gap-1"
                            style={{ background: teacherColor(ev) + '20', color: teacherColor(ev), borderLeft: `2.5px solid ${teacherColor(ev)}` }}
                            title={`${ev.title} · ${ev.startTime}${ev.recurrenceGroupId ? ' · Recurring' : ''}`}>
                            {ev.recurrenceGroupId && <Repeat2 size={9} className="flex-shrink-0 opacity-70" />}
                            <span className="truncate">{ev.startTime} {ev.title}</span>
                          </button>
                        ))}
                        {dayEvents.length > 3 && <p className="text-xs text-slate-400 px-1">+{dayEvents.length - 3} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {selectedEvent && (
          <div className={clsx('border-l border-slate-100 overflow-y-auto p-4 flex-shrink-0',
            'w-full md:w-80 lg:w-96', 'md:static fixed inset-0 z-40 bg-white md:z-auto')}>
            <EventDetailPanel
              event={selectedEvent}
              specialists={specialists}
              onClose={() => setSelectedEvent(null)}
              onEdit={() => setEditingEvent(selectedEvent)}
              onDelete={() => handleDeleteEvent(selectedEvent)}
              onRegistrationChange={loadEvents}
            />
          </div>
        )}
      </div>

      {showNewEvent && (
        <ClassFormModal
          specialists={specialists}
          prefillDate={newEventDate}
          onClose={() => setShowNewEvent(false)}
          onSaved={async () => { setShowNewEvent(false); await loadEvents(); }}
        />
      )}

      {editingEvent && (
        <ClassFormModal
          event={editingEvent}
          specialists={specialists}
          onClose={() => setEditingEvent(null)}
          onSaved={async () => {
            const editId = editingEvent.id;
            setEditingEvent(null);
            const data = await loadEvents();
            const updated = data.find(e => e.id === editId);
            if (updated) setSelectedEvent(updated);
          }}
        />
      )}

      {deletingEvent && (
        <DeleteSeriesModal
          event={deletingEvent}
          onClose={() => setDeletingEvent(null)}
          onDeleted={() => { setDeletingEvent(null); setSelectedEvent(null); loadEvents(); }}
        />
      )}
    </div>
  );
}
