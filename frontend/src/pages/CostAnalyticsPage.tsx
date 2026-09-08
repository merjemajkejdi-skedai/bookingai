import { useState, useEffect, useCallback, type ElementType } from 'react';
import { TrendingUp, TrendingDown, MessageSquare, DollarSign, BarChart2, ChevronDown, ChevronUp, ArrowUpDown, Info } from 'lucide-react';
import { analyticsApi, adminApi } from '../shared/lib/auth';
import { Spinner, Modal } from '../components/ui';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULTS = {
  twilioInbound:    0.005,
  twilioOutbound:   0.005,
  metaOutbound:     0.0077, // unconfirmed — Meta WABA business-initiated conversation rate
  claudePerMessage: 0.008,  // simulated only — NOT real Anthropic usage, out of scope for v2
};

// Meta bills WABA usage on outbound messages regardless of provider (Twilio or direct
// Cloud API) from this date onward. Unlike Twilio cost, this is NOT gated by
// environment — see Part 10 known limitations.
const META_SERVICE_MSG_CUTOVER = new Date('2026-10-01T00:00:00Z');

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
  shop:       'bg-lime-100 text-lime-700',
  general_business: 'bg-indigo-100 text-indigo-700',
};

const PERIODS = [
  { label: 'Today',    value: '1d'   },
  { label: '7 days',   value: '7d'   },
  { label: '30 days',  value: '30d'  },
  { label: 'Month',    value: 'month' },
  { label: 'All time', value: 'all'  },
];

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Twilio gating — Part 3
// A 'test' tenant never shows Twilio cost. A 'live' tenant's manual
// uses_twilio_flag override always wins when set; otherwise falls back to
// the provider field, exactly as WhatsApp routing actually works today.
// ---------------------------------------------------------------------------
function resolveTwilioFlag(row: any): boolean {
  return row.provider === 'twilio';
}
function shouldChargeTwilio(row: any): boolean {
  if (row.environment !== 'live') return false;
  if (row.uses_twilio_flag !== null && row.uses_twilio_flag !== undefined) return !!row.uses_twilio_flag;
  return resolveTwilioFlag(row);
}

// ---------------------------------------------------------------------------
// Cost calculation — Part 3/5/6
// ---------------------------------------------------------------------------
interface Params { twilioInbound: number; twilioOutbound: number; metaOutbound: number; claudePerMessage: number; }

function calcCosts(row: any, p: Params, metaBillable: boolean) {
  const chargeTwilio = shouldChargeTwilio(row);
  const twilioCost = chargeTwilio
    ? (Number(row.inbound) || 0) * p.twilioInbound + (Number(row.outbound) || 0) * p.twilioOutbound
    : 0;
  // Meta $ applies to ALL outbound messages regardless of provider (Meta bills WABA
  // usage whether routed through Twilio or direct Cloud API) — gated only by the
  // October 2026 cutover date, NOT by environment. See Part 10 known limitations.
  const metaCost = metaBillable ? (Number(row.outbound) || 0) * p.metaOutbound : 0;
  const claudeCost = (Number(row.total) || 0) * p.claudePerMessage;
  const totalVariableCost = twilioCost + metaCost + claudeCost;
  return { twilioCost, metaCost, claudeCost, totalVariableCost, chargeTwilio };
}

/** The configured price (monthly_price override, else the plan default) — independent
 *  of environment. Used for the editable Revenue cell so a price can still be set
 *  in advance while a tenant is in 'test', ready for whenever it goes 'live'. */
function configuredPrice(row: any): number {
  if (row.monthly_price !== null && row.monthly_price !== undefined && row.monthly_price !== '') {
    return Number(row.monthly_price);
  }
  return PLAN_REVENUE[row.plan] ?? 0;
}

/** Effective revenue used in every cost calculation. A 'test' tenant always counts
 *  as €0 revenue — matching the existing Twilio-cost/infra-allocation gating — even
 *  if a monthly_price has been pre-configured for it. */
function revenue(row: any): number {
  if (row.environment !== 'live') return 0;
  return configuredPrice(row);
}

function margin(rev: number, cost: number): number {
  if (rev === 0) return cost === 0 ? 100 : -Infinity;
  return ((rev - cost) / rev) * 100;
}

// ---------------------------------------------------------------------------
// Small shared inline-edit controls
// ---------------------------------------------------------------------------
function InlineNumber({ value, placeholder, prefix = '', onSave }: {
  value: number | null; placeholder: string; prefix?: string; onSave: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value !== null ? String(value) : '');

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value !== null ? String(value) : ''); setEditing(true); }}
        className={clsx('tabular-nums hover:underline decoration-dotted', value === null && 'text-slate-400 italic')}
        title="Click to edit"
      >
        {value !== null ? `${prefix}${Number(value).toLocaleString()}` : placeholder}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft === '' ? null : Number(draft)); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { setEditing(false); onSave(draft === '' ? null : Number(draft)); }
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-20 border border-brand-300 rounded px-1.5 py-0.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400/40"
    />
  );
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
// Commissionable History modal — Part 5
// ---------------------------------------------------------------------------
function monthLabel(periodMonth: string): string {
  const d = new Date(`${String(periodMonth).slice(0, 7)}-01T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function CommissionableHistoryModal({ tenant, onClose }: { tenant: { id: string; name: string }; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    adminApi.getCommissionableHistory(tenant.id)
      .then(setRows)
      .catch(e => setErr(e.message));
  }, [tenant.id]);

  return (
    <Modal title={`Commissionable History — ${tenant.name}`} onClose={onClose} wide>
      {err && <p className="text-sm text-red-500">{err}</p>}
      {!rows && !err && <Spinner />}
      {rows && rows.length === 0 && <p className="text-sm text-slate-400">No history recorded yet — a snapshot is created the first time a month is viewed.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                <th className="text-left py-2 pr-3">Month</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-right py-2 pr-3">Rate</th>
                <th className="text-left py-2 pr-3">Changed By</th>
                <th className="text-left py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="py-2 pr-3 font-medium text-slate-700">{monthLabel(row.period_month)}</td>
                  <td className="py-2 pr-3">
                    {row.is_commissionable === true || row.is_commissionable === 1
                      ? <span className="text-green-600">✅ Commissionable</span>
                      : <span className="text-red-500">❌ Not Commissionable</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                    {row.commission_rate !== null && row.commission_rate !== undefined ? `${Number(row.commission_rate)}%` : '—'}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{row.changed_by || '—'}</td>
                  <td className="py-2 text-slate-500 italic">{row.reason ? `"${row.reason}"` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
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
  const [month,     setMonth]     = useState(currentMonthStr());
  const [summary,   setSummary]   = useState<any>(null);
  const [messages,  setMessages]  = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  // Cost-slider state
  const [params, setParams]       = useState<Params>(DEFAULTS);
  const [sliders, setSliders]     = useState(false);
  const [showLimitations, setShowLimitations] = useState(false);

  // Type filter
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Sort state
  const [sortCol, setSortCol]   = useState<string>('total');
  const [sortDir, setSortDir]   = useState<1 | -1>(-1); // -1 = desc

  // Infra cost (Part 6)
  const [infraCost, setInfraCost]   = useState<{ amount: number; notes: string | null } | null>(null);
  const [infraInput, setInfraInput] = useState('');
  const [infraSaving, setInfraSaving] = useState(false);

  // Commissionable flag — confirm modal + history modal
  const [confirmToggle, setConfirmToggle] = useState<{ tenantId: string; tenantName: string; newStatus: boolean } | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [historyTenant, setHistoryTenant] = useState<{ id: string; name: string } | null>(null);

  // Projection simulator (Part 9)
  const [projHotels,    setProjHotels]    = useState(10);
  const [projPrice,     setProjPrice]     = useState(79);
  const [projClaude,    setProjClaude]    = useState(0);
  const [projWhatsapp,  setProjWhatsapp]  = useState(0);
  const [projInfra,     setProjInfra]     = useState(0);
  const [projCommission, setProjCommission] = useState(50);

  // ── Load data ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const monthParam = period === 'month' ? month : undefined;
      const [sumData, msgData, infraData] = await Promise.all([
        analyticsApi.getSummary(period, monthParam),
        analyticsApi.getMessages(period, monthParam),
        analyticsApi.getInfraCost(period === 'month' ? month : currentMonthStr()),
      ]);
      setSummary(sumData);
      setMessages(msgData);
      setInfraCost(infraData);
      setInfraInput(String(infraData.amount ?? 0));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period, month]);

  useEffect(() => { load(); }, [load]);

  // Seed projection defaults once on mount
  useEffect(() => {
    analyticsApi.getProjectionDefaults().then(d => {
      setProjPrice(d.avgPrice || 79);
      setProjClaude(d.avgClaudeCost || 0);
      setProjWhatsapp(d.avgWhatsappCost || 0);
      setProjInfra(d.currentInfraCost || 0);
      setProjCommission(d.currentCommissionRate || 50);
    }).catch(e => console.error('Failed to load projection defaults:', e.message));
  }, []);

  async function saveInfraCost() {
    const amount = Number(infraInput);
    if (!Number.isFinite(amount) || amount < 0) return;
    setInfraSaving(true);
    try {
      const monthParam = period === 'month' ? month : currentMonthStr();
      const saved = await analyticsApi.setInfraCost(monthParam, amount);
      setInfraCost(saved);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setInfraSaving(false);
    }
  }

  async function patchTenant(tenantId: string, data: Record<string, any>) {
    try {
      await adminApi.updateTenant(tenantId, data);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function confirmCommissionableToggle() {
    if (!confirmToggle) return;
    setConfirmSaving(true);
    try {
      await adminApi.setCommissionable(confirmToggle.tenantId, confirmToggle.newStatus, confirmReason || undefined);
      setConfirmToggle(null);
      setConfirmReason('');
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setConfirmSaving(false);
    }
  }

  // ── Meta billing cutover (Part 3) ──────────────────────────────────────
  // Month mode: compare the selected calendar month to the cutover.
  // Relative periods (1d/7d/30d/all): these are rolling windows ending "now",
  // so gate on today's date instead.
  const metaBillable = period === 'month'
    ? new Date(`${month}-01T00:00:00Z`) >= META_SERVICE_MSG_CUTOVER
    : new Date() >= META_SERVICE_MSG_CUTOVER;

  // ── Infra allocation (Part 6) — split evenly across 'live' tenants only ──
  const liveTenantCount = messages.filter(r => r.environment === 'live').length;
  const infraAmount = infraCost?.amount ?? 0;
  const infraCostPerTenant = liveTenantCount > 0 ? infraAmount / liveTenantCount : 0;

  // ── Derived aggregates ───────────────────────────────────────────────────
  const totalTwilioCost = messages.reduce((acc, r) => acc + calcCosts(r, params, metaBillable).twilioCost, 0);
  const totalMetaCost   = messages.reduce((acc, r) => acc + calcCosts(r, params, metaBillable).metaCost,   0);
  const totalClaudeCost = messages.reduce((acc, r) => acc + calcCosts(r, params, metaBillable).claudeCost, 0);
  const totalVariableCost = totalTwilioCost + totalMetaCost + totalClaudeCost;
  const totalRevenue    = messages.reduce((acc, r) => acc + revenue(r), 0);
  const netMargin        = margin(totalRevenue, totalVariableCost);

  // ── Filter + sort ────────────────────────────────────────────────────────
  const allTypes = [...new Set(messages.map(r => r.tenant_type).filter(Boolean))].sort();

  // A past month uses its locked commissionable_status_log snapshot instead of the
  // tenant's current live settings — this is what makes history immune to later
  // toggles (see the Commissionable Flag addendum, Part 4).
  const isPastMonth = period === 'month' && month < currentMonthStr();

  const filtered = messages
    .filter(r => typeFilter === 'all' || r.tenant_type === typeFilter)
    .map(r => {
      const costs = calcCosts(r, params, metaBillable);
      const rev   = revenue(r);
      const infraAllocation = r.environment === 'live' ? infraCostPerTenant : 0;
      // A 'test' tenant is never commissionable, regardless of its own flag/history —
      // matches revenue() being forced to €0 while in test.
      const rawCommissionable = period === 'month'
        ? (r.snapshot_is_commissionable !== undefined ? !!r.snapshot_is_commissionable : !!r.is_commissionable)
        : !!r.is_commissionable;
      const commissionable = r.environment === 'live' && rawCommissionable;
      const commissionRate = period === 'month' && r.snapshot_commission_rate !== undefined && r.snapshot_commission_rate !== null
        ? Number(r.snapshot_commission_rate)
        : (Number(r.commission_rate) || 50);
      const netBeforeCommission = Math.max(0, rev - costs.totalVariableCost - infraAllocation);
      const commission = commissionable ? netBeforeCommission * (commissionRate / 100) : 0;
      const netAfterCommission = rev - costs.totalVariableCost - infraAllocation - commission;
      return {
        ...r, ...costs, revenue: rev, margin: margin(rev, costs.totalVariableCost),
        infraAllocation, commissionable, rawCommissionable, commissionRate, commission, netAfterCommission,
      };
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

  // ── Projection (Part 9) — includes infra in the commission formula ──────
  const projTotalRevenue   = projHotels * projPrice;
  const projTotalVariable  = projHotels * (projClaude + projWhatsapp);
  const projTotalInfra     = projInfra; // flat platform-wide cost, not per-hotel
  const projNetBeforeComm  = Math.max(0, projTotalRevenue - projTotalVariable - projTotalInfra);
  const projTotalCommission = projNetBeforeComm * (projCommission / 100);
  const projTrueNetProfit  = projTotalCommission;
  const projProfitPerHotel = projHotels > 0 ? projTrueNetProfit / projHotels : 0;

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
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header + period tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <BarChart2 size={18} className="text-brand-500" /> Cost Analytics
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Platform-wide message costs, commission, and margin per tenant
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          {period === 'month' && (
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40"
            />
          )}
        </div>
      </div>

      {/* Known limitations (Part 10) */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowLimitations(s => !s)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-amber-800 hover:bg-amber-100/50 transition-colors"
        >
          <span className="flex items-center gap-2"><Info size={13} /> Known limitations — read before trusting these numbers</span>
          {showLimitations ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showLimitations && (
          <ul className="px-4 pb-3 pt-1 text-xs text-amber-700 space-y-1 list-disc list-inside border-t border-amber-200">
            <li>Claude $ is a simulated estimate (messages × slider rate) — not real Anthropic token usage.</li>
            <li>Instagram, Messenger, and Email messages are not logged anywhere long-term — this page only reflects WhatsApp volume and WhatsApp-attributable cost.</li>
            <li>Revenue is a flat monthly figure — no proration for partial months.</li>
            <li>Claude $ and Meta $ are NOT gated by environment — only Twilio cost, revenue, infra allocation, and commissionable status are. A 'test' tenant will still show non-zero Claude/Meta cost figures even though Revenue, Twilio $, Infra, and Commission all read €0/N/A.</li>
            <li>A 'test' tenant always counts as €0 revenue and is never commissionable, regardless of its monthly_price or Commissionable flag — those settings still save normally, ready for when it's switched to 'live'.</li>
            <li><strong>Action needed:</strong> new tenants default to environment = 'test'. Switch real paying customers (e.g. La Favorita, Bloom Matcha) to 'live' below, or their Revenue, Twilio cost, infra allocation, and commission will all read as zero/N/A.</li>
          </ul>
        )}
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
          label="Twilio + Meta cost"
          value={`$${(totalTwilioCost + totalMetaCost).toFixed(2)}`}
          sub={metaBillable ? 'Meta billing active' : 'Meta billing starts Oct 2026'}
          icon={DollarSign}
          color="bg-orange-50 text-orange-500"
        />
        <MetricCard
          label="Claude cost"
          value={`$${totalClaudeCost.toFixed(2)}`}
          sub={`$${params.claudePerMessage.toFixed(4)}/msg (simulated)`}
          icon={DollarSign}
          color="bg-violet-50 text-violet-500"
        />
        <MetricCard
          label="Net margin"
          value={isFinite(netMargin) ? `${netMargin.toFixed(1)}%` : '—'}
          sub={`Rev $${totalRevenue.toFixed(0)} · Cost $${totalVariableCost.toFixed(2)}`}
          icon={netMargin >= 0 ? TrendingUp : TrendingDown}
          color={netMargin >= 50 ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'}
        />
      </div>

      {/* Infra cost input — Part 6 */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
        <p className="text-sm font-medium text-slate-700 mb-2">
          General &amp; Infrastructure Costs — {period === 'month' ? month : currentMonthStr()}
        </p>
        <p className="text-xs text-slate-400 mb-3">Railway, R2, Resend, domains, etc. — split evenly across live tenants for the commission formula.</p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-slate-400">€</span>
            <input
              type="number" min={0} step="0.01" value={infraInput}
              onChange={e => setInfraInput(e.target.value)}
              className="w-28 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
            />
          </div>
          <button
            onClick={saveInfraCost}
            disabled={infraSaving}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40"
          >
            {infraSaving ? 'Saving…' : 'Save'}
          </button>
          <span className="text-xs text-slate-500">
            Split across {liveTenantCount} live tenant{liveTenantCount === 1 ? '' : 's'}:
            {' '}<strong>€{infraCostPerTenant.toFixed(2)}/tenant</strong>
            {liveTenantCount === 0 && <span className="text-amber-600"> (no live tenants yet — allocation is €0 for everyone)</span>}
          </span>
        </div>
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
            <PriceSlider label="Meta outbound ($/msg)"    value={params.metaOutbound}     min={0.001} max={0.02} step={0.0001} onChange={v => setParams(p => ({ ...p, metaOutbound: v }))}  />
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
                <th className="px-3 py-2 text-xs font-medium text-slate-500 text-left">Environment</th>
                <th className="px-3 py-2 text-xs font-medium text-slate-500 text-left">Commissionable</th>
                <SortTh col="total"       label="Messages" />
                <th className="px-3 py-2 text-xs font-medium text-slate-500 text-right">Twilio $</th>
                <SortTh col="metaCost"    label="Meta $" />
                <SortTh col="claudeCost"  label="Claude $" />
                <SortTh col="totalVariableCost" label="Total cost" />
                <SortTh col="revenue"     label="Revenue" />
                <SortTh col="margin"      label="Margin" />
                <SortTh col="infraAllocation" label="Infra" />
                <SortTh col="commission"  label="Commission $" />
                <SortTh col="netAfterCommission" label="Net After Comm." />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="text-center py-10 text-sm text-slate-400">
                    No data for this period
                  </td>
                </tr>
              )}
              {filtered.map(r => (
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
                  <td className="px-3 py-3">
                    <select
                      value={r.environment || 'test'}
                      onChange={e => patchTenant(r.tenant_id, { environment: e.target.value })}
                      className={clsx(
                        'text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer',
                        r.environment === 'live' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    {isPastMonth ? (
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {r.commissionable ? '✅ Yes' : '❌ No'} <span title="Past months are locked">🔒</span>
                      </span>
                    ) : (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={r.rawCommissionable}
                          onChange={() => setConfirmToggle({ tenantId: r.tenant_id, tenantName: r.tenant_name, newStatus: !r.rawCommissionable })}
                        />
                        {r.rawCommissionable ? 'Yes' : 'No'}
                        {r.rawCommissionable && r.environment !== 'live' && (
                          <span className="text-slate-400" title="Test tenants are never commissionable, regardless of this flag">(test)</span>
                        )}
                      </label>
                    )}
                    <button
                      onClick={() => setHistoryTenant({ id: r.tenant_id, name: r.tenant_name })}
                      className="block text-[10px] text-brand-500 hover:underline mt-0.5"
                    >
                      History
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {Number(r.total).toLocaleString()}
                    <span className="text-xs text-slate-400 ml-1">
                      ({Number(r.inbound)}↓ {Number(r.outbound)}↑)
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>${r.twilioCost.toFixed(2)}</span>
                      <select
                        value={
                          r.uses_twilio_flag === true || r.uses_twilio_flag === 1 ? 'yes' :
                          r.uses_twilio_flag === false || r.uses_twilio_flag === 0 ? 'no' : 'auto'
                        }
                        onChange={e => {
                          const v = e.target.value;
                          patchTenant(r.tenant_id, { usesTwilioFlag: v === 'auto' ? null : v === 'yes' });
                        }}
                        className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-500"
                        title={`Auto currently resolves to: ${resolveTwilioFlag(r) ? 'Yes' : 'No'} (via provider field: ${r.provider || 'unknown'})`}
                      >
                        <option value="auto">Auto ({resolveTwilioFlag(r) ? 'Yes' : 'No'} via provider)</option>
                        <option value="yes">Force Yes</option>
                        <option value="no">Force No</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    ${r.metaCost.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    ${r.claudeCost.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-800">
                    ${r.totalVariableCost.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <InlineNumber
                        value={r.monthly_price !== null && r.monthly_price !== undefined && r.monthly_price !== '' ? Number(r.monthly_price) : null}
                        placeholder={`$${PLAN_REVENUE[r.plan] ?? 0} (plan)`}
                        prefix="$"
                        onSave={v => patchTenant(r.tenant_id, { monthlyPrice: v })}
                      />
                      {r.environment !== 'live' && (
                        <span className="text-[10px] text-slate-400" title="Test tenants always count as €0 revenue, whatever price is set here">counted as $0 (test)</span>
                      )}
                    </div>
                  </td>
                  <td className={clsx(
                    'px-3 py-3 text-right tabular-nums font-medium',
                    isFinite(r.margin) && r.margin >= 60 ? 'text-green-600' :
                    isFinite(r.margin) && r.margin >= 30 ? 'text-amber-600' : 'text-red-500',
                  )}>
                    {isFinite(r.margin) ? `${r.margin.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    ${r.infraAllocation.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    {r.commissionable ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span>${r.commission.toFixed(2)}</span>
                        <InlineNumber
                          value={r.commissionRate}
                          placeholder="50"
                          onSave={v => patchTenant(r.tenant_id, { commissionRate: v ?? 50 })}
                        />
                        <span className="text-[10px] text-slate-400">%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic" title="Not commissionable">N/A</span>
                    )}
                  </td>
                  <td className={clsx(
                    'px-3 py-3 text-right tabular-nums font-semibold',
                    r.netAfterCommission >= 0 ? 'text-slate-800' : 'text-red-500',
                  )}>
                    ${r.netAfterCommission.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-xs font-semibold text-slate-600">
                    Total ({filtered.length} shops)
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    {filtered.reduce((s, r) => s + Number(r.total), 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.twilioCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.metaCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.claudeCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.totalVariableCost, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.revenue, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold">
                    {(() => {
                      const rev  = filtered.reduce((s, r) => s + r.revenue, 0);
                      const cost = filtered.reduce((s, r) => s + r.totalVariableCost, 0);
                      const m    = margin(rev, cost);
                      return isFinite(m) ? `${m.toFixed(1)}%` : '—';
                    })()}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.infraAllocation, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.commission, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">
                    ${filtered.reduce((s, r) => s + r.netAfterCommission, 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Scaling Projection tool — Part 9 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <TrendingUp size={15} className="text-brand-500" />
          Scaling Projection
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Number of hotels
            <input type="number" min={1} value={projHotels} onChange={e => setProjHotels(Math.max(1, Number(e.target.value) || 0))}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Average price per hotel (€)
            <input type="number" min={0} step="0.01" value={projPrice} onChange={e => setProjPrice(Number(e.target.value) || 0)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Average Claude cost (€/hotel)
            <input type="number" min={0} step="0.01" value={projClaude} onChange={e => setProjClaude(Number(e.target.value) || 0)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Average WhatsApp cost (€/hotel)
            <input type="number" min={0} step="0.01" value={projWhatsapp} onChange={e => setProjWhatsapp(Number(e.target.value) || 0)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Monthly infra cost (€, flat)
            <input type="number" min={0} step="0.01" value={projInfra} onChange={e => setProjInfra(Number(e.target.value) || 0)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Commission rate (%)
            <input type="number" min={0} max={100} step="0.1" value={projCommission} onChange={e => setProjCommission(Number(e.target.value) || 0)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40" />
          </label>
        </div>

        {/* Results */}
        <div className="pt-3 border-t border-slate-100 space-y-1.5">
          {[
            { label: 'Total revenue',          value: `€${projTotalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
            { label: 'Total variable costs',   value: `€${projTotalVariable.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
            { label: 'Total infra cost',       value: `€${projTotalInfra.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
            { label: 'Net before commission',  value: `€${projNetBeforeComm.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
            { label: 'Total commission owed',  value: `€${projTotalCommission.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between text-sm text-slate-600">
              <span>{row.label}</span>
              <span className="font-medium tabular-nums">{row.value}</span>
            </div>
          ))}
          <div className="border-t border-slate-200 my-2" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800">True net profit</span>
            <span className="text-lg font-semibold tabular-nums text-green-600">
              €{projTrueNetProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Profit per hotel</span>
            <span className="text-sm font-medium tabular-nums text-slate-700">
              €{projProfitPerHotel.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Commissionable toggle — confirm modal (Part 5) */}
      {confirmToggle && (
        <Modal title="Change commissionable status?" onClose={() => { setConfirmToggle(null); setConfirmReason(''); }}>
          <div className="space-y-4">
            <div className="text-sm text-slate-600 space-y-1">
              <p>Tenant: <strong className="text-slate-800">{confirmToggle.tenantName}</strong></p>
              <p>New status: <strong className={confirmToggle.newStatus ? 'text-green-600' : 'text-red-500'}>
                {confirmToggle.newStatus ? 'Commissionable' : 'Not Commissionable'}
              </strong></p>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Reason (optional)</span>
              <input
                type="text"
                value={confirmReason}
                onChange={e => setConfirmReason(e.target.value)}
                placeholder="e.g. Partner handed back to house"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={() => { setConfirmToggle(null); setConfirmReason(''); }} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={confirmCommissionableToggle}
                disabled={confirmSaving}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40"
              >
                {confirmSaving ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Commissionable History modal */}
      {historyTenant && (
        <CommissionableHistoryModal tenant={historyTenant} onClose={() => setHistoryTenant(null)} />
      )}
    </div>
  );
}
