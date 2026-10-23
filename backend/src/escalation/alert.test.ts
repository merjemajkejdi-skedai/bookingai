// Run: npx tsx src/escalation/alert.test.ts
import {
  createEscalator, buildAlertMessage, scrubQuestion, resolveStaffNumber, generateAlertCode,
  escalationToolResult, type EscalationDeps, type InsertRow,
} from './alert.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const TENANT = { id: 't1', type: 'hotel', name: 'Hotel X', human_escalation_enabled: true, human_escalation_number: '+355691111111', human_escalation_timeout_minutes: 20, provider: 'meta' };
const BASE = {
  tenantId: 't1', conversationId: 'c1', kind: 'question' as const, questionSummary: 'Is late checkout possible tomorrow at 2pm?',
  alert: { businessName: 'Hotel X', contextBits: ['Room 204'], guestName: 'Maria' },
};

function harness(over: Partial<EscalationDeps> = {}, tenant: any = TENANT) {
  const inserts: InsertRow[] = [];
  const sends: { to: string; text: string }[] = [];
  const marks: string[] = [];
  const codes = ['A12', 'B34', 'C56'];
  const deps: EscalationDeps = {
    loadTenant: async () => tenant,
    findOpen: async () => null,
    insert: async r => { inserts.push(r); return { result: 'ok', id: 'esc1' }; },
    send: async (_t, to, text) => { sends.push({ to, text }); return 'wamid.123'; },
    markSent: async (id, mid) => { marks.push(`sent:${id}:${mid}`); },
    markFailed: async id => { marks.push(`failed:${id}`); },
    randomCode: () => codes.shift() ?? 'Z99',
    now: () => new Date('2026-10-23T10:00:00Z'),
    ...over,
  };
  return { esc: createEscalator(deps), inserts, sends, marks };
}

(async () => {
  // pure helpers
  check('dept number wins', resolveStaffNumber('+355692222222', '+355691111111') === '+355692222222');
  check('falls back to default', resolveStaffNumber(null, '+355691111111') === '+355691111111');
  check('none -> null', resolveStaffNumber('', undefined) === null);
  check('code shape', /^[A-Z][1-9]\d$/.test(generateAlertCode()) && generateAlertCode(() => 0) === 'A10');
  check('scrub removes long phone numbers', scrubQuestion('call me on +355 69 123 4567 please') === 'call me on [number removed] please');
  check('scrub keeps short numbers (room, times)', scrubQuestion('room 204 at 14:30 for 2 nights') === 'room 204 at 14:30 for 2 nights');
  const msg = buildAlertMessage({ businessName: 'Hotel X', contextBits: ['Room 204', null], guestName: 'Maria', question: 'Late checkout at 2pm?', code: 'A12' });
  check('alert format', msg === 'Guest question (Hotel X, Room 204)\nGuest: Maria\n"Late checkout at 2pm?"\n\nReply to this message with your answer.\nRef #A12', msg);
  check('alert without guest name omits the line', !buildAlertMessage({ businessName: 'Hotel X', question: 'q', code: 'A1' }).includes('Guest:'));

  { const h = harness();
    const r = await h.esc(BASE);
    check('happy path', r.ok === true && (r as any).code === 'A12' && (r as any).staffNumber === '+355691111111', r);
    check('alert sent once to staff with ref code and no phone', h.sends.length === 1 && h.sends[0].to === '+355691111111' && h.sends[0].text.includes('Ref #A12'), h.sends);
    check('provider message id stored', h.marks.includes('sent:esc1:wamid.123'), h.marks);
    check('expiry = now + tenant timeout (20 min)', h.inserts[0].expiresAt.toISOString() === '2026-10-23T10:20:00.000Z', h.inserts[0]); }

  { const h = harness();
    const r = await h.esc({ ...BASE, departmentId: 'd1', departmentNumber: '+355692222222' });
    check('department number used when set', r.ok && (r as any).staffNumber === '+355692222222' && h.sends[0].to === '+355692222222', r); }

  { const h = harness({}, { ...TENANT, human_escalation_enabled: false });
    const r = await h.esc(BASE);
    check('disabled -> nothing created or sent', !r.ok && (r as any).reason === 'disabled' && h.inserts.length === 0 && h.sends.length === 0, r); }

  { const h = harness({}, { ...TENANT, type: 'restaurant' });
    const r = await h.esc(BASE);
    check('unsupported type refused', !r.ok && (r as any).reason === 'unsupported' && h.sends.length === 0, r); }

  { const h = harness({}, { ...TENANT, human_escalation_number: null });
    const r = await h.esc(BASE);
    check('no number anywhere -> no_number', !r.ok && (r as any).reason === 'no_number' && h.sends.length === 0, r); }

  { const h = harness({ findOpen: async () => ({ id: 'old', guest_question: 'Do you allow pets?' }) });
    const r = await h.esc(BASE);
    check('one open per conversation (pre-check)', !r.ok && (r as any).reason === 'already_waiting' && (r as any).openQuestion === 'Do you allow pets?' && h.sends.length === 0, r); }

  { let first = true;
    const h = harness({
      insert: async () => ({ result: 'conflict_open' }),
      findOpen: async () => { if (first) { first = false; return null; } return { id: 'old', guest_question: 'Pets?' }; },
    });
    const r = await h.esc(BASE);
    check('concurrent insert loses to unique index -> already_waiting, no alert', !r.ok && (r as any).reason === 'already_waiting' && h.sends.length === 0, r); }

  { let n = 0;
    const h = harness({ insert: async row => { n++; return n < 3 ? { result: 'code_taken' } : { result: 'ok', id: 'esc2' }; } });
    const r = await h.esc(BASE);
    check('code collision retries with a new code', r.ok && (r as any).code === 'C56' && n === 3, { r, n }); }

  { const h = harness({ insert: async () => ({ result: 'code_taken' }) });
    const r = await h.esc(BASE);
    check('endless collisions give up cleanly', !r.ok && h.sends.length === 0, r); }

  { const h = harness({ send: async () => { throw new Error('Meta API error: outside 24h window'); } });
    const r = await h.esc(BASE);
    check('send failure -> marked failed, caller falls back to a normal request', !r.ok && (r as any).reason === 'send_failed' && h.marks.includes('failed:esc1'), { r, marks: h.marks }); }

  // what the model is told
  check('result: ok says "do not say a request was created"', JSON.stringify(escalationToolResult({ ok: true, id: 'x', code: 'A1', staffNumber: '+1' })).includes('Do not say a request was created'));
  check('result: failure points back to create_request', JSON.stringify(escalationToolResult({ ok: false, reason: 'send_failed' })).includes('create_request'));
  check('result: waiting carries the pending question', JSON.stringify(escalationToolResult({ ok: false, reason: 'already_waiting', openQuestion: 'Pets?' })).includes('Pets?'));

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
