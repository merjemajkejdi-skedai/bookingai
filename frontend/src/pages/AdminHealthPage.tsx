import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Clock } from 'lucide-react';
import { adminApi } from '../shared/lib/auth';
import { Spinner, Button } from '../components/ui';

interface HealthIssue {
  id: string;
  check_type: string;
  tenant_id: string | null;
  tenant_name: string | null;
  severity: 'critical' | 'warning';
  message: string;
  first_detected_at: string;
  last_seen_at?: string;
  resolved_at?: string;
}

interface HealthData {
  summary: { openCritical: number; openWarning: number };
  byCheckType: Record<string, HealthIssue[]>;
  recentlyResolved: HealthIssue[];
}

// Maps raw check_type values (as written by monitoring/healthChecks.ts) to the
// six sections from the health spec. Several check_types can share a section
// (e.g. agent_error_tenant + agent_error_platform both belong to 1.3).
const SECTIONS: { key: string; title: string; checkTypes: string[] }[] = [
  { key: 'email',   title: '1.1 Email Channel Health',      checkTypes: ['email_health'] },
  { key: 'whatsapp', title: '1.2 WhatsApp Provider Health',  checkTypes: ['whatsapp_health'] },
  { key: 'agents',  title: '1.3 Agent Error Rate',           checkTypes: ['agent_error_tenant', 'agent_error_platform'] },
  { key: 'jwt',     title: '1.4 JWT / Auth Health',          checkTypes: ['jwt_secret'] },
  { key: 'quiet',   title: '1.5 Quiet Tenant Detection',     checkTypes: ['quiet_tenant'] },
  { key: 'reports', title: '1.6 Report Delivery Health',     checkTypes: ['report_missed', 'report_duplicate'] },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SeverityBadge({ severity }: { severity: 'critical' | 'warning' }) {
  const isCritical = severity === 'critical';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      isCritical ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
    }`}>
      {isCritical ? <AlertCircle size={12} /> : <AlertTriangle size={12} />}
      {severity}
    </span>
  );
}

function IssueRow({ issue, onResolve }: { issue: HealthIssue; onResolve?: (id: string) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 px-4 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <SeverityBadge severity={issue.severity} />
          {issue.tenant_name && (
            <span className="text-xs font-medium text-slate-500">{issue.tenant_name}</span>
          )}
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock size={11} />
            {issue.resolved_at
              ? `resolved ${timeAgo(issue.resolved_at)} ago`
              : `open ${timeAgo(issue.first_detected_at)}`}
          </span>
        </div>
        <p className="text-sm text-slate-700 break-words">{issue.message}</p>
      </div>
      {onResolve && (
        <Button size="sm" variant="outline" onClick={() => onResolve(issue.id)} className="flex-shrink-0">
          Mark resolved
        </Button>
      )}
    </div>
  );
}

export function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getHealth();
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load health data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleResolve = async (id: string) => {
    setResolvingId(id);
    try {
      await adminApi.resolveHealthAlert(id);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to resolve issue');
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!data) return null;

  const allClear = data.summary.openCritical === 0 && data.summary.openWarning === 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Summary strip */}
      <div className={`rounded-2xl border p-4 flex items-center gap-4 ${
        allClear ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'
      }`}>
        {allClear ? (
          <>
            <CheckCircle2 className="text-green-600 flex-shrink-0" size={24} />
            <div>
              <p className="text-sm font-semibold text-green-800">All clear</p>
              <p className="text-xs text-green-700">No open issues across any health check.</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <AlertCircle className="text-red-600" size={20} />
              <span className="text-lg font-semibold text-slate-800">{data.summary.openCritical}</span>
              <span className="text-sm text-slate-500">critical</span>
            </div>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={20} />
              <span className="text-lg font-semibold text-slate-800">{data.summary.openWarning}</span>
              <span className="text-sm text-slate-500">warning</span>
            </div>
          </>
        )}
      </div>

      {/* One section per check type */}
      {SECTIONS.map(section => {
        const issues = section.checkTypes.flatMap(ct => data.byCheckType[ct] || []);
        return (
          <div key={section.key} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">{section.title}</h3>
              <span className="text-xs text-slate-400">{issues.length} open</span>
            </div>
            {issues.length === 0 ? (
              <p className="text-sm text-slate-400 px-4 py-4">No open issues</p>
            ) : (
              issues.map(issue => (
                <IssueRow key={issue.id} issue={issue} onResolve={id => resolvingId !== id && handleResolve(id)} />
              ))
            )}
          </div>
        );
      })}

      {/* Recently resolved (collapsed) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowResolved(s => !s)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
        >
          <h3 className="text-sm font-semibold text-slate-700">Recently resolved</h3>
          <span className="text-xs text-slate-400">{data.recentlyResolved.length} shown</span>
        </button>
        {showResolved && (
          data.recentlyResolved.length === 0 ? (
            <p className="text-sm text-slate-400 px-4 py-4">Nothing resolved yet</p>
          ) : (
            data.recentlyResolved.map(issue => <IssueRow key={issue.id} issue={issue} />)
          )
        )}
      </div>
    </div>
  );
}
