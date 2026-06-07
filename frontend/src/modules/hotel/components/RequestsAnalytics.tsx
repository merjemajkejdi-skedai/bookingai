import { useEffect, useState } from 'react';
import { api } from '../api';
import { Spinner } from '../ui';

// Brand-aligned palette (matches spec colours)
const TYPE_COLORS = ['#0F6E56', '#185FA5', '#854F0B', '#633806', '#888780', '#1D7A63', '#2563EB'];

const PERIODS = [
  { label: '7 days', val: 7 },
  { label: '30 days', val: 30 },
  { label: '90 days', val: 90 },
];

const prettify = (s: string) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// --- Small presentational helpers ------------------------------------------

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 ${className}`}>
      {title && <h3 className="text-sm font-semibold text-slate-700 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

function NoData({ small }: { small?: boolean }) {
  return (
    <div className={`flex items-center justify-center text-slate-300 text-xs ${small ? 'h-24' : 'h-40'}`}>
      No data for this period
    </div>
  );
}

export function RequestsAnalytics() {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [resolution, setResolution] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [s, b, r] = await Promise.all([
          api.getRequestsAnalyticsSummary(days),
          api.getRequestsAnalyticsBreakdown(days),
          api.getRequestsAnalyticsResolution(days),
        ]);
        if (cancelled) return;
        setSummary(s);
        setBreakdown(b);
        setResolution(r);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [days]);

  const periodSelector = (
    <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit mb-6">
      {PERIODS.map(p => (
        <button
          key={p.val}
          onClick={() => setDays(p.val)}
          className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
            days === p.val
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto pr-1">
        {periodSelector}

        {loading && <Spinner />}

        {!loading && error && (
          <div className="text-center py-16 text-red-400 text-sm">{error}</div>
        )}

        {!loading && !error && +summary?.total === 0 && (
          <div className="text-center py-16 text-slate-400">
            <p className="text-2xl mb-2">📊</p>
            <p className="text-sm font-medium">No requests in this period</p>
            <p className="text-xs mt-1">Data will appear once guests start making requests</p>
          </div>
        )}

        {!loading && !error && +summary?.total > 0 && (
          <Dashboard days={days} summary={summary} breakdown={breakdown} resolution={resolution} />
        )}
      </div>
    </div>
  );
}

// --- Main dashboard body ----------------------------------------------------

function Dashboard({ days, summary, breakdown, resolution }: any) {
  const prevAvg = summary?.prev_avg_resolution_minutes;
  const currAvg = summary?.avg_resolution_minutes;
  const avgDiff = prevAvg && currAvg ? Math.round(((prevAvg - currAvg) / prevAvg) * 100) : null;
  const slaRate = summary?.total > 0 ? Math.round((summary.sla_breached / summary.total) * 100) : 0;
  const resRate = summary?.total > 0 ? Math.round((summary.resolved / summary.total) * 100) : 0;

  const metrics = [
    {
      label: 'Total requests',
      value: (+summary?.total || 0).toLocaleString(),
      sub: `${days}-day period`,
      color: '',
    },
    {
      label: 'Avg resolution time',
      value: currAvg ? `${currAvg} min` : '–',
      sub: avgDiff !== null
        ? `${avgDiff > 0 ? avgDiff + '% faster' : Math.abs(avgDiff) + '% slower'} vs previous`
        : 'no previous data',
      color: avgDiff != null && avgDiff > 0 ? 'text-green-600' : avgDiff != null && avgDiff < 0 ? 'text-red-500' : 'text-slate-400',
    },
    {
      label: 'SLA breached',
      value: summary?.sla_breached || 0,
      sub: `${slaRate}% of requests`,
      color: slaRate > 10 ? 'text-red-500' : 'text-green-600',
    },
    {
      label: 'Resolution rate',
      value: `${resRate}%`,
      sub: `${(+summary?.resolved || 0).toLocaleString()} resolved`,
      color: resRate >= 90 ? 'text-green-600' : resRate >= 70 ? 'text-amber-600' : 'text-red-500',
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map(m => (
          <div key={m.label} className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-xs text-slate-400">{m.label}</p>
            <p className="text-2xl font-semibold text-slate-800 mt-1">{m.value}</p>
            <p className={`text-xs mt-1 ${m.color || 'text-slate-400'}`}>{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Requests by type"><TypeDoughnut data={breakdown?.by_type} /></Card>
        <Card title="Requests by department"><DeptBars data={breakdown?.by_dept} /></Card>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Daily volume"><DailyVolume data={breakdown?.daily} /></Card>
        <Card title="Status breakdown"><StatusBars data={breakdown?.by_status} /></Card>
      </div>

      {/* Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Resolution time by department"><DeptResolution data={resolution?.by_dept} /></Card>
        <Card title="Resolution time trend"><TrendLine data={resolution?.trend} /></Card>
      </div>

      {/* Peak hours */}
      <Card title="Peak hours (by hour of day)"><HourlyBars data={breakdown?.hourly} /></Card>

      {/* Row 4 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top issues"><TopIssues data={breakdown?.top_issues} /></Card>
        <Card title="Staff performance"><StaffPerf data={resolution?.staff_perf} /></Card>
      </div>
    </div>
  );
}

// --- Chart 1: Doughnut (requests by type) ----------------------------------

function TypeDoughnut({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  const total = data.reduce((s, t) => s + +t.count, 0) || 1;
  let acc = 0;
  const stops = data.map((t, i) => {
    const start = (acc / total) * 100;
    acc += +t.count;
    const end = (acc / total) * 100;
    return `${TYPE_COLORS[i % TYPE_COLORS.length]} ${start}% ${end}%`;
  });
  return (
    <div className="flex items-center gap-6">
      <div className="relative flex-shrink-0">
        <div
          className="w-32 h-32 rounded-full"
          style={{ background: `conic-gradient(${stops.join(', ')})` }}
        />
        <div className="absolute inset-0 m-auto w-20 h-20 bg-white rounded-full flex flex-col items-center justify-center">
          <span className="text-lg font-semibold text-slate-800">{total.toLocaleString()}</span>
          <span className="text-[10px] text-slate-400">total</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {data.map((t, i) => (
          <div key={t.request_type} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
            <span className="text-slate-600 truncate flex-1">{prettify(t.request_type)}</span>
            <span className="text-slate-400">{Math.round((+t.count / total) * 100)}%</span>
            <span className="text-slate-700 font-medium w-8 text-right">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Chart 2: Horizontal bars (requests by department) ---------------------

function DeptBars({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  const max = Math.max(...data.map(d => +d.count)) || 1;
  return (
    <div className="space-y-2.5">
      {data.map(d => (
        <div key={d.department} className="flex items-center gap-3">
          <span className="text-xs text-slate-600 w-28 truncate capitalize">{prettify(d.department)}</span>
          <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
            <div className="h-full bg-brand-500 rounded-md" style={{ width: `${(+d.count / max) * 100}%` }} />
          </div>
          <span className="text-xs font-medium text-slate-700 w-8 text-right">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

// --- Chart 3: Grouped bars (daily created vs resolved) ---------------------

function DailyVolume({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  const max = Math.max(...data.map(d => Math.max(+d.created, +d.resolved)), 1);
  return (
    <div>
      <div className="flex items-end gap-2 h-40">
        {data.map(d => (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-0.5 min-w-0">
            <div className="w-full flex items-end justify-center gap-0.5 h-full">
              <div className="w-1/2 bg-brand-500 rounded-t" style={{ height: `${(+d.created / max) * 100}%` }} title={`${d.created} created`} />
              <div className="w-1/2 bg-green-500 rounded-t" style={{ height: `${(+d.resolved / max) * 100}%` }} title={`${d.resolved} resolved`} />
            </div>
            <span className="text-[9px] text-slate-400 truncate w-full text-center">
              {new Date(d.day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-3 justify-center text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand-500" /> Created</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Resolved</span>
      </div>
    </div>
  );
}

// --- Chart 4: Status horizontal bars ---------------------------------------

function StatusBars({ data }: { data: any[] }) {
  const statusOrder = ['pending', 'in_progress', 'resolved'];
  const statusLabels: Record<string, string> = { pending: 'Open', in_progress: 'In Progress', resolved: 'Resolved' };
  const statusColors: Record<string, string> = { pending: '#B45309', in_progress: '#1D4ED8', resolved: '#065F46' };
  const counts = statusOrder.map(s => +(data?.find((b: any) => b.status === s)?.count || 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return <NoData />;
  return (
    <div className="space-y-3">
      {statusOrder.map((s, i) => (
        <div key={s} className="flex items-center gap-3">
          <span className="text-xs text-slate-600 w-24">{statusLabels[s]}</span>
          <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
            <div className="h-full rounded-md" style={{ width: `${(counts[i] / total) * 100}%`, background: statusColors[s] }} />
          </div>
          <span className="text-xs font-medium text-slate-700 w-8 text-right">{counts[i]}</span>
        </div>
      ))}
    </div>
  );
}

// --- Chart 5: Resolution time trend line with 20-min target ----------------

function TrendLine({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  const target = 20;
  const W = 480, H = 160, P = 24;
  const vals = data.map(d => +d.avg_minutes);
  const max = Math.max(...vals, target) * 1.15 || 1;
  const n = data.length;
  const x = (i: number) => n <= 1 ? P : P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const points = data.map((d, i) => `${x(i)},${y(+d.avg_minutes)}`).join(' ');
  const targetY = y(target);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 180 }}>
        {/* target line */}
        <line x1={P} y1={targetY} x2={W - P} y2={targetY} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 4" />
        <text x={W - P} y={targetY - 4} textAnchor="end" fontSize={9} fill="#ef4444">target {target}m</text>
        {/* trend line */}
        <polyline points={points} fill="none" stroke="#0F6E56" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(+d.avg_minutes)} r={2.5} fill="#0F6E56" />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-slate-400 mt-1 px-1">
        {data.map((d, i) => (
          (i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) ? (
            <span key={i}>{new Date(d.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          ) : <span key={i} />
        ))}
      </div>
    </div>
  );
}

// --- Chart 6: Hourly distribution bars -------------------------------------

function HourlyBars({ data }: { data: any[] }) {
  const full = Array.from({ length: 24 }, (_, h) => {
    const found = data?.find((hd: any) => +hd.hour === h);
    return found ? +found.count : 0;
  });
  const max = Math.max(...full, 1);
  if (!data?.length) return <NoData small />;
  return (
    <div className="flex items-end gap-1 h-32">
      {full.map((c, h) => (
        <div key={h} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
          <div className="w-full bg-teal-500/80 rounded-t hover:bg-teal-600 transition-colors" style={{ height: `${(c / max) * 100}%` }} title={`${h}:00 — ${c}`} />
          <span className="text-[8px] text-slate-400 h-3">{h % 6 === 0 ? `${h}h` : ''}</span>
        </div>
      ))}
    </div>
  );
}

// --- Department resolution list --------------------------------------------

function DeptResolution({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  const maxMins = Math.max(...data.map((d: any) => +d.avg_minutes), 1);
  return (
    <div>
      {data.map((dept: any) => {
        const overTarget = +dept.avg_minutes > +dept.target_minutes;
        const pct = Math.round((+dept.avg_minutes / maxMins) * 100);
        return (
          <div key={dept.department} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="text-sm text-slate-700 flex-1 capitalize truncate">{prettify(dept.department)}</span>
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${overTarget ? 'bg-red-500' : 'bg-green-600'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-sm font-medium min-w-[45px] text-right ${overTarget ? 'text-red-500' : 'text-green-600'}`}>
              {dept.avg_minutes}m
            </span>
            <span className={`text-xs min-w-[40px] text-right ${overTarget ? 'text-red-400' : 'text-green-500'}`}>
              {overTarget ? '▲' : '▼'} {Math.abs(+dept.avg_minutes - +dept.target_minutes)}m
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- Top issues list -------------------------------------------------------

function TopIssues({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  const top = +data[0].count || 1;
  return (
    <div>
      {data.map((issue: any, i: number) => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
          <span className="text-sm text-slate-700 truncate flex-1 mr-2">{issue.description}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{issue.count}x</span>
            <div className="w-14 h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-600 rounded-full" style={{ width: `${Math.round((+issue.count / top) * 100)}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Staff performance list ------------------------------------------------

function StaffPerf({ data }: { data: any[] }) {
  if (!data?.length) return <NoData />;
  return (
    <div>
      {data.map((staff: any, i: number) => (
        <div key={`${staff.staff_name}-${i}`} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
          <div className="min-w-0">
            <p className="text-sm text-slate-700 truncate">{staff.staff_name}</p>
            <p className="text-xs text-slate-400 capitalize">{prettify(staff.department)}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-slate-400">{staff.avg_minutes}m avg</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              staff.resolved_count >= 10 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'
            }`}>
              {staff.resolved_count} resolved
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
