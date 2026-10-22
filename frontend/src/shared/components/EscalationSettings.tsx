import { useEffect, useState } from 'react';
import { escalationApi, type EscalationConfig } from '../lib/escalationApi';

// Tenant-level settings for "check with staff before creating a request".
// Shared by the admin tenant editor (tenantId given) and owner-facing settings (tenantId omitted).
export function EscalationSettings({ tenantId }: { tenantId?: string }) {
  const [cfg, setCfg] = useState<EscalationConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [number, setNumber] = useState('');
  const [timeoutMin, setTimeoutMin] = useState('15');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  function apply(c: EscalationConfig) {
    setCfg(c);
    setEnabled(c.enabled);
    setNumber(c.number ?? '');
    setTimeoutMin(String(c.timeoutMinutes));
  }

  useEffect(() => {
    setLoading(true);
    escalationApi.get(tenantId)
      .then(apply)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      apply(await escalationApi.save({ enabled, number: number.trim(), timeoutMinutes: Number(timeoutMin) }, tenantId));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400';

  return (
    <div className="border border-slate-200 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Check with staff</p>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : cfg && !cfg.supported ? (
        <p className="text-xs text-slate-400">Not available for this type of business.</p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span>
              Check with staff before creating a request
              <span className="block text-xs text-slate-400">
                When the assistant can't answer a question or carry out a request, it asks your staff on WhatsApp first and passes their answer to the guest.
                If nobody replies in time, a normal request is created as before.
              </span>
            </span>
          </label>

          <div>
            <label className="text-xs font-medium text-slate-600">Default staff WhatsApp number</label>
            <input className={inputCls} value={number} onChange={e => setNumber(e.target.value)} placeholder="+355691234567" />
            {cfg?.hasDepartments && (
              <p className="text-xs text-slate-400 mt-1">A department can use its own number instead (set on the Departments screen). This one is used for everything else.</p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Wait for an answer (minutes)</label>
            <input className={`${inputCls} w-28`} type="number" min={1} max={1440} value={timeoutMin} onChange={e => setTimeoutMin(e.target.value)} />
          </div>

          <p className="text-xs text-slate-400">
            WhatsApp only lets us message your staff freely if they have messaged this business number within the last 24 hours.
            Ask your staff to send any message to it once a day, otherwise the alert can fail and a normal request is created instead.
          </p>

          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-teal-700 font-medium">✓ Saved</span>}
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
