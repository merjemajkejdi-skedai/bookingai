import { useState, useEffect, useCallback, type ElementType } from 'react';
import { TrendingUp, TrendingDown, MessageSquare, DollarSign, BarChart2, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { analyticsApi } from '../shared/lib/auth';
import { Spinner } from '../components/ui';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULTS = {
  twilioInbound:    0.005,
  twilioOutbound:   0.005,
  metaInbound:      0.002,
  metaOutbound:     0.003,
  claudePerMessage: 0.008,
};

const PLAN_REVENUE: Record<string, number> = {
  starter: 29,
  growth:  79,
  pro:     149,
};

const TYPE_COLORS: Record<string, string> = {
  barbershop: 'bg-blue-100 text-blue-700',
  hotel:      'bg-purple-100 text-purple-700',
  restaurant: 'bg-orange-100 text-orange-700',
  art_class:  'bg-pink-100 text-pink-700',
  art_event:  'bg-rose-100 text-rose-700',
  salon:      'bg-teal-100 text-teal-700',
  skedai:     'bg-violet-100 text-violet-700',
  dentist:    'bg-cyan-100 text-cyan-700',
  medical:    'bg-green-100 text-green-700',
};

const PERIODS = [
  { label: 'Today',    value: '1d'  },
  { label: '7 days',   value: '7d'  },
  { label: '30 days',  value: '30d' },
  { label: 'All time', value: 'all' },
];

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------
interface Params { twilioInbound: number; twilioOutbound: number; metaInbound: number; metaOutbound: number; claudePerMessage: number; }

function calcCosts(row: any, p: Params) {
  const twilioCost  = (Number(row.twilio_in)  || 0) * p.twilioInbound
                    + (Number(row.twilio_out) || 0) * p.twilioOutbound;
  const metaCost    = (Number(row.meta_in)    || 0) * p.metaInbound
                    + (Number(row.meta_out)   || 0) * p.metaOutbound;
  const claudeCost  = (Number(row.total)      || 0) * p.claudePerMessage;
  const totalCost   = twilioCost + metaCost + claudeCost;
  return { twilioCost, metaCost, claudeCost, totalCost };
}

function revenue(plan: string): number {
  return PLAN_REVENUE[plan] ?? 0;
}

function margin(rev: number, cost: number): number {
  if (rev === 0) return cost === 0 ? 100 : -Infinity;
  return ((rev - cost) / rev) * 100;
}

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------
function PriceSlider({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-44 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-brand-500 h-1.5"
      />
      <span className="text-xs font-mono text-slate-700 w-16 text-right">
        ${value.toFixed(4)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------
function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string;
  icon: ElementType; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex items-start gap-4">
      <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-0.5">{label}</p>
        <p className="text-xl font-semibold text-slate-800">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function CostAnalyticsPage() {
  const [period,    setPeriod]    = useState('7d');
  const [summary,   setSummary]   = useState<any>(null);
  const [messages,  setMessages]  = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  // Cost-slider state
  const [params, setParams]       = useState<Params>(DEFAULTS);
  const [sliders, setSliders]     = useState(false);

  // Type filter
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Sort state
  const [sortCol, setSortCol]   = useState<string>('total');
  const [sortDir, setSortDir]   = useState<1 | -1>(-1); // -1 = desc

  // Projection simulator
  const [projShops,   setProjShops]   = useState(10);
  const [projMsgs,    setProjMsgs]    = useState(200);
  const [projPlan,    setProjPlan]    = useState<'starter' | 'growth' | 'pro'>('growth');

  // ── Load data ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [sumData, msgData] = await Promise.all([
        analyticsApi.getSummary(period),
        analyticsApi.getMessages(period),
      ]);
      setSummary(sumData);
      setMessages(msgData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // ── Derived aggregates ───────────────────────────────────────────────────
  const totalTwilioCost  = messages.reduce((acc, r) => acc + calcCosts(r, params).twilioCost,  0);
  const totalMetaCost    = messages.reduce((acc, r) => acc + calcCosts(r, params).metaCost,    0);
  const totalClaudeCost  = messages.reduce((acc, r) => acc + calcCosts(r, params).claudeCost,  0);
  const totalCost        = totalTwilioCost + totalMetaCost + totalClaudeCost;
  const totalRevenue     = messages.reduce((acc, r) => acc + revenue(r.plan), 0);
  const netMargin        = margin(totalRevenue, totalCost);

  // ── Filter + sort ────────────────────────────────────────────────────────
  const allTypes = [...new Set(messages.map(r => r.tenant_type).filter(Boolean))].sort();

  const filtered = messages
    .filter(r => typeFilter === 'all' || r.tenant_type === typeFilter)
    .map(r => {
      const costs = calcCosts(r, params);
      const rev   = revenue(r.plan);
      return { ...r, ...costs, revenue: rev, margin: margin(rev, costs.totalCost) };
    })
    .sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      if (typeof av === 'string') return sortDir * av.localeCompare(bv);
      return sortDir * (Number(av) - Number(bv));
    });

  function toggleSort(col: string) {
    if (sortCol === col) { setSortDir(d => d === 1 ? -1 : 1); }
    else { setSortCol(col); setSortDir(-1); }
  }

  // ── Projection ───────────────────────────────────────────────────────────
  const projInbound  = projMsgs * 0.45; // ~45% of traffic is inbound
  const projOutbound = projMsgs * 0.55;
  const projCostPerShop  = projInbound * params.twilioInbound + projOutbound * params.twilioOutbound
                         + projMsgs * params.claudePerMessage;
  const projTotalCost    = projCostPerShop * projShops;
  const projTotalRev     = PLAN_REVENUE[projPlan] * projShops;
  const projNetMargin    = margin(projTotalRev, projTotalCost);

  // ── Sort header helper ──────────────────────────────────────────────────
  function SortTh({ col, label, align = 'right' }: { col: string; label: string; align?: string }) {
    const active = sortCol === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className={clsx(
          'px-3 py-2 text-xs font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap',
          `text-${align}`,
          active && 'text-brand-600',
        )}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active
            ? (sortDir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />)
            : <ArrowUpDown size={11} className="opacity-30" />
          }
        </span>
      </th>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;

  if (error) return (
    <div className="p-6 text-sm text-red-500 bg-red-50 rounded-xl border border-red-100 m-6">
      Failed to load analytics: {error}
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header + period tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <BarChart2 size={18} className="text-brand-500" /> Cost Analytics
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Platform-wide message costs and margin per tenant
          </p>
        </div>
        <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={clsx(
                'px-4 py-2 text-sm font-medium transition-colors',
                period === p.value
                  ? 'bg-brand-500 text-white'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Total messages"
          value={Number(summary?.total_messages ?? 0).toLocaleString()}
          sub={`${Number(summary?.total_inbound ?? 0).toLocaleString()} in · ${Number(summary?.total_outbound ?? 0).toLocaleString()} out`}
          icon={MessageSquare}
          color="bg-blue-50 text-blue-500"
        />
        <MetricCard
          label="Twilio cost"
          value={`$${totalTwilioCost.toFixed(2)}`}
          sub={`Twilio msgs: ${Number(summary?.twilio_count ?? 0).toLocaleString()}`}
          icon={DollarSign}
          color="bg-orange-50 text-orange-500"
        />
        <MetricCard
          label="Claude cost"
          value={`$${totalClaudeCost.toFixed(2)}`}
          sub={`$${params.claudePerMessage.toFixed(4)}/msg`}
          icon={DollarSign}
          color="bg-violet-50 text-violet-500"
        />
        <MetricCard
          label="Net margin"
          value={isFinite(netMargin) ? `${netMargin.toFixed(1)}%` : '—'}
          sub={`Rev $${totalRevenue} · Cost $${totalCost.toFixed(2)}`}
          icon={netMargin >= 0 ? TrendingUp : TrendingDown}
          color={netMargin >= 50 ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'}
        />
      </div>

      {/* Cost sliders */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setSliders(s => !s)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <DollarSign size={14} className="text-slate-400" />
            Adjust pricing assumptions
          </span>
          {sliders ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </button>

        {sliders && (
          <div className="px-5 pb-5 pt-2 space-y-3 border-t border-slate-100">
            <PriceSlider label="Twilio inbound ($/msg)"   value={params.twilioInbound}    min={0.001} max={0.02} step={0.001} onChange={v => setParams(p => ({ ...p, twilioInbound: v }))}  />
            <PriceSlider label="Twilio outbound ($/msg)"  value={params.twilioOutbound}   min={0.001} max={0.02} step={0.001} onChange={v => setParams(p => ({ ...p, twilioOutbound: v }))} />
            <PriceSlider label="Meta inbound ($/msg)"     value={params.metaInbound}      min={0.001} max={0.01} step={0.001} onChange={v => setParams(p => ({ ...p, metaInbound: v }))}    />
            <PriceSlider label="Meta outbound ($/msg)"    value={params.metaOutbound}     min={0.001} max={0.01} step={0.001} onChange={v => setParams(p => ({ ...p, metaOutbound: v }))}   />
            <PriceSlider label="Claude per message ($/msg)" value={params.claudePerMessage} min={0.001} max={0.05} step={0.001} onChange={v => setParams(p => ({ ...p, claudePerMessage: v }))} />
            <button
              onClick={() => setParams(DEFAULTS)}
              className="text-xs text-brand-500 hover:underline mt-1"
            >
              Reset to defaults
            </button>
          </div>
        )}
      </div>

      {/* Type filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setTypeFilter('all')}
          className={clsx(
            'px-3 py-1 rounded-full text-xs font-medium transition-colors',
            typeFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          All types
        </button>
        {allTypes.map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={clsx(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize',
              typeFilter === t ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {String(t).replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Tenant table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <SortTh col="tenant_name" label="Shop"     align="left" />
                <th className="px-3 py-2 text-xs font-medium text-slate-500 text-left">Type / Plan</th>
                <SortTh col="total"       label="Messages" />
                <SortTh col="twilioCost"  label="Twilio $" />
                <SortTh col="claudeCost"  label="Claude $" />
                <SortTh col="totalCost"   label="Total cost" />
                <SortTh col="revenue"     label="Revenue" />
                <SortTh col="margin"      label="Margin" />
                <th className="px-3 py-2 text-xs font-medium text-slate-500 text-right">Cost / Rev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-sm text-slate-400">
                    No data for this period
                  </td>
                </tr>
              )}
              {filtered.map(r => {
                const costRevRatio = r.revenue > 0 ? r.totalCost / r.revenue : 0;
                const barWidth     = Math.min(costRevRatio * 100, 100);
                const barDanger    = costRevRatio > 0.7;

                return (
                  <tr key={r.tenant_id} className={clsx(
                    'hover:bg-slate-50 transition-colors',
                    !r.is_active && 'opacity-50',
                  )}>
                    <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">
                      {r.tenant_name}
                    </td>
                    <td className="px-3 py-3">
                      <span className={clsx(
                        'inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                        TYPE_COLORS[r.tenant_type] ?? 'bg-slate-100 text-slate-600',
                      )}>
                        {String(r.tenant_type).replace('_', ' ')}
                      </span>
                      <span className="ml-1.5 text-xs text-slate-400 capitalize">{r.plan}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {Number(r.total).toLocaleString()}
                      <span className="text-xs text-slate-400 ml-1">
                        ({Number(r.inbound)}↓ {Number(r.outbound)}↑)
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                      ${r.twilioCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                      ${r.claudeCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">
                      ${r.totalCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                      ${r.revenue}
                    </td>
                    <td className={clsx(
                      'px-3 py-3 text-right tabular-nums font-medium',
                      isFinite(r.margin) && r.margin >= 60 ? 'text-green-600' :
                      isFinite(r.margin) && r.margin >= 30 ? 'text-amber-600' : 'text-red-500',
                    )}>
                      {isFinite(r.margin) ? `${r.margin.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-3 w-24">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={clsx('h-full rounded-full transition-all', barDanger ? 'bg-red-400' : 'bg-green-400')}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className={clsx('text-xs w-8 text-right', barDanger ? 'text-red-500' : 'text-slate-400')}>
                          {r.revenue > 0 ? `${(costRevRatio * 100).toFixed(0)}%` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-xs font-semibold text-slate-600">
                    Total ({filtered.length} shops)
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    {filtered.reduce((s, r) => s + Number(r.total), 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.twilioCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.claudeCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.totalCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.revenue, 0)}
                  </td>
                  <td colSpan={2} className="px-3 py-3 text-right text-xs font-semibold">
                    {(() => {
                      const rev  = filtered.reduce((s, r) => s + r.revenue, 0);
                      const cost = filtered.reduce((s, r) => s + r.totalCost, 0);
                      const m    = margin(rev, cost);
                      return isFinite(m) ? `${m.toFixed(1)}%` : '—';
                    })()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Projection simulator */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <TrendingUp size={15} className="text-brand-500" />
          Projection Simulator
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Number of shops</span>
              <span className="text-xs font-semibold text-slate-800">{projShops}</span>
            </div>
            <input
              type="range" min={1} max={200} step={1} value={projShops}
              onChange={e => setProjShops(Number(e.target.value))}
              className="w-full accent-brand-500 h-1.5"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Messages / shop / month</span>
              <span className="text-xs font-semibold text-slate-800">{projMsgs}</span>
            </div>
            <input
              type="range" min={10} max={5000} step={10} value={projMsgs}
              onChange={e => setProjMsgs(Number(e.target.value))}
              className="w-full accent-brand-500 h-1.5"
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs text-slate-500 block">Plan</span>
            <div className="flex gap-2">
              {(['starter', 'growth', 'pro'] as const).map(pl => (
                <button
                  key={pl}
                  onClick={() => setProjPlan(pl)}
                  className={clsx(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors border',
                    projPlan === pl
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {pl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Projection result cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          {[
            { label: 'Monthly revenue', value: `$${projTotalRev.toLocaleString()}` },
            { label: 'Monthly cost',    value: `$${projTotalCost.toFixed(2)}` },
            { label: 'Net income',      value: `$${(projTotalRev - projTotalCost).toFixed(2)}` },
            { label: 'Margin',          value: isFinite(projNetMargin) ? `${projNetMargin.toFixed(1)}%` : '—' },
          ].map(c => (
            <div key={c.label} className="bg-slate-50 rounded-lg px-4 py-3">
              <p className="text-xs text-slate-400">{c.label}</p>
              <p className="text-lg font-semibold text-slate-800 mt-0.5">{c.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
