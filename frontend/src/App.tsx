import { useState, useEffect, useCallback } from 'react';
import { Calendar, Users, Scissors, Shield, LogOut } from 'lucide-react';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { isAuthenticated, getStoredUser, clearAuth, isAdmin } from './lib/auth';
import { format, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import clsx from 'clsx';
import { api } from './lib/api';
import type { Booking, Specialist, Service } from './types';
import { CalendarView } from './components/calendar/CalendarView';
import { BookingModal } from './components/bookings/BookingModal';
import { SpecialistsPage } from './components/specialists/SpecialistsPage';
import { ServicesPage } from './components/services/ServicesPage';
import { EventsPage } from './components/events/EventsPage';

type Page = 'calendar' | 'specialists' | 'services' | 'admin' | 'events';

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const currentUser = getStoredUser();
  const tenantType = currentUser?.tenant?.type ?? '';
  const isArtShop  = /art_class|art_event/i.test(tenantType);
  const isArtClass = /art_class/i.test(tenantType);
  const [page, setPage] = useState<Page>(isArtShop ? 'events' : 'calendar');
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string | null>(null);

  const [bookingModal, setBookingModal] = useState<{
    open: boolean;
    booking?: Booking;
    prefillDate?: Date;
    prefillSpecialistId?: string;
  }>({ open: false });

  useEffect(() => {
    Promise.all([api.getSpecialists(), api.getServices()])
      .then(([specs, svcs]) => { setSpecialists(specs); setServices(svcs); })
      .finally(() => setLoading(false));
  }, []);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    const now = new Date();
    const start = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd'T'00:00:00");
    const end   = format(endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }), "yyyy-MM-dd'T'23:59:59");
    try {
      const data = await api.getBookings({ start, end });
      setBookings(data);
    } finally { setBookingsLoading(false); }
  }, []);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  function handleSlotClick(date: Date, specialistId?: string) {
    setBookingModal({ open: true, prefillDate: date, prefillSpecialistId: specialistId });
  }

  function handleBookingClick(booking: Booking) {
    setBookingModal({ open: true, booking });
  }

  const todayBookings = bookings.filter(b =>
    b.startsAt.slice(0, 10) === format(new Date(), 'yyyy-MM-dd') && b.status === 'confirmed'
  );

  const specialistLabel = isArtShop
    ? 'Teachers'
    : tenantType.toLowerCase().includes('barber') ? 'Barbers' : 'Specialists';

  const nav: { id: Page; label: string; icon: React.ReactNode }[] = isArtShop
    ? [
        { id: 'events',      label: 'Events',   icon: <Calendar size={16} /> },
        { id: 'specialists', label: 'Teachers', icon: <Users size={16} /> },
        ...(isAdmin() ? [{ id: 'admin' as Page, label: 'Admin', icon: <Shield size={16} /> }] : []),
      ]
    : [
        { id: 'calendar',    label: 'Calendar',     icon: <Calendar size={16} /> },
        { id: 'specialists', label: specialistLabel, icon: <Users size={16} /> },
        { id: 'services',    label: 'Services',      icon: <Scissors size={16} /> },
        ...(isAdmin() ? [{ id: 'admin' as Page, label: 'Admin', icon: <Shield size={16} /> }] : []),
      ];

  function handleLogout() {
    clearAuth();
    setAuthed(false);
  }

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-100 overflow-hidden">

      {/* ── Mobile top bar ─────────────────────────────────────────────────── */}
      <header className="md:hidden flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0">
        <img src="/logo.png" alt="SkedAI" className="h-10 w-auto" />
        <div className="flex items-center gap-2">
          {currentUser?.tenant?.name && (
            <span className="text-xs text-slate-500 truncate max-w-[130px]">{currentUser.tenant.name}</span>
          )}
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col bg-white border-r border-slate-200">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="SkedAI" className="h-36 w-auto" />
          </div>
          <p className="text-xs text-slate-400 mt-1 truncate">
            {currentUser?.tenant?.name || currentUser?.email || 'SkedAI'}
          </p>
        </div>

        {/* Today stats */}
        <div className="mx-3 my-3 bg-brand-50 rounded-xl px-3 py-3">
          <p className="text-xs text-brand-600 font-medium">Today</p>
          <p className="text-2xl font-semibold text-brand-700 mt-0.5">{todayBookings.length}</p>
          <p className="text-xs text-brand-500">appointments</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-1 space-y-0.5">
          {nav.map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                page === item.id
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              )}>
              <span className={page === item.id ? 'text-brand-500' : 'text-slate-400'}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Specialist filter (calendar only, non-art shops) */}
        {page === 'calendar' && !isArtShop && (
          <div className="px-3 pb-4 border-t border-slate-100 pt-3">
            <p className="text-xs font-medium text-slate-400 mb-2 px-1">Filter by specialist</p>
            <button
              onClick={() => setSelectedSpecialistId(null)}
              className={clsx('w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors mb-1',
                !selectedSpecialistId ? 'bg-slate-100 text-slate-700 font-medium' : 'text-slate-500 hover:bg-slate-50'
              )}>
              All specialists
            </button>
            {specialists.map(sp => (
              <button key={sp.id}
                onClick={() => setSelectedSpecialistId(sp.id === selectedSpecialistId ? null : sp.id)}
                className={clsx('w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2',
                  selectedSpecialistId === sp.id ? 'bg-slate-100 font-medium text-slate-700' : 'text-slate-500 hover:bg-slate-50'
                )}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sp.color }} />
                <span className="truncate">{sp.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        )}

        {/* Logout */}
        <div className="px-3 pb-3 border-t border-slate-100 pt-3 mt-auto">
          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors">
            <LogOut size={14} className="text-slate-400" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col gap-2 md:gap-4 p-2 md:p-4">

        {/* Mobile specialist filter — shown on calendar page for non-art shops */}
        {page === 'calendar' && !isArtShop && specialists.length > 1 && (
          <div className="md:hidden flex gap-2 overflow-x-auto pb-1 flex-shrink-0 scrollbar-none">
            <button
              onClick={() => setSelectedSpecialistId(null)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs whitespace-nowrap border font-medium transition-colors flex-shrink-0',
                !selectedSpecialistId
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-slate-600 border-slate-200'
              )}>
              All
            </button>
            {specialists.map(sp => (
              <button key={sp.id}
                onClick={() => setSelectedSpecialistId(sp.id === selectedSpecialistId ? null : sp.id)}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-xs whitespace-nowrap border flex items-center gap-1.5 font-medium transition-colors flex-shrink-0',
                  selectedSpecialistId === sp.id
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-slate-600 border-slate-200'
                )}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sp.color }} />
                {sp.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        {page === 'calendar' && (
          <CalendarView
            bookings={bookings}
            specialists={specialists}
            selectedSpecialistId={selectedSpecialistId}
            onBookingClick={handleBookingClick}
            onSlotClick={handleSlotClick}
            loading={bookingsLoading}
          />
        )}
        {page === 'specialists' && (
          <SpecialistsPage
            specialists={specialists}
            loading={loading}
            onRefresh={() => api.getSpecialists().then(setSpecialists)}
            label={specialistLabel}
          />
        )}
        {page === 'services' && (
          <ServicesPage
            services={services}
            loading={loading}
            onRefresh={() => api.getServices().then(setServices)}
            isSalon={/salon|saloon/i.test(tenantType)}
          />
        )}
        {page === 'events' && (
          <EventsPage
            specialists={specialists}
            isArtClass={isArtClass}
          />
        )}
        {page === 'admin' && <AdminPage />}
      </main>

      {/* ── Mobile bottom navigation ───────────────────────────────────────── */}
      <nav className="md:hidden flex items-center bg-white border-t border-slate-200 flex-shrink-0">
        {nav.map(item => (
          <button key={item.id} onClick={() => setPage(item.id)}
            className={clsx(
              'flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors',
              page === item.id ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'
            )}>
            <span className={clsx('transition-colors', page === item.id ? 'text-brand-500' : 'text-slate-400')}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
        <button
          onClick={handleLogout}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
          <LogOut size={16} className="text-slate-400" />
          Sign out
        </button>
      </nav>

      {/* Booking modal */}
      {bookingModal.open && (
        <BookingModal
          booking={bookingModal.booking}
          prefillDate={bookingModal.prefillDate}
          prefillSpecialistId={bookingModal.prefillSpecialistId}
          specialists={specialists}
          services={services}
          onClose={() => setBookingModal({ open: false })}
          onSaved={() => { setBookingModal({ open: false }); loadBookings(); }}
        />
      )}
    </div>
  );
}
