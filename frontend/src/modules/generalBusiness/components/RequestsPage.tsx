import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Clock, AlertCircle, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { gbApi } from '../api';
import type { GbRequest } from '../types';

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  open:        { bg: 'bg-red-50',    text: 'text-red-700',    icon: <AlertCircle size={14} /> },
  in_progress: { bg: 'bg-amber-50',  text: 'text-amber-700',  icon: <Clock size={14} /> },
  resolved:    { bg: 'bg-green-50',  text: 'text-green-700',  icon: <CheckCircle2 size={14} /> },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function GbRequestsPage() {
  const [requests, setRequests] = useState<GbRequest[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await gbApi.getRequests(filter);
      setRequests(list);
    } catch { /* silent */ }
  }, [filter]);

  useEffect(() => {
    load().then(() => setLoading(false));
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, [load]);

  async function updateStatus(id: string, status: string) {
    try {
      await gbApi.updateRequest(id, { status });
      await load();
    } catch (e: any) { alert(e.message); }
  }

  async function saveNotes(id: string) {
    try {
      await gbApi.updateRequest(id, { staff_notes: editNotes });
      setEditingId(null);
      await load();
    } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Requests</h2>
        <div className="flex gap-1">
          {['all', 'open', 'in_progress', 'resolved'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filter === s ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
              {s === 'all' ? 'All' : s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3">
        {requests.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">No requests found</p>
        )}
        {requests.map(r => {
          const sc = STATUS_COLORS[r.status] || STATUS_COLORS.open;
          return (
            <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={clsx('flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', sc.bg, sc.text)}>
                      {sc.icon} {r.status.replace('_', ' ')}
                    </span>
                    {r.request_type && (
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{r.request_type}</span>
                    )}
                    {r.department_name && (
                      <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{r.department_name}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 mb-1">{r.description}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    {r.guest_name && <span>{r.guest_name}</span>}
                    {r.guest_phone && <span>{r.guest_phone.replace('whatsapp:', '').replace('instagram:', 'IG:')}</span>}
                    <span>{timeAgo(r.created_at)}</span>
                  </div>
                </div>

                <div className="relative flex-shrink-0">
                  <select
                    value={r.status}
                    onChange={e => updateStatus(r.id, e.target.value)}
                    className="appearance-none bg-slate-100 text-xs font-medium text-slate-600 pl-3 pr-7 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors focus:outline-none">
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Staff notes */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                {editingId === r.id ? (
                  <div className="flex gap-2">
                    <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                      placeholder="Add staff notes..."
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
                    <button onClick={() => saveNotes(r.id)}
                      className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors">
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setEditingId(r.id); setEditNotes(r.staff_notes || ''); }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                    {r.staff_notes || 'Add notes...'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
