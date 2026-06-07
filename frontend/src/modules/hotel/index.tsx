import { useState, useEffect } from 'react';
import { BellRing, Users, BookOpen, Settings, Shield, LogOut, Building2, MessageSquare, ShieldOff, Star, UtensilsCrossed } from 'lucide-react';
import clsx from 'clsx';
import { isAdmin, getStoredUser, clearAuth } from '../../shared/lib/auth';
import { AdminPage }           from '../../pages/AdminPage';
import { RequestsPage }        from './components/RequestsPage';
import { GuestsPage }          from './components/GuestsPage';
import { FaqPage }             from './components/FaqPage';
import { ConfigPage }          from './components/ConfigPage';
import { DepartmentsPage }     from './components/DepartmentsPage';
import { ConversationsPage }   from './components/ConversationsPage';
import { BlockedPage }         from './components/BlockedPage';
import { ReviewsPage }         from './components/ReviewsPage';
import { MenusPage }           from './components/MenusPage';
import { api }                from './api';

type Page = 'requests' | 'guests' | 'faq' | 'config' | 'departments' | 'conversations' | 'blocked' | 'reviews' | 'menus' | 'admin';

interface Props { onLogout: () => void; }

export function HotelModule({ onLogout }: Props) {
  const currentUser = getStoredUser();
  const [page, setPage] = useState<Page>('conversations');
  const [reviewsEnabled, setReviewsEnabled] = useState(false);
  const [surveyEnabled,  setSurveyEnabled]  = useState(false);
  const [menusEnabled,   setMenusEnabled]   = useState(false);

  useEffect(() => {
    api.getConfig()
      .then((c: any) => {
        setReviewsEnabled(!!c?.reviews_enabled);
        setSurveyEnabled(!!c?.survey_enabled);
        setMenusEnabled(!!c?.menus_enabled);
      })
      .catch(() => {});
  }, []);

  function handleLogout() { clearAuth(); onLogout(); }

  const nav: { id: Page; label: string; icon: React.ReactNode }[] = [
    { id: 'conversations', label: 'Conversations',   icon: <MessageSquare size={16} /> },
    { id: 'requests',      label: 'Requests',        icon: <BellRing size={16} /> },
    { id: 'guests',        label: 'Guests',          icon: <Users size={16} /> },
    { id: 'faq',           label: 'FAQ',             icon: <BookOpen size={16} /> },
    ...(menusEnabled ? [{ id: 'menus' as Page, label: 'Menus', icon: <UtensilsCrossed size={16} /> }] : []),
    { id: 'config',        label: 'Hotel Config',    icon: <Settings size={16} /> },
    { id: 'departments',   label: 'Departments',     icon: <Building2 size={16} /> },
    ...(reviewsEnabled ? [{ id: 'reviews' as Page, label: 'Reviews', icon: <Star size={16} /> }] : []),
    { id: 'blocked',       label: 'Blocked Numbers', icon: <ShieldOff size={16} /> },
    ...(isAdmin() ? [{ id: 'admin' as Page, label: 'Admin', icon: <Shield size={16} /> }] : []),
  ];

  return (
    <div className="flex flex-col md:flex-row h-full bg-slate-100 overflow-hidden">
      {/* Mobile top bar */}
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

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col bg-white border-r border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <img src="/logo.png" alt="SkedAI" className="h-36 w-auto" />
          <p className="text-xs text-slate-400 mt-1 truncate">
            {currentUser?.tenant?.name || currentUser?.email || 'SkedAI'}
          </p>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {nav.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                page === item.id
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <span className={page === item.id ? 'text-brand-500' : 'text-slate-400'}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-3 pb-3 border-t border-slate-100 pt-3 mt-auto">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 transition-colors"
          >
            <LogOut size={14} className="text-slate-400" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col p-3 md:p-5">
        {page === 'requests' && <RequestsPage />}
        {page === 'guests'   && <GuestsPage />}
        {page === 'faq'      && <FaqPage />}
        {page === 'conversations' && <ConversationsPage surveyEnabled={surveyEnabled} />}
        {page === 'config'        && <ConfigPage />}
        {page === 'departments'   && <DepartmentsPage />}
        {page === 'blocked'       && <BlockedPage />}
        {page === 'reviews'       && <ReviewsPage />}
        {page === 'menus'         && <MenusPage />}
        {page === 'admin'         && <AdminPage />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden flex items-center bg-white border-t border-slate-200 flex-shrink-0">
        {nav.map(item => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={clsx(
              'flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors',
              page === item.id ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'
            )}
          >
            <span className={clsx('transition-colors', page === item.id ? 'text-brand-500' : 'text-slate-400')}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
        <button
          onClick={handleLogout}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
        >
          <LogOut size={16} className="text-slate-400" /> Sign out
        </button>
      </nav>
    </div>
  );
}
