import { useState, useEffect } from 'react';
import { LogOut, Settings, HelpCircle, Building2, Bot, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { api } from './api';
import type { SkedAIConfig } from './types';
import { AdminTab }   from './components/AdminTab';
import { SupportTab } from './components/SupportTab';
import { SalesTab }   from './components/SalesTab';
import { ConversationsPage } from '../hotel/components/ConversationsPage';
import { clearAuth }  from '../../shared/lib/auth';

type Tab = 'conversations' | 'admin' | 'support' | 'sales';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'conversations', label: 'Conversations', icon: <MessageSquare size={16} /> },
  { id: 'admin',   label: 'Admin',   icon: <Settings   size={16} /> },
  { id: 'support', label: 'Support', icon: <HelpCircle size={16} /> },
  { id: 'sales',   label: 'Sales',   icon: <Building2  size={16} /> },
];

const EMPTY: SkedAIConfig = {
  forwardPhone: '', calendlyUrl: '',
  supportFaq: [], healthCheckUrls: [], industries: [],
};

export function SkedAIModule({ onLogout }: { onLogout: () => void }) {
  const [tab,     setTab]     = useState<Tab>('admin');
  const [config,  setConfig]  = useState<SkedAIConfig>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleLogout() { clearAuth(); onLogout(); }

  function patchConfig(partial: Partial<SkedAIConfig>) {
    setConfig(c => ({ ...c, ...partial }));
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="h-14 flex-shrink-0 bg-white border-b border-slate-200 flex items-center px-5 gap-3">
        <Bot size={20} className="text-brand-500" />
        <span className="text-sm font-semibold text-slate-800">SkedAI</span>
        <span className="text-xs text-slate-400 font-medium px-2 py-0.5 bg-brand-50 rounded-full text-brand-600">
          Sales & Support
        </span>
        <button onClick={handleLogout}
          className="ml-auto flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors">
          <LogOut size={15} /> Sign out
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col py-4 gap-1 px-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left',
                tab === t.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800',
              )}>
              <span className={tab === t.id ? 'text-brand-500' : 'text-slate-400'}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {tab === 'conversations' && <ConversationsPage />}
              {tab === 'admin'   && <AdminTab   config={config} onSaved={patchConfig} />}
              {tab === 'support' && <SupportTab config={config} onSaved={patchConfig} />}
              {tab === 'sales'   && <SalesTab   config={config} onSaved={patchConfig} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
