// Run: npx tsx src/monitoring/escalationHealth.test.ts
import { buildEscalationFindings } from './escalationHealth.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}
const T = { tenant_id: 't1', tenant_name: 'Grand Hotel' };

check('no rows -> no findings', buildEscalationFindings([], [], [], []).length === 0);
check('zero counts are ignored', buildEscalationFindings([{ ...T, n: 0 }], [{ ...T, n: '0' }], [{ ...T, n: 0 }], [{ ...T, request_failed: 0, notice_failed: 0 }]).length === 0);

{ const f = buildEscalationFindings([{ ...T, n: '2' }], [], [], []);
  check('stuck waiting -> critical, per tenant, job-stopped hint', f.length === 1 && f[0].checkType === 'escalation_stuck' && f[0].severity === 'critical' && f[0].tenantId === 't1' && f[0].message.includes('2 guest questions are') && f[0].message.includes('timeout job'), f); }

{ const f = buildEscalationFindings([{ ...T, n: 1 }], [], [], []);
  check('singular wording', f[0].message.includes('1 guest question is'), f[0].message); }

{ const f = buildEscalationFindings([], [{ ...T, n: 3 }], [], []);
  check('failed alerts -> warning that names the 24h-window cause', f.length === 1 && f[0].checkType === 'escalation_alert_failed' && f[0].severity === 'warning' && f[0].message.includes('24 hours'), f); }

{ const f = buildEscalationFindings([], [], [{ ...T, n: 1 }], []);
  check('failed relay -> warning', f.length === 1 && f[0].checkType === 'escalation_relay_failed' && f[0].severity === 'warning', f); }

{ const f = buildEscalationFindings([], [], [], [{ ...T, request_failed: 1, notice_failed: 0 }]);
  check('no request created -> critical', f.length === 1 && f[0].checkType === 'escalation_fallback_failed' && f[0].severity === 'critical' && f[0].message.includes('NO request'), f); }

{ const f = buildEscalationFindings([], [], [], [{ ...T, request_failed: 0, notice_failed: 2 }]);
  check('request created but guest not told -> warning only', f.length === 1 && f[0].severity === 'warning' && f[0].checkType === 'escalation_fallback_failed', f); }

{ const f = buildEscalationFindings([], [], [], [{ ...T, request_failed: 1, notice_failed: 1 }]);
  check('both kinds -> one critical and one warning (separate alerts)', f.length === 2 && f.map(x => x.severity).sort().join() === 'critical,warning', f); }

{ const f = buildEscalationFindings([{ ...T, n: 1 }, { tenant_id: 't2', tenant_name: 'Other', n: 1 }], [], [], []);
  check('each tenant gets its own finding', f.length === 2 && new Set(f.map(x => x.tenantId)).size === 2, f); }

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
