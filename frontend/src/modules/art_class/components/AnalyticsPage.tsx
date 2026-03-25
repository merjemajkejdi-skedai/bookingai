import { useState, useEffect } from 'react';
import { Download, TrendingUp, Users, BookOpen, CalendarDays } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { api } from '../api';
import { Spinner } from '../ui';

const PRESETS = [
  { label: 'This month', getRange: () => ({ from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(endOfMonth(new Date()), 'yyyy-MM-dd') }) },
  { label: 'Last month',  getRange: () => ({ from: format(startOfMonth(subMonths(new Date(),1)), 'yyyy-MM-dd'), to: format(endOfMonth(subMonths(new Date(),1)), 'yyyy-MM-dd') }) },
  { label: 'Last 30 d',   getRange: () => ({ from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last 90 d',   getRange: () => ({ from: format(subDays(new Date(), 90), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
];

export function AnalyticsPage() {
  const [preset, setPreset] = useState(0);
  const [from, setFrom] = useState(PRESETS[0].getRange().from);
  const [to,   setTo]   = useState(PRESETS[0].getRange().to);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getAnalytics(from, to).then(setData).finally(() => setLoading(false));
  }, [from, to]);

  function applyPreset(idx: number) {
    setPreset(idx);
    const r = PRESETS[idx].getRange();
    setFrom(r.from); setTo(r.to);
  }

  function exportCSV() {
    if (!data) return;
    const rows: (string | number)[][] = [['Category', 'Name', 'Classes', 'Kids', 'Revenue (ALL)']];
    data.byTemplate?.forEach((r: any) => rows.push(['Class Type', r.title, r.events, r.participants, r.revenue / 100]));
    data.byTeacher?.forEach((r: any)  => rows.push(['Teacher',    r.name,  '-',    r.participants, r.revenue / 100]));
    data.byEvent?.forEach((r: any)    => rows.push(['Class',      `${r.title} ${r.date}`, '1', r.participants, r.revenue / 100]));
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `analytics-${from}-${to}.csv`;
    a.click();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">

        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800">Analytics</h1>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            <Download size={14} /> Export CSV
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {PRESETS.map((p, i) => (
            <button key={p.label} onClick={() => applyPreset(i)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                preset === i ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset(-1); }}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
            <span className="text-slate-400 text-sm">–</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset(-1); }}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={<TrendingUp size={16} className="text-brand-500" />}
                label="Total revenue" value={`${((data?.overview?.totalRevenue ?? 0) / 100).toLocaleString()} ALL`} />
              <StatCard icon={<Users size={16} className="text-violet-500" />}
                label="Total kids" value={String(data?.overview?.totalParticipants ?? 0)} />
            </div>

            {data?.byTemplate?.length > 0 && (
              <Section title="By Class Type" icon={<BookOpen size={14} />}>
                <div>
                  <div className="grid grid-cols-4 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide border-b border-slate-100">
                    <span className="col-span-2">Name</span>
                    <span className="text-center">Kids</span>
                    <span className="text-right">Revenue</span>
                  </div>
                  {data.byTemplate.map((r: any, i: number) => (
                    <div key={r.title ?? i}
                      className="grid grid-cols-4 px-4 py-3 text-sm border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <div className="col-span-2 min-w-0">
                        <p className="truncate text-slate-700 font-medium">{r.title}</p>
                        <p className="text-xs text-slate-400">{r.events} class{r.events !== 1 ? 'es' : ''}</p>
                      </div>
                      <span className="text-center text-slate-600 font-medium self-center">{r.participants}</span>
                      <span className="text-right text-slate-800 font-semibold self-center">{(r.revenue / 100).toLocaleString()} ALL</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {data?.byTeacher?.length > 0 && (
              <Section title="By Teacher" icon={<Users size={14} />}>
                <div>
                  <div className="grid grid-cols-3 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide border-b border-slate-100">
                    <span>Name</span>
                    <span className="text-center">Kids</span>
                    <span className="text-right">Revenue</span>
                  </div>
                  {data.byTeacher.map((r: any, i: number) => (
                    <div key={r.id ?? i}
                      className="grid grid-cols-3 px-4 py-3 text-sm border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color ?? '#94a3b8' }} />
                        <span className="truncate text-slate-700">{r.name}</span>
                      </div>
                      <span className="text-center text-slate-600 font-medium">{r.participants}</span>
                      <span className="text-right text-slate-800 font-semibold">{(r.revenue / 100).toLocaleString()} ALL</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {data?.byEvent?.length > 0 && (
              <Section title="Classes" icon={<CalendarDays size={14} />}>
                <div>
                  <div className="grid grid-cols-4 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide border-b border-slate-100">
                    <span className="col-span-2">Class</span>
                    <span className="text-center">Kids</span>
                    <span className="text-right">Revenue</span>
                  </div>
                  {data.byEvent.map((r: any, i: number) => (
                    <div key={r.id ?? i}
                      className="grid grid-cols-4 px-4 py-3 text-sm border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <div className="col-span-2 min-w-0">
                        <p className="truncate text-slate-700 font-medium">{r.title}</p>
                        <p className="text-xs text-slate-400">{r.date}{r.time ? ` · ${r.time}` : ''}</p>
                      </div>
                      <span className="text-center text-slate-600 font-medium self-center">{r.participants}</span>
                      <span className="text-right text-slate-800 font-semibold self-center">{(r.revenue / 100).toLocaleString()} ALL</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {!data?.byTemplate?.length && !data?.byTeacher?.length && (
              <div className="text-center py-16 text-slate-400">
                <TrendingUp size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No registrations in this period.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 truncate">{label}</p>
        <p className="text-lg font-semibold text-slate-800 mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">
        <span className="text-slate-400">{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}
