import { useState, useEffect, useCallback } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, eachDayOfInterval, isSameMonth, isSameDay, isToday,
  parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Users, X, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { ArtEvent, EventRegistration, Specialist } from '../types';
import { Button, Modal, Input, Spinner } from '../ui';

// Art Classes page — isArtClass is always true for this module
const IS_ART_CLASS = true;

interface EventsPageProps {
  specialists: Specialist[];
}

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
  const [form, setForm] = useState({
    title:       event?.title       ?? '',
    description: event?.description ?? '',
    date:        event?.date        ?? prefillDate ?? '',
    startTime:   event?.startTime   ?? '10:00',
    endTime:     event?.endTime     ?? '11:00',
    teacherId:   event?.teacherId   ?? '',
    ageMin:      event?.ageMin  != null ? String(event.ageMin)  : '',
    ageMax:      event?.ageMax  != null ? String(event.ageMax)  : '',
    maxCapacity: event?.maxCapacity != null ? String(event.maxCapacity) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (!form.date)          { setError('Date is required');  return; }
    setSaving(true); setError('');
    const payload = {
      title:       form.title.trim(),
      description: form.description.trim(),
      date:        form.date,
      startTime:   form.startTime,
      endTime:     form.endTime,
      teacherId:   form.teacherId || null,
      ageMin:      form.ageMin      !== '' ? Number(form.ageMin)      : null,
      ageMax:      form.ageMax      !== '' ? Number(form.ageMax)      : null,
      maxCapacity: form.maxCapacity !== '' ? Number(form.maxCapacity) : null,
    };
    try {
      if (event) { await api.updateEvent(event.id, payload as any); }
      else { await api.createEvent(payload as any); }
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={event ? 'Edit Class' : 'New Class'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Title *" value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="e.g. Watercolour for Kids" autoFocus />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400 resize-none"
            placeholder="Describe what this class is about..." />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Date *" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Teacher</span>
            <select value={form.teacherId} onChange={e => set('teacherId', e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400">
              <option value="">— No teacher —</option>
              {specialists.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Start time" type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} />
          <Input label="End time"   type="time" value={form.endTime}   onChange={e => set('endTime',   e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Age min" type="number" min={0} max={99} value={form.ageMin}
            onChange={e => set('ageMin', e.target.value)} placeholder="e.g. 3" />
          <Input label="Age max" type="number" min={0} max={99} value={form.ageMax}
            onChange={e => set('ageMax', e.target.value)} placeholder="e.g. 6" />
        </div>

        <Input label="Max capacity (optional)" type="number" min={1} value={form.maxCapacity}
          onChange={e => set('maxCapacity', e.target.value)} placeholder="Leave empty for unlimited" />

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : event ? 'Save changes' : 'Create class'}
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
          <h2 className="text-base font-semibold text-slate-800">{event.title}</h2>
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
      {specialists.length > 1 && (
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
                            className="w-full text-left px-1.5 py-0.5 rounded text-xs font-medium truncate transition-opacity hover:opacity-75"
                            style={{ background: teacherColor(ev) + '20', color: teacherColor(ev), borderLeft: `2.5px solid ${teacherColor(ev)}` }}
                            title={`${ev.title} · ${ev.startTime}`}>
                            {ev.startTime} {ev.title}
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
    </div>
  );
}
