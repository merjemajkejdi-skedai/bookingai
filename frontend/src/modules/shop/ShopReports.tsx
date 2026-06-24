import { useState, useEffect } from 'react';
import { shopApi } from './api';

// ── Period selector ─────────────────────────────────────────────────────────────

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: '7d',    label: '7 days' },
  { value: '30d',   label: '30 days' },
  { value: 'ytd',   label: 'Year to date' },
];

// ── SVG chart primitives ────────────────────────────────────────────────────────

function BarChart({
  values, labels, colors, height = 100, showValues = false,
}: {
  values: number[]; labels?: string[]; colors?: string | string[]; height?: number; showValues?: boolean;
}) {
  const max = Math.max(...values, 1);
  const n = values.length;
  const barW = 80 / n;
  const gap  = 20 / Math.max(n - 1, 1);
  const getColor = (i: number) =>
    Array.isArray(colors) ? (colors[i] ?? '#0F6E56') : (colors ?? '#0F6E56');

  return (
    <svg viewBox={`0 0 100 ${height + (labels ? 16 : 4)}`} className="w-full">
      {values.map((v, i) => {
        const barH = Math.max((v / max) * (height - 4), v > 0 ? 2 : 0);
        const x = n === 1 ? 10 : i * (barW + (n > 1 ? (80 - barW * n) / (n - 1) : 0)) + (100 - barW * n - (n > 1 ? (80 - barW * n) : 0)) / 2;
        const xPos = (i / Math.max(n - 1, 1)) * (100 - barW) + barW / 2 - barW / 2;
        return (
          <g key={i}>
            <rect
              x={xPos}
              y={height - barH}
              width={barW * 0.8}
              height={barH}
              fill={getColor(i)}
              rx="1"
            />
            {showValues && v > 0 && (
              <text x={xPos + barW * 0.4} y={height - barH - 2} textAnchor="middle"
                fontSize="5" fill="#64748b">{v}</text>
            )}
            {labels && (
              <text x={xPos + barW * 0.4} y={height + 10} textAnchor="middle"
                fontSize="5" fill="#94a3b8">{labels[i]}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({
  values, labels, color = '#0F6E56', height = 100, fillColor,
}: {
  values: number[]; labels?: string[]; color?: string; height?: number; fillColor?: string;
}) {
  if (values.length < 2) return (
    <div className="flex items-center justify-center h-full text-slate-300 text-xs">Not enough data</div>
  );
  const max = Math.max(...values, 1);
  const min = 0;
  const n = values.length;
  const toX = (i: number) => (i / (n - 1)) * 96 + 2;
  const toY = (v: number) => height - 4 - ((v - min) / (max - min)) * (height - 8);
  const pts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const fillPts = `${toX(0)},${height} ${pts} ${toX(n - 1)},${height}`;

  return (
    <svg viewBox={`0 0 100 ${height + (labels ? 14 : 4)}`} className="w-full">
      {fillColor && <polygon points={fillPts} fill={fillColor} opacity="0.15" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r="1.5" fill={color} />
      ))}
      {labels && labels.map((l, i) => (
        i % Math.ceil(n / 6) === 0 || i === n - 1 ? (
          <text key={i} x={toX(i)} y={height + 10} textAnchor="middle" fontSize="4.5" fill="#94a3b8">{l}</text>
        ) : null
      ))}
    </svg>
  );
}

function DonutChart({
  values, colors, labels, size = 100,
}: {
  values: number[]; colors: string[]; labels?: string[]; size?: number;
}) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = 35;
  const cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = values.map((v, i) => {
    const pct = v / total;
    const dash = pct * circ;
    const arc = { pct, dash, offset, color: colors[i] };
    offset += dash;
    return arc;
  });

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      {arcs.map((a, i) => (
        <circle key={i} cx={cx} cy={cy} r={r}
          fill="none" stroke={a.color} strokeWidth="18"
          strokeDasharray={`${a.dash} ${circ - a.dash}`}
          strokeDashoffset={-a.offset + circ * 0.25}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }}
        />
      ))}
      <circle cx={cx} cy={cy} r="26" fill="white" />
    </svg>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────────

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 ${className}`}>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, valueClass = '' }: { label: string; value: string | number; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold text-slate-800 ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHART_COLORS = ['#0F6E56', '#185FA5', '#854F0B', '#7C3AED', '#DC2626', '#0891B2'];

function fmtDay(day: string) {
  return new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Main component ──────────────────────────────────────────────────────────────

export function ShopReports() {
  const [period, setPeriod] = useState('30d');
  const [summary, setSummary]     = useState<any>(null);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, b] = await Promise.all([
        shopApi.getReportsSummary(period),
        shopApi.getReportsBreakdown(period),
      ]);
      setSummary(s);
      setBreakdown(b);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [period]);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-red-500 text-sm">{error}</p>
    </div>
  );

  const noOrders = !summary || +summary.total_orders === 0;

  return (
    <div className="h-full overflow-y-auto space-y-4 pb-6">
      {/* Period selector */}
      <div className="flex gap-2 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              period === p.value
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {noOrders ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-2xl mb-2">📊</p>
          <p className="text-sm font-medium">No orders in this period</p>
          <p className="text-xs mt-1">Reports will appear once orders are placed</p>
        </div>
      ) : (
        <>
          {/* ── Overview metrics ────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricCard
              label="Confirmed orders"
              value={summary.confirmed_orders ?? 0}
              sub={`${summary.cancelled_orders ?? 0} cancelled`}
            />
            <MetricCard
              label="Total revenue"
              value={`${Math.round(+summary.total_revenue || 0).toLocaleString()} ALL`}
              sub={`avg ${Math.round(+summary.avg_order_value || 0).toLocaleString()} ALL/order`}
            />
            <MetricCard
              label="Avg readiness"
              value={summary.avg_minutes_to_done != null ? `${summary.avg_minutes_to_done} min` : '–'}
              sub={summary.min_minutes_to_done != null
                ? `${summary.min_minutes_to_done}–${summary.max_minutes_to_done} min range`
                : 'No completed orders'}
            />
            <MetricCard
              label="Unique customers"
              value={summary.unique_customers ?? 0}
              sub={`${summary.repeat_customers ?? 0} repeat`}
            />
            <MetricCard
              label="Cancellation rate"
              value={`${summary.cancellation_rate ?? 0}%`}
              sub={`${summary.cancelled_orders ?? 0} of ${summary.total_orders ?? 0} orders`}
              valueClass={(+summary.cancellation_rate || 0) > 15 ? 'text-red-500' : 'text-green-600'}
            />
            <MetricCard
              label="Repeat rate"
              value={+summary.unique_customers > 0
                ? `${Math.round((+summary.repeat_customers / +summary.unique_customers) * 100)}%`
                : '0%'}
              sub={`${summary.repeat_customers ?? 0} returning guests`}
              valueClass="text-green-600"
            />
          </div>

          {/* ── Row 1: orders/day + revenue/day ─────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Orders per day">
              {breakdown?.orders_per_day?.length > 0 ? (
                <BarChart
                  values={(breakdown.orders_per_day as any[]).map(d => +d.confirmed)}
                  labels={(breakdown.orders_per_day as any[]).map(d => fmtDay(d.day))}
                  showValues
                />
              ) : <Empty />}
            </Card>
            <Card title="Revenue per day (ALL)">
              {breakdown?.orders_per_day?.length > 0 ? (
                <LineChart
                  values={(breakdown.orders_per_day as any[]).map(d => +d.revenue)}
                  labels={(breakdown.orders_per_day as any[]).map(d => fmtDay(d.day))}
                  color="#0F6E56"
                  fillColor="#0F6E56"
                />
              ) : <Empty />}
            </Card>
          </div>

          {/* ── Row 2: day of week + peak hours ─────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Orders by day of week">
              {breakdown?.orders_by_dow?.length > 0 ? (
                <BarChart
                  values={Array.from({ length: 7 }, (_, i) => {
                    const found = (breakdown.orders_by_dow as any[]).find(d => +d.day_of_week === i);
                    return +(found?.orders || 0);
                  })}
                  labels={DOW_LABELS}
                  colors="#185FA5"
                  showValues
                />
              ) : <Empty />}
            </Card>
            <Card title="Peak ordering hours">
              {breakdown?.orders_by_hour?.length > 0 ? (
                <BarChart
                  values={Array.from({ length: 24 }, (_, h) => {
                    const found = (breakdown.orders_by_hour as any[]).find(d => +d.hour === h);
                    return +(found?.orders || 0);
                  })}
                  labels={Array.from({ length: 24 }, (_, h) => h % 6 === 0 ? `${h}h` : '')}
                  colors={Array.from({ length: 24 }, (_, h) => {
                    const found = (breakdown.orders_by_hour as any[]).find(d => +d.hour === h);
                    const v = +(found?.orders || 0);
                    const max = Math.max(...(breakdown.orders_by_hour as any[]).map((d: any) => +d.orders), 1);
                    const pct = v / max;
                    return pct > 0.7 ? '#0F6E56' : pct > 0.3 ? '#5BA88F' : '#CBD5E1';
                  })}
                />
              ) : <Empty />}
            </Card>
          </div>

          {/* ── Row 3: category donut + top items ───────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Revenue by category">
              {breakdown?.revenue_by_category?.length > 0 ? (
                <div className="flex items-center gap-4">
                  <DonutChart
                    values={(breakdown.revenue_by_category as any[]).map(c => +c.revenue)}
                    colors={CHART_COLORS}
                    size={90}
                  />
                  <div className="flex-1 space-y-1.5">
                    {(breakdown.revenue_by_category as any[]).slice(0, 5).map((c: any, i: number) => (
                      <div key={c.category} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i] }} />
                        <span className="text-xs text-slate-600 flex-1 truncate">{c.category}</span>
                        <span className="text-xs font-medium text-slate-700">{Math.round(+c.revenue).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <Empty />}
            </Card>
            <Card title="Top items by revenue">
              {breakdown?.revenue_by_item?.length > 0 ? (
                <div className="space-y-2">
                  {(breakdown.revenue_by_item as any[]).slice(0, 8).map((item: any) => {
                    const maxRev = +((breakdown.revenue_by_item as any[])[0]?.revenue || 1);
                    const pct = Math.round((+item.revenue / maxRev) * 100);
                    return (
                      <div key={item.item_name} className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-700 truncate flex-1 mr-2">{item.item_name}</span>
                          <span className="font-medium text-slate-700 shrink-0">{Math.round(+item.revenue).toLocaleString()} ALL</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty />}
            </Card>
          </div>

          {/* ── Row 4: speed trend + avg order value ────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Order readiness speed (minutes)">
              {breakdown?.speed_trend?.length > 0 ? (
                <LineChart
                  values={(breakdown.speed_trend as any[]).map(d => +d.avg_minutes)}
                  labels={(breakdown.speed_trend as any[]).map(d => fmtDay(d.day))}
                  color="#854F0B"
                  fillColor="#854F0B"
                />
              ) : <Empty text="No completed orders yet" />}
            </Card>
            <Card title="Avg order value trend (ALL)">
              {breakdown?.avg_order_trend?.length > 0 ? (
                <LineChart
                  values={(breakdown.avg_order_trend as any[]).map(d => +d.avg_value)}
                  labels={(breakdown.avg_order_trend as any[]).map(d => fmtDay(d.day))}
                  color="#185FA5"
                  fillColor="#185FA5"
                />
              ) : <Empty />}
            </Card>
          </div>

          {/* ── Row 5: stock depletion + new vs repeat ──────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Stock depletion today">
              {breakdown?.stock_depletion?.length > 0 ? (
                <div className="space-y-2">
                  {(breakdown.stock_depletion as any[]).map((item: any) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-xs text-slate-700 flex-1 truncate">{item.name}</span>
                      <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                        <div
                          className={`h-full rounded-full ${
                            +item.depletion_pct >= 90 ? 'bg-red-500' :
                            +item.depletion_pct >= 60 ? 'bg-amber-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(100, +item.depletion_pct || 0)}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 shrink-0 w-12 text-right">
                        {item.stock_used}/{item.stock_limit}
                      </span>
                      <span className={`text-xs font-medium shrink-0 w-8 text-right ${
                        +item.depletion_pct >= 90 ? 'text-red-500' : 'text-slate-400'
                      }`}>
                        {item.depletion_pct ?? 0}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : <Empty text="No daily-stock items configured" />}
            </Card>
            <Card title="New vs repeat customers">
              {(breakdown?.new_customers ?? 0) + (breakdown?.repeat_customers ?? 0) > 0 ? (
                <div className="flex items-center gap-4">
                  <DonutChart
                    values={[breakdown.new_customers || 0, breakdown.repeat_customers || 0]}
                    colors={['#185FA5', '#0F6E56']}
                    size={90}
                  />
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#185FA5] shrink-0" />
                      <div>
                        <p className="text-xs text-slate-500">New customers</p>
                        <p className="text-lg font-bold text-slate-800">{breakdown.new_customers ?? 0}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#0F6E56] shrink-0" />
                      <div>
                        <p className="text-xs text-slate-500">Repeat customers</p>
                        <p className="text-lg font-bold text-slate-800">{breakdown.repeat_customers ?? 0}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : <Empty />}
            </Card>
          </div>

          {/* ── Row 6: cancelled items + cancellation rate ───── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Most cancelled items">
              {breakdown?.cancelled_items?.length > 0 ? (
                <div className="space-y-0.5">
                  {(breakdown.cancelled_items as any[]).slice(0, 5).map((item: any) => (
                    <div key={item.item_name} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                      <span className="text-sm text-slate-700">{item.item_name}</span>
                      <span className="text-sm font-medium text-red-500">{item.cancelled_count}×</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">No cancellations 🎉</p>
              )}
            </Card>
            <Card title="Cancellation rate">
              <div className="flex flex-col items-center justify-center py-2">
                <div className="relative">
                  <svg viewBox="0 0 100 60" className="w-40">
                    {/* Background arc */}
                    <path d="M 10 55 A 40 40 0 0 1 90 55" fill="none" stroke="#F1F5F9" strokeWidth="10" strokeLinecap="round" />
                    {/* Value arc */}
                    <path
                      d="M 10 55 A 40 40 0 0 1 90 55"
                      fill="none"
                      stroke={(+summary.cancellation_rate || 0) > 15 ? '#EF4444' : '#0F6E56'}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={`${(+summary.cancellation_rate || 0) * 1.257} 125.7`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
                    <span className={`text-2xl font-bold ${(+summary.cancellation_rate || 0) > 15 ? 'text-red-500' : 'text-green-600'}`}>
                      {summary.cancellation_rate ?? 0}%
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {summary.cancelled_orders ?? 0} cancelled of {summary.total_orders ?? 0} total
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ text = 'No data for this period' }: { text?: string }) {
  return <p className="text-xs text-slate-400 text-center py-4">{text}</p>;
}
