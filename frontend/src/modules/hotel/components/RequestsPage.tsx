import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Clock, CheckCircle, ChevronDown, RefreshCw, Wrench, UtensilsCrossed, Sparkles, MessageSquare, ShieldAlert, HelpCircle, StickyNote } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import type { HotelRequest } from '../types';
import { Button, Spinner } from '../ui';

const DEPT_LABELS: Record<string, string> = {
  food_beverage: 'Food & Beverage',
  housekeeping:  'Housekeeping',
  maintenance:   'Maintenance',
  reception:     'Reception',
  management:    'Management',
};

const DEPT_COLORS: Record<string, string> = {
  food_beverage: 'bg-orange-100 text-orange-700',
  housekeeping:  'bg-blue-100 text-blue-700',
  maintenance:   'bg-yellow-100 text-yellow-700',
  reception:     'bg-indigo-100 text-indigo-700',
  management:    'bg-red-100 text-red-700',
};

const DEPT_ICONS: Record<string, React.ReactNode> = {
  food_beverage: <UtensilsCrossed size={13} />,
  housekeeping:  <Sparkles size={13} />,
  maintenance:   <Wrench size={13} />,
  reception:     <MessageSquare size={13} />,
  management:    <ShieldAlert size={13} />,
};

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  normal: 'bg-yellow-400',
  low:    'bg-slate-300',
};

const STATUS_TABS = [
  { id: 'pending',     label: 'Open',        icon: <AlertCircle size={13} /> },
  { id: 'in_progress', label: 'In Progress',  icon: <RefreshCw size={13} /> },
  { id: 'resolved',    label: 'Resolved',     icon: <CheckCircle size={13} /> },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:     { label: 'Open',        cls: 'bg-amber-50 text-amber-700' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700' },
  resolved:    { label: 'Resolved',    cls: 'bg-green-50 text-green-700' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function resolutionTime(req: HotelRequest): string | null {
  if (!req.resolved_at || !req.created_at) return null;
  const mins = Math.round(
    (new Date(req.resolved_at).getTime() - new Date(req.created_at).getTime()) / 60000,
  );
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60 * 10) / 10}h`;
}

export function RequestsPage() {
  const [tab, setTab]           = useState<'pending' | 'in_progress' | 'resolved'>('pending');
  const [requests, setRequests] = useState<HotelRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getRequests(tab)
      .then(setRequests)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(reqId: string, status: string) {
    setUpdating(reqId);
    try {
      await api.updateRequestStatus(reqId, status);
      setRequests(r => r.filter(x => x.id !== reqId));
    } finally {
      setUpdating(null);
    }
  }

  // Legacy single-step advance (for the Start/Done button)
  async function advance(req: HotelRequest) {
    const next = req.status === 'pending' ? 'in_progress' : 'resolved';
    await updateStatus(req.id, next);
  }

  // Group by department
  const grouped: Record<string, HotelRequest[]> = {};
  for (const r of requests) {
    if (!grouped[r.department]) grouped[r.department] = [];
    grouped[r.department].push(r);
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-lg font-semibold text-slate-800">Guest Requests</h1>
        <button onClick={load} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl flex-shrink-0">
        {STATUS_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all',
              tab === t.id
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? <Spinner /> : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <CheckCircle size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No {tab === 'pending' ? 'open' : tab.replace('_', ' ')} requests</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([dept, items]) => (
              <div key={dept}>
                {/* Department header */}
                <div className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold mb-2 w-fit',
                  DEPT_COLORS[dept] || 'bg-slate-100 text-slate-600'
                )}>
                  {DEPT_ICONS[dept] || <HelpCircle size={13} />}
                  {DEPT_LABELS[dept] || dept}
                  <span className="opacity-60">({items.length})</span>
                </div>

                {/* Request cards */}
                <div className="space-y-2">
                  {items.map(r => {
                    const resTm = resolutionTime(r);
                    const badge = STATUS_BADGE[r.status] || STATUS_BADGE.pending;
                    return (
                      <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Room + guest + priority + status */}
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                Room {r.room_number}
                              </span>
                              {r.guest_name && (
                                <span className="text-xs text-slate-600 font-medium">{r.guest_name}</span>
                              )}
                              <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', PRIORITY_DOT[r.priority])} />
                              <span className="text-xs text-slate-400 capitalize">{r.priority} priority</span>
                              <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', badge.cls)}>
                                {badge.label}
                              </span>
                            </div>

                            {/* Department label + request type */}
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className={clsx(
                                'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                DEPT_COLORS[r.department] || 'bg-slate-100 text-slate-600'
                              )}>
                                {DEPT_ICONS[r.department]}
                                {DEPT_LABELS[r.department] || r.department}
                              </span>
                              <span className="text-xs text-slate-400 capitalize">
                                {r.request_type.replace(/_/g, ' ')}
                              </span>
                            </div>

                            {/* Description */}
                            <p className="text-sm text-slate-700 leading-snug">{r.description}</p>

                            {/* Guest photo */}
                            {r.photo_url && (
                              <div className="mt-2">
                                <p className="text-xs text-slate-400 mb-1">📷 Guest photo</p>
                                <a href={r.photo_url} target="_blank" rel="noreferrer" className="block">
                                  <img
                                    src={r.photo_url}
                                    alt="Guest photo"
                                    className="rounded-lg max-h-40 object-cover border border-slate-200 hover:opacity-90 transition-opacity cursor-pointer"
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                  <p className="text-xs text-brand-600 mt-1 hover:underline">View full size ↗</p>
                                </a>
                              </div>
                            )}

                            {/* Staff notes */}
                            {r.notes && (
                              <div className="mt-2 bg-amber-50 rounded-lg px-3 py-2">
                                <div className="flex items-center gap-1 mb-1">
                                  <StickyNote size={11} className="text-amber-600" />
                                  <p className="text-xs font-medium text-amber-700">Staff notes</p>
                                </div>
                                {r.notes.split('\n').map((note, i) => (
                                  <p key={i} className="text-xs text-amber-600 leading-snug">{note}</p>
                                ))}
                              </div>
                            )}

                            {/* Time + resolution time */}
                            <div className="flex items-center gap-3 mt-2">
                              <p className="text-xs text-slate-400 flex items-center gap-1">
                                <Clock size={11} /> {timeAgo(r.created_at)}
                              </p>
                              {resTm && (
                                <p className="text-xs text-green-600 flex items-center gap-1">
                                  <CheckCircle size={11} /> Resolved in {resTm}
                                </p>
                              )}
                              {r.resolved_by && (
                                <p className="text-xs text-slate-400">
                                  by {r.resolved_by.replace('whatsapp:', '')}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Actions — shown for non-resolved requests */}
                          {tab !== 'resolved' && (
                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              {r.status === 'pending' && (
                                <button
                                  onClick={() => updateStatus(r.id, 'in_progress')}
                                  disabled={updating === r.id}
                                  className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-40 transition-colors whitespace-nowrap"
                                >
                                  {updating === r.id ? <RefreshCw size={11} className="animate-spin inline" /> : 'Mark in progress'}
                                </button>
                              )}
                              <button
                                onClick={() => updateStatus(r.id, 'resolved')}
                                disabled={updating === r.id}
                                className="text-xs px-2.5 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 disabled:opacity-40 transition-colors whitespace-nowrap"
                              >
                                {updating === r.id ? <RefreshCw size={11} className="animate-spin inline" /> : 'Mark resolved ✓'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
