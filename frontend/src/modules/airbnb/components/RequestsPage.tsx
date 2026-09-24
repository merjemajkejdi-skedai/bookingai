import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { airbnbApi } from '../api';
import type { AirbnbRequest, AirbnbListing } from '../types';

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  open:     { bg: 'bg-red-50',   text: 'text-red-700',   icon: <AlertCircle size={14} /> },
  resolved: { bg: 'bg-green-50', text: 'text-green-700', icon: <CheckCircle2 size={14} /> },
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

export function AirbnbRequestsPage() {
  const [listings, setListings] = useState<AirbnbListing[]>([]);
  const [listingFilter, setListingFilter] = useState('');
  const [requests, setRequests] = useState<AirbnbRequest[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const [loading, setLoading] = useState(true);

  const [resolvedFrom, setResolvedFrom] = useState('');
  const [resolvedTo,   setResolvedTo]   = useState('');
  const [dateFilter,   setDateFilter]   = useState<{ resolvedAfter?: string; resolvedBefore?: string } | null>(null);

  useEffect(() => { airbnbApi.getListings().then(setListings).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const opts: any = { listingId: listingFilter || undefined };
      if (filter === 'resolved' && dateFilter) Object.assign(opts, dateFilter);
      setRequests(await airbnbApi.getRequests(filter, opts));
    } catch { /* silent */ }
  }, [filter, listingFilter, dateFilter]);

  useEffect(() => {
    load().then(() => setLoading(false));
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, [load]);

  useEffect(() => {
    if (filter !== 'resolved') { setResolvedFrom(''); setResolvedTo(''); setDateFilter(null); }
  }, [filter]);

  function applyDateFilter() {
    const resolvedAfter  = resolvedFrom ? `${resolvedFrom}T00:00:00.000Z` : undefined;
    const resolvedBefore = resolvedTo   ? `${resolvedTo}T23:59:59.999Z`   : undefined;
    setDateFilter(resolvedAfter || resolvedBefore ? { resolvedAfter, resolvedBefore } : null);
  }
  function clearDateFilter() { setResolvedFrom(''); setResolvedTo(''); setDateFilter(null); }

  async function updateStatus(id: string, status: 'open' | 'resolved') {
    try { await airbnbApi.updateRequestStatus(id, status); await load(); }
    catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Requests</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={listingFilter} onChange={e => setListingFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-300">
            <option value="">All listings</option>
            {listings.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="flex gap-1">
            {(['all', 'open', 'resolved'] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  filter === s ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
                {s === 'all' ? 'All' : s.replace(/^\w/, c => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filter === 'resolved' && (
        <div className="flex items-center gap-2 flex-wrap mb-4 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <span className="font-medium">Resolved between:</span>
          <input type="date" value={resolvedFrom} onChange={e => setResolvedFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1" />
          <span>and</span>
          <input type="date" value={resolvedTo} onChange={e => setResolvedTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1" />
          <button onClick={applyDateFilter}
            className="px-2.5 py-1 rounded-lg bg-brand-500 text-white font-medium hover:bg-brand-600">Apply</button>
          {dateFilter && (
            <button onClick={clearDateFilter} className="px-2.5 py-1 rounded-lg text-slate-500 hover:bg-slate-100">Clear</button>
          )}
          {dateFilter && (
            <span className="text-slate-400 ml-auto">{requests.length} result{requests.length === 1 ? '' : 's'}</span>
          )}
        </div>
      )}

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
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={clsx('flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', sc.bg, sc.text)}>
                      {sc.icon} {r.status}
                    </span>
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{r.category}</span>
                    <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{r.listing_name}</span>
                  </div>
                  <p className="text-sm text-slate-800 mb-1">{r.description}</p>
                  <span className="text-xs text-slate-400">{timeAgo(r.created_at)}</span>
                </div>
                <button
                  onClick={() => updateStatus(r.id, r.status === 'open' ? 'resolved' : 'open')}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                  {r.status === 'open' ? 'Mark resolved' : 'Reopen'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
