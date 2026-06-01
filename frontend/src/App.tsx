import { useState } from 'react';
import { ChevronDown, ArrowLeft, LogOut, BarChart2 } from 'lucide-react';
import { isAuthenticated, getStoredUser, clearAuth, getAdminTenant, setAdminTenant } from './shared/lib/auth';
import type { AdminTenant } from './shared/lib/auth';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { CostAnalyticsPage } from './pages/CostAnalyticsPage';
import { BookingModule } from './modules/booking';
import { ArtEventModule } from './modules/art_event';
import { ArtClassModule } from './modules/art_class';
import { RestaurantModule } from './modules/restaurant';
import { HotelModule } from './modules/hotel';
import { SkedAIModule } from './modules/skedai';

type ShopMode = 'booking' | 'art_event' | 'art_class' | 'restaurant' | 'hotel' | 'skedai';

function getShopMode(type: string): ShopMode {
  const t = type.toLowerCase();
  if (t === 'art_class')  return 'art_class';
  if (t === 'art_event')  return 'art_event';
  if (t === 'restaurant') return 'restaurant';
  if (t === 'hotel')      return 'hotel';
  if (t === 'skedai')     return 'skedai';
  return 'booking';
}

// Thin banner shown when super_admin is previewing a shop
function AdminBanner({
  tenant,
  allTenants,
  onSwitch,
  onBack,
  onLogout,
}: {
  tenant: AdminTenant;
  allTenants: AdminTenant[];
  onSwitch: (t: AdminTenant) => void;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="h-10 flex-shrink-0 bg-violet-700 text-white flex items-center px-3 gap-2 z-50 relative">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-violet-200 hover:text-white transition-colors">
        <ArrowLeft size={13} /> Admin
      </button>
      <span className="text-violet-400">|</span>

      {/* Shop switcher */}
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-violet-200 transition-colors">
          {tenant.name}
          <span className="text-violet-300 text-xs capitalize">({tenant.type.replace('_', ' ')})</span>
          <ChevronDown size={13} className="text-violet-300" />
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
            {allTenants.map(t => (
              <button
                key={t.id}
                onClick={() => { onSwitch(t); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2">
                <span className="text-slate-800 font-medium truncate">{t.name}</span>
                <span className="text-xs text-slate-400 capitalize flex-shrink-0">{t.type.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onLogout}
        className="ml-auto flex items-center gap-1 text-xs text-violet-300 hover:text-white transition-colors">
        <LogOut size={13} /> Sign out
      </button>
    </div>
  );
}

// Admin shell — header nav + page switcher (Shops vs Cost Analytics)
function AdminShell({
  onLogout,
  onViewShop,
  onTenantsLoaded,
}: {
  onLogout: () => void;
  onViewShop: (t: AdminTenant) => void;
  onTenantsLoaded: (ts: AdminTenant[]) => void;
}) {
  const [adminTab, setAdminTab] = useState<'shops' | 'analytics'>('shops');
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-14 bg-white border-b border-slate-200 flex items-center px-6 gap-4">
        <img src="/logo.png" alt="SkedAI" className="h-8 w-auto" />
        <span className="text-sm font-semibold text-slate-700">Admin Panel</span>

        {/* Nav tabs */}
        <div className="flex ml-4 gap-1">
          <button
            onClick={() => setAdminTab('shops')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              adminTab === 'shops'
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            Shops
          </button>
          <button
            onClick={() => setAdminTab('analytics')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              adminTab === 'analytics'
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            <BarChart2 size={13} /> Cost Analytics
          </button>
        </div>

        <button
          onClick={onLogout}
          className="ml-auto flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors">
          <LogOut size={15} /> Sign out
        </button>
      </div>

      {adminTab === 'shops' && (
        <AdminPage onViewShop={onViewShop} onTenantsLoaded={onTenantsLoaded} />
      )}
      {adminTab === 'analytics' && <CostAnalyticsPage />}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [viewTenant, setViewTenant] = useState<AdminTenant | null>(getAdminTenant);
  // Kept in state so the banner dropdown can list all shops without refetching
  const [allTenants, setAllTenants] = useState<AdminTenant[]>([]);

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  const user = getStoredUser();

  const handleLogout = () => {
    clearAuth();
    setAuthed(false);
  };

  // ── Super admin ────────────────────────────────────────────────────────────
  if (user?.role === 'super_admin') {
    const handleViewShop = (tenant: AdminTenant) => {
      setAdminTenant(tenant);
      setViewTenant(tenant);
    };

    const handleBack = () => {
      setAdminTenant(null);
      setViewTenant(null);
    };

    // No shop selected → show admin panel
    if (!viewTenant) {
      return (
        <AdminShell
          onLogout={handleLogout}
          onViewShop={handleViewShop}
          onTenantsLoaded={setAllTenants}
        />
      );
    }

    // Shop selected → thin banner + full module below
    const mode = getShopMode(viewTenant.type);
    return (
      <div className="flex flex-col h-screen">
        <AdminBanner
          tenant={viewTenant}
          allTenants={allTenants}
          onSwitch={(t) => { setAdminTenant(t); setViewTenant(t); }}
          onBack={handleBack}
          onLogout={handleLogout}
        />
        <div className="flex-1 min-h-0">
          {mode === 'art_class'  && <ArtClassModule    key={viewTenant.id} onLogout={handleLogout} />}
          {mode === 'art_event'  && <ArtEventModule    key={viewTenant.id} onLogout={handleLogout} />}
          {mode === 'booking'    && <BookingModule      key={viewTenant.id} onLogout={handleLogout} />}
          {mode === 'restaurant' && <RestaurantModule   key={viewTenant.id} onLogout={handleLogout} />}
          {mode === 'hotel'      && <HotelModule        key={viewTenant.id} onLogout={handleLogout} />}
          {mode === 'skedai'     && <SkedAIModule       key={viewTenant.id} onLogout={handleLogout} />}
        </div>
      </div>
    );
  }

  // ── Regular shop owner ─────────────────────────────────────────────────────
  const mode = getShopMode(user?.tenant?.type ?? '');
  return (
    <div className="h-screen">
      {mode === 'art_class'  && <ArtClassModule    onLogout={handleLogout} />}
      {mode === 'art_event'  && <ArtEventModule    onLogout={handleLogout} />}
      {mode === 'booking'    && <BookingModule      onLogout={handleLogout} />}
      {mode === 'restaurant' && <RestaurantModule   onLogout={handleLogout} />}
      {mode === 'hotel'      && <HotelModule        onLogout={handleLogout} />}
      {mode === 'skedai'     && <SkedAIModule       onLogout={handleLogout} />}
    </div>
  );
}
