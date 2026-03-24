import { useState, useMemo, useRef, useEffect } from 'react';
import { format, addDays, startOfWeek, isSameDay, parseISO, differenceInMinutes, setHours, setMinutes } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { Booking, Specialist, View } from '../types';
import { Button } from '../ui';

const HOUR_H = 64;
const DAY_START = 8;
const DAY_END = 20;
const TOTAL_HOURS = DAY_END - DAY_START;

interface Props {
  bookings: Booking[];
  specialists: Specialist[];
  selectedSpecialistId: string | null;
  onBookingClick: (b: Booking) => void;
  onSlotClick: (date: Date, specialistId?: string) => void;
  loading: boolean;
}

export function CalendarView({ bookings, specialists, selectedSpecialistId, onBookingClick, onSlotClick, loading }: Props) {
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week'
  );
  const [currentDate, setCurrentDate] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days = view === 'week'
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    : [currentDate];

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => DAY_START + i);

  const visibleSpecialists = useMemo(() =>
    selectedSpecialistId
      ? specialists.filter(s => s.id === selectedSpecialistId)
      : specialists,
    [specialists, selectedSpecialistId]
  );

  const bookingMap = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const key = `${b.startsAt.slice(0, 10)}_${b.specialistId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return map;
  }, [bookings]);

  function positionBooking(b: Booking) {
    const start = parseISO(b.startsAt);
    const end = parseISO(b.endsAt);
    const topMins = (start.getHours() - DAY_START) * 60 + start.getMinutes();
    const durationMins = differenceInMinutes(end, start);
    return {
      top: (topMins / 60) * HOUR_H,
      height: Math.max((durationMins / 60) * HOUR_H - 2, 22),
    };
  }

  const navigate = (dir: 1 | -1) => {
    setCurrentDate(d => addDays(d, dir * (view === 'week' ? 7 : 1)));
  };

  function handleColumnClick(e: React.MouseEvent, day: Date, specialistId?: string) {
    const col = e.currentTarget as HTMLElement;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMins = (y / HOUR_H) * 60;
    const h = DAY_START + Math.floor(totalMins / 60);
    const m = Math.floor((totalMins % 60) / 15) * 15;
    onSlotClick(setMinutes(setHours(day, h), m), specialistId);
  }

  const isToday = (d: Date) => isSameDay(d, new Date());

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Toolbar — mobile: two rows, desktop: single row */}
      <div className="flex flex-col border-b border-slate-100 flex-shrink-0">
        {/* Row 1 (always visible): nav arrows + date + new booking */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors flex-shrink-0">
            <ChevronLeft size={18} className="text-slate-600" />
          </button>
          <span className="flex-1 text-center text-sm font-semibold text-slate-800 truncate">
            {view === 'week'
              ? `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d, yyyy')}`
              : format(currentDate, 'EEE, MMM d, yyyy')}
          </span>
          <button
            onClick={() => navigate(1)}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors flex-shrink-0">
            <ChevronRight size={18} className="text-slate-600" />
          </button>
          <Button size="sm" onClick={() => onSlotClick(currentDate)} className="flex-shrink-0">
            <Plus size={14} />
            <span className="hidden sm:inline">New booking</span>
          </Button>
        </div>
        {/* Row 2: Today + view toggle */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
          <div className="ml-auto flex border border-slate-200 rounded-lg overflow-hidden text-sm">
            {(['week', 'day'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={clsx('px-3 py-1.5 capitalize transition-colors',
                  view === v ? 'bg-brand-500 text-white' : 'hover:bg-slate-50 text-slate-600'
                )}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Day headers */}
      <div className="flex border-b border-slate-100 flex-shrink-0">
        <div className="w-14 flex-shrink-0" />
        {days.map(day => (
          <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-slate-100 px-2 py-2 text-center">
            <div className="inline-flex flex-col items-center gap-0.5">
              <span className="text-xs text-slate-400 uppercase tracking-wide">{format(day, 'EEE')}</span>
              <span className={clsx('text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full',
                isToday(day) ? 'bg-brand-500 text-white' : 'text-slate-700')}>
                {format(day, 'd')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Specialist labels */}
      {view === 'week' && visibleSpecialists.length > 1 && (
        <div className="flex border-b border-slate-100 bg-slate-50/60 flex-shrink-0">
          <div className="w-14 flex-shrink-0" />
          {days.map(day => (
            <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-slate-100 flex">
              {visibleSpecialists.map(sp => (
                <div key={sp.id} className="flex-1 min-w-0 px-1 py-1 flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sp.color }} />
                  <span className="text-[10px] text-slate-500 truncate font-medium">{sp.name.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex">
          <div className="w-14 flex-shrink-0 relative">
            {hours.map(h => (
              <div key={h} style={{ height: HOUR_H }} className="relative">
                <span className="absolute -top-2.5 right-2 text-[10px] text-slate-400 font-mono">
                  {h === 12 ? '12pm' : h > 12 ? `${h-12}pm` : `${h}am`}
                </span>
              </div>
            ))}
          </div>

          {days.map(day => (
            <div key={day.toISOString()} className="flex-1 min-w-0 border-l border-slate-100 flex">
              {visibleSpecialists.map((sp, spIdx) => {
                const key = `${format(day, 'yyyy-MM-dd')}_${sp.id}`;
                const dayBookings = bookingMap.get(key) || [];
                return (
                  <div key={sp.id}
                    className={clsx('flex-1 min-w-0 relative cursor-pointer', spIdx > 0 && 'border-l border-slate-100/60')}
                    style={{ height: TOTAL_HOURS * HOUR_H }}
                    onClick={e => handleColumnClick(e, day, sp.id)}>
                    {hours.map(h => (
                      <div key={h} style={{ top: (h - DAY_START) * HOUR_H }}
                        className="absolute inset-x-0 border-t border-slate-100 pointer-events-none" />
                    ))}
                    {hours.map(h => (
                      <div key={`${h}h`} style={{ top: (h - DAY_START) * HOUR_H + HOUR_H / 2 }}
                        className="absolute inset-x-0 border-t border-dashed border-slate-100/70 pointer-events-none" />
                    ))}
                    {dayBookings.map(b => {
                      if (b.status === 'cancelled') return null;
                      const { top, height } = positionBooking(b);
                      return (
                        <div key={b.id}
                          style={{ top, height, background: sp.color + '22', borderColor: sp.color }}
                          className="absolute inset-x-0.5 rounded-md border-l-[3px] px-1.5 py-1 overflow-hidden cursor-pointer hover:brightness-95 transition-all z-10"
                          onClick={e => { e.stopPropagation(); onBookingClick(b); }}>
                          <p className="text-[11px] font-semibold leading-tight truncate" style={{ color: sp.color }}>
                            {b.customerName}
                          </p>
                          {height > 30 && (
                            <p className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">{b.serviceName}</p>
                          )}
                          {height > 44 && (
                            <p className="text-[10px] text-slate-400 font-mono">{format(parseISO(b.startsAt), 'HH:mm')}</p>
                          )}
                        </div>
                      );
                    })}
                    {isToday(day) && (() => {
                      const now = new Date();
                      const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes();
                      if (mins < 0 || mins > TOTAL_HOURS * 60) return null;
                      return (
                        <div style={{ top: (mins / 60) * HOUR_H }}
                          className="absolute inset-x-0 z-20 pointer-events-none">
                          <div className="flex items-center">
                            <div className="w-2 h-2 rounded-full bg-red-400 -ml-1 flex-shrink-0" />
                            <div className="flex-1 h-px bg-red-400" />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-2xl z-30">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
