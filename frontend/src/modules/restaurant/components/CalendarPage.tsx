import { useState, useCallback, useEffect } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, eachDayOfInterval, isSameMonth, isToday,
  parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, X, Pencil, Trash2, Users, Clock, MapPin, Phone, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { Zone, Reservation } from '../types';
import { Button, Modal, Input, Spinner } from '../ui';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DURATION_OPTIONS = [30, 60, 90, 120, 180];
const TIME_SLOTS = Array.from({ length: 28 }, (_, i) => {
  const h = Math.floor(i / 2) + 10;
  const m = (i % 2) * 30;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
});

function ReservationFormModal({
  zones, prefillDate, reservation, onClose, onSaved,
}: {
  zones: Zone[];
  prefillDate?: string;
  reservation?: Reservation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    guestName:    reservation?.guestName    ?? '',
    guestPhone:   reservation?.guestPhone   ?? '',
    guestCount:   reservation?.guestCount   != null ? String(reservation.guestCount) : '2',
    zoneId:       reservation?.zoneId       ?? (zones[0]?.id ?? ''),
    date:         reservation?.date         ?? prefillDate ?? format(new Date(), 'yyyy-MM-dd'),
    time:         reservation?.time         ?? '19:00',
    durationMins: reservation?.durationMins != null ? String(reservation.durationMins) : '90',
    notes:        reservation?.notes        ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.guestName.trim()) { setError('Guest name is required'); return; }
    if (!form.zoneId)           { setError('Please select a zone'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        guestName: form.guestName.trim(), guestPhone: form.guestPhone,
        guestCount: Number(form.guestCount) || 2,
        zoneId: form.zoneId, date: form.date, time: form.time,
        durationMins: Number(form.durationMins) || 90,
        notes: form.notes,
      };
      if (reservation) await api.updateReservation(reservation.id, payload);
      else await api.createReservation(payload);
      onSaved();
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={reservation ? 'Edit Reservation' : 'New Reservation'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Guest name *" value={form.guestName} onChange={e => set('guestName', e.target.value)} placeholder="Full name" autoFocus />
          <Input label="Phone" type="tel" value={form.guestPhone} onChange={e => set('guestPhone', e.target.value)} placeholder="+355..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Guests" type="number" min={1} max={50} value={form.guestCount} onChange={e => set('guestCount', e.target.value)} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Zone</span>
            <select value={form.zoneId} onChange={e => set('zoneId', e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40">
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Date *" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Time</span>
            <select value={form.time} onChange={e => set('time', e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40">
              {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Duration</span>
            <select value={form.durationMins} onChange={e => set('durationMins', e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40">
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d < 60 ? `${d}m` : `${d/60}h`}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Notes</span>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 resize-none"
            placeholder="Allergy, birthday, special requests..." />
        </label>
        {error && <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"><AlertCircle size={14} /> {error}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : reservation ? 'Save changes' : 'Create reservation'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DayPanel({
  date, zones, onClose, onAdd,
}: {
  date: string; zones: Zone[]; onClose: () => void; onAdd: () => void;
}) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReservations(await api.getReservations({ date })); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function handleCancel(r: Reservation) {
    if (!confirm(`Cancel reservation for "${r.guestName}"?`)) return;
    setDeletingId(r.id);
    try { await api.cancelReservation(r.id); load(); }
    catch (e: any) { alert(e.message); }
    finally { setDeletingId(null); }
  }

  const grouped = zones.reduce<Record<string, Reservation[]>>((acc, z) => {
    acc[z.id] = reservations.filter(r => r.zoneId === z.id);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-slate-800">{format(parseISO(date), 'EEEE, d MMMM yyyy')}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{reservations.length} reservation{reservations.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={onAdd}><Plus size={14} /> Add</Button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 ml-1"><X size={15} /></button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : reservations.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center py-8">
          <p className="text-sm text-slate-400">No reservations for this day</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={onAdd}><Plus size={13} /> Add reservation</Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4">
          {zones.map(zone => {
            const zoneRes = grouped[zone.id] ?? [];
            if (zoneRes.length === 0) return null;
            return (
              <div key={zone.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: zone.color }} />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{zone.name}</span>
                  <span className="text-xs text-slate-400">({zoneRes.length})</span>
                </div>
                <div className="space-y-2">
                  {zoneRes.map(r => (
                    <div key={r.id}
                      className="rounded-xl border border-slate-200 px-3 py-2.5 bg-white hover:border-slate-300 transition-colors group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{r.guestName}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                              <Clock size={11} /> {r.time} · {r.durationMins < 60 ? `${r.durationMins}m` : `${r.durationMins/60}h`}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                              <Users size={11} /> {r.guestCount} guests
                            </span>
                            {r.guestPhone && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <Phone size={11} /> {r.guestPhone}
                              </span>
                            )}
                            {r.tableName && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <MapPin size={11} /> {r.tableName}
                              </span>
                            )}
                          </div>
                          {r.notes && <p className="text-xs text-slate-400 mt-1 italic truncate">{r.notes}</p>}
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => setEditing(r)} className="p-1.5 rounded text-slate-300 hover:text-brand-500 hover:bg-slate-50 transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => handleCancel(r)} disabled={deletingId === r.id} className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ReservationFormModal zones={zones} reservation={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

interface Props { zones: Zone[]; }

export function CalendarPage({ zones }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFormDate, setNewFormDate] = useState<string | undefined>();
  const [filterZoneId, setFilterZoneId] = useState<string | null>(null);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    const from = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const to   = format(endOfMonth(currentMonth),   'yyyy-MM-dd');
    try { setReservations(await api.getReservations({ from, to })); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [currentMonth]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd   = endOfMonth(currentMonth);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,     { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function getResForDay(day: Date) {
    const d = format(day, 'yyyy-MM-dd');
    return reservations.filter(r =>
      r.date === d && (!filterZoneId || r.zoneId === filterZoneId)
    );
  }

  function handleDayClick(day: Date) {
    if (!isSameMonth(day, currentMonth)) return;
    setSelectedDate(format(day, 'yyyy-MM-dd'));
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCurrentMonth(d => subMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronLeft size={18} /></button>
          <button onClick={() => setCurrentMonth(new Date())}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Today</button>
          <button onClick={() => setCurrentMonth(d => addMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronRight size={18} /></button>
          <h2 className="text-sm font-semibold text-slate-800 ml-1 whitespace-nowrap">{format(currentMonth, 'MMMM yyyy')}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {zones.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5">
              <button onClick={() => setFilterZoneId(null)}
                className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  !filterZoneId ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>All</button>
              {zones.map(z => (
                <button key={z.id} onClick={() => setFilterZoneId(z.id === filterZoneId ? null : z.id)}
                  className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1',
                    filterZoneId === z.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  <span className="w-2 h-2 rounded-full" style={{ background: z.color }} />
                  {z.name}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" onClick={() => { setNewFormDate(undefined); setShowNewForm(true); }}>
            <Plus size={14} /> New reservation
          </Button>
        </div>
      </div>

      {/* Mobile zone filter */}
      {zones.length > 0 && (
        <div className="md:hidden flex gap-2 overflow-x-auto px-3 py-2 border-b border-slate-100 flex-shrink-0 scrollbar-none">
          <button onClick={() => setFilterZoneId(null)}
            className={clsx('px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap flex-shrink-0',
              !filterZoneId ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200')}>All</button>
          {zones.map(z => (
            <button key={z.id} onClick={() => setFilterZoneId(z.id === filterZoneId ? null : z.id)}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap flex-shrink-0 flex items-center gap-1',
                filterZoneId === z.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200')}>
              <span className="w-2 h-2 rounded-full" style={{ background: z.color }} />
              {z.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Calendar grid */}
        <div className={clsx('flex flex-col min-w-0 overflow-hidden', selectedDate ? 'hidden md:flex md:flex-1' : 'flex flex-1')}>
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
                  const dayRes = getResForDay(day);
                  const inMonth = isSameMonth(day, currentMonth);
                  const todayDay = isToday(day);
                  const dateStr = format(day, 'yyyy-MM-dd');
                  return (
                    <div key={day.toISOString()} onClick={() => handleDayClick(day)}
                      className={clsx('border-b border-r border-slate-100 p-1.5 transition-colors',
                        inMonth ? 'cursor-pointer hover:bg-brand-50/30 bg-white' : 'bg-slate-50/50 cursor-default',
                        selectedDate === dateStr && 'bg-brand-50/60')}>
                      <span className={clsx('inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-medium mb-1',
                        todayDay ? 'bg-brand-500 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300')}>
                        {format(day, 'd')}
                      </span>
                      <div className="space-y-0.5">
                        {dayRes.slice(0, 3).map(r => (
                          <div key={r.id}
                            className="w-full text-left px-1.5 py-0.5 rounded text-xs font-medium truncate"
                            style={{ background: r.zoneColor + '22', color: r.zoneColor, borderLeft: `2.5px solid ${r.zoneColor}` }}
                            title={`${r.guestName} · ${r.guestCount} guests · ${r.time}`}>
                            {r.time} {r.guestName}
                          </div>
                        ))}
                        {dayRes.length > 3 && <p className="text-xs text-slate-400 px-1">+{dayRes.length - 3} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Day panel */}
        {selectedDate && (
          <div className={clsx('border-l border-slate-100 overflow-y-auto p-4 flex-shrink-0',
            'w-full md:w-80 lg:w-96', 'md:static fixed inset-0 z-40 bg-white md:z-auto')}>
            <DayPanel
              date={selectedDate}
              zones={zones}
              onClose={() => setSelectedDate(null)}
              onAdd={() => { setNewFormDate(selectedDate); setShowNewForm(true); }} />
          </div>
        )}
      </div>

      {showNewForm && (
        <ReservationFormModal
          zones={zones}
          prefillDate={newFormDate}
          onClose={() => setShowNewForm(false)}
          onSaved={() => { setShowNewForm(false); loadMonth(); }} />
      )}
    </div>
  );
}
