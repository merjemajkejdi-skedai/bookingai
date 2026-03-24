import { useState, useEffect } from 'react';
import { Download, TrendingUp, Users, BookOpen, CalendarDays } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { api } from '../api';
import { Spinner } from '../ui';

const PRESETS = [
  { label: 'This month', getRange: () => ({ from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last month', getRange: () => ({ from: format(startOfMonth(subMonths(new Date(),1)), 'yyyy-MM-dd'), to: format(endOfMonth(subMonths(new Date(),1)), 'yyyy-MM-dd') }) },
  { label: 'Last 30 d',  getRange: () => ({ from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last 90 d',  getRange: () => ({ from: format(subDays(new Date(), 90), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
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
    const rows: string[][] = [['Category', 'Name', 'Events', 'Participants', 'Revenue (ALL)']];
    data.byTemplate?.forEach((r: any) => rows.push(['Template', r.title, r.events, r.participants, r.revenue / 100]));
    data.byTeacher?.forEach((r: any)   => rows.push(['Teacher',  r.name,  '-',     r.participants, r.revenue / 100]));
    data.byEvent?.forEach((r: any)     => rows.push(['Event',    r.title, '1',     r.participants, r.revenue / 100]));
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `analytics-${from}-${to}.csv`;
    a.click();
  }

  if (loading) return <div className="p-8"><Spinner /></div>;

  const maxRevTemplate = Math.max(...(data?.byTemplate?.map((r: any) => r.revenue) ?? [1]), 1);
  const maxRevTeacher  = Math.max(...(data?.byTeacher?.map((r: any) => r.revenue) ?? [1]), 1);
  const maxPaxEvent    = Math.max(...(data?.byEvent?.map((r: any) => r.participants) ?? [1]), 1);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-slate-400 mt-0.5">{from} → {to}</p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {PRESETS.map((p, i) => (
          <button key={p.label} onClick={() => applyPreset(i)}
            className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              preset === i ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreset(-1); }}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          <span className="text-slate-400">–</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreset(-1); }}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={<TrendingUp size={18} className="text-brand-500" />}
          label="Total revenue" value={`${((data?.overview?.totalRevenue ?? 0) / 100).toLocaleString()} ALL`} />
        <StatCard icon={<Users size={18} className="text-violet-500" />}
          label="Total participants" value={(data?.overview?.totalParticipants ?? 0).toString()} />
      </div>

      {data?.byTemplate?.length > 0 && (
        <ChartCard title="By Event Type" icon={<BookOpen size={15} />}>
          {data.byTemplate.map((r: any) => (
            <TemplateRow key={r.title} name={r.title} events={r.events}
              participants={r.participants} revenue={r.revenue} maxRevenue={maxRevTemplate} />
          ))}
        </ChartCard>
      )}

      {data?.byTeacher?.length > 0 && (
        <ChartCard title="By Teacher" icon={<Users size={15} />}>
          {data.byTeacher.map((r: any) => (
            <BarRow key={r.id} name={r.name} color={r.color ?? '#6366f1'}
              secondary={`${r.participants} participants`}
              revenue={r.revenue} maxRevenue={maxRevTeacher} />
          ))}
        </ChartCard>
      )}

      {data?.byEvent?.length > 0 && (
        <ChartCard title="Events — Participants" icon={<CalendarDays size={15} />}>
          {data.byEvent.map((r: any) => (
            <EventRow key={r.id} title={r.title} date={r.date} time={r.time}
              participants={r.participants} revenue={r.revenue} maxPax={maxPaxEvent} />
          ))}
        </ChartCard>
      )}

      {!data?.byTemplate?.length && !data?.byTeacher?.length && (
        <div className="text-center py-16 text-slate-400">
          <TrendingUp size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No data for the selected period.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-xl font-semibold text-slate-800 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4 text-slate-700 font-medium">
        <span className="text-slate-400">{icon}</span> {title}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function BarRow({ name, color, secondary, revenue, maxRevenue }: {
  name: string; color: string; secondary?: string; revenue: number; maxRevenue: number;
}) {
  const pct = maxRevenue > 0 ? Math.round((revenue / maxRevenue) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="text-sm text-slate-700 truncate">{name}</span>
          {secondary && <span className="text-xs text-slate-400 ml-1">{secondary}</span>}
        </div>
        <span className="text-sm font-semibold text-slate-800 ml-4 flex-shrink-0">{(revenue / 100).toLocaleString()} ALL</span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function TemplateRow({ name, events, participants, revenue, maxRevenue }: {
  name: string; events: number; participants: number; revenue: number; maxRevenue: number;
}) {
  const pct = maxRevenue > 0 ? Math.round((revenue / maxRevenue) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-700 font-medium truncate">{name}</span>
        <div className="flex items-center gap-3 ml-4 flex-shrink-0 text-xs text-slate-500">
          <span>{events} event{events !== 1 ? 's' : ''}</span>
          <span>{participants} pax</span>
          <span className="font-semibold text-slate-800">{(revenue / 100).toLocaleString()} ALL</span>
        </div>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EventRow({ title, date, time, participants, revenue, maxPax }: {
  title: string; date: string; time: string; participants: number; revenue: number; maxPax: number;
}) {
  const pct = maxPax > 0 ? Math.round((participants / maxPax) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="min-w-0">
          <span className="text-sm text-slate-700 truncate">{title}</span>
          <span className="text-xs text-slate-400 ml-2">{date} {time}</span>
        </div>
        <div className="flex items-center gap-3 ml-4 flex-shrink-0 text-xs text-slate-500">
          <span>{participants} pax</span>
          <span className="font-semibold text-slate-800">{(revenue / 100).toLocaleString()} ALL</span>
        </div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
