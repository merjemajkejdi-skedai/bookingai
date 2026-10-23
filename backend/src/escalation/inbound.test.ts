// Run: npx tsx src/escalation/inbound.test.ts
import {
  createStaffInterceptor, extractRefCode, toE164, HINT_MESSAGE, ALREADY_HANDLED_MESSAGE,
  RELAY_FAILED_MESSAGE, RELAYED_MESSAGE,
  type InboundDeps, type EscalationRow,
} from './inbound.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const STAFF = '+355691234567';
const ON = { id: 't1', type: 'airbnb', human_escalation_enabled: true, human_escalation_number: STAFF };

function harness(over: Partial<InboundDeps> = {}, rowsByQuote: Record<string, EscalationRow> = {}, rowsByCode: Record<string, EscalationRow> = {}) {
  const sent: string[] = [];
  const recorded: { id: string; answer: string }[] = [];
  const relayed: string[] = [];
  const deps: InboundDeps = {
    listNumbers: async () => [STAFF],
    findByQuotedId: async (_t, _s, q) => rowsByQuote[q] ?? null,
    findByCode: async (_t, _s, c) => rowsByCode[c] ?? null,
    recordAnswer: async (id, answer) => { recorded.push({ id, answer }); return true; },
    isExistingStaffNumber: async () => false,
    relay: async id => { relayed.push(id); return { ok: true, guestReply: 'ok' }; },
    send: async (_t, _to, text) => { sent.push(text); },
    ...over,
  };
  return { run: createStaffInterceptor(deps), sent, recorded, relayed };
}
const row = (status: string, kind = 'question'): EscalationRow => ({ id: 'e1', tenant_id: 't1', status, staff_number: STAFF, alert_code: 'A12', kind });

(async () => {
  // helpers
  check('toE164 meta', toE164('355691234567') === STAFF);
  check('toE164 twilio', toE164('whatsapp:+355691234567') === STAFF);
  check('toE164 junk', toE164('hello') === null && toE164('') === null);
  check('ref: "Ref #A12"', extractRefCode('Yes, until 3pm. Ref #A12') === 'A12');
  check('ref: "ref a7"', extractRefCode('ref a7 ok') === 'A7');
  check('ref: "#b19"', extractRefCode('#b19 sure') === 'B19');
  check('ref: bare code is not enough', extractRefCode('A12 yes') === null);
  check('ref: plain words', extractRefCode('reference the manual, ok') === null);

  { const h = harness();
    check('flag off -> false, untouched', (await h.run({ tenant: { ...ON, human_escalation_enabled: false }, from: STAFF, text: 'hi' })) === false && h.sent.length === 0); }

  { const h = harness();
    check('not a staff number -> false', (await h.run({ tenant: ON, from: '+355699999999', text: 'hi' })) === false && h.sent.length === 0); }

  { const h = harness({}, { wamid1: row('waiting') });
    const r = await h.run({ tenant: ON, from: '355691234567', text: 'Yes, 3pm is fine', quotedMessageId: 'wamid1' });
    check('quoted reply recorded (meta number format)', r === true && h.recorded[0]?.answer === 'Yes, 3pm is fine' && h.sent.length === 0, h); }

  { const h = harness({}, {}, { A12: row('waiting') });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'Ref #A12 yes until 3pm' });
    check('ref-code reply recorded', r === true && h.recorded.length === 1 && h.sent.length === 0, h); }

  { const h = harness();
    const r = await h.run({ tenant: ON, from: STAFF, text: 'what?' });
    check('no match -> hint, handled', r === true && h.sent[0] === HINT_MESSAGE && h.recorded.length === 0, h); }

  { const h = harness({ isExistingStaffNumber: async () => true });
    const r = await h.run({ tenant: ON, from: STAFF, text: '205 done' });
    check('no match + existing staff flow -> fall through untouched', r === false && h.sent.length === 0, h); }

  { const h = harness({ isExistingStaffNumber: async () => true }, { q: row('waiting') });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'ok yes', quotedMessageId: 'q' });
    check('existing staff number quoting an alert is still an answer', r === true && h.recorded.length === 1, h); }

  for (const s of ['answered', 'cancelled', 'failed']) {
    const h = harness({}, { q: row(s) });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'late', quotedMessageId: 'q' });
    check(`status ${s} -> already handled`, r === true && h.sent[0] === ALREADY_HANDLED_MESSAGE && h.recorded.length === 0, h);
  }

  { const h = harness({}, { q: row('timed_out') });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'sorry, yes', quotedMessageId: 'q' });
    check('timed_out reply still accepted', r === true && h.recorded.length === 1 && h.sent.length === 0, h); }

  { const h = harness({ recordAnswer: async () => false }, { q: row('waiting') });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q' });
    check('lost race -> already handled', r === true && h.sent[0] === ALREADY_HANDLED_MESSAGE, h); }

  { const h = harness({}, { q: row('waiting') });
    const r = await h.run({ tenant: ON, from: STAFF, text: '   ', quotedMessageId: 'q' });
    check('empty reply -> hint, nothing recorded', r === true && h.sent[0] === HINT_MESSAGE && h.recorded.length === 0, h); }

  { const h = harness({ send: async () => { throw new Error('24h window'); } });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'hello' });
    check('failed hint send still counts as staff message (never reaches guest AI)', r === true, h); }

  { const h = harness({ listNumbers: async () => { throw new Error('db down'); } });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'hello' });
    check('db error -> fail open (old behavior)', r === false, h); }

  { const h = harness({}, { q: row('waiting') });
    const a = await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q', messageId: 'dup-1' });
    const b = await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q', messageId: 'dup-1' });
    check('webhook retry deduped (recorded once, no extra message)', a && b && h.recorded.length === 1 && h.sent.length === 0, h); }

  { const h = harness({}, { q: row('waiting') });
    await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q' });
    check('answer is relayed to the guest exactly once', h.relayed.length === 1 && h.relayed[0] === 'e1', h); }

  { const h = harness({}, { q: row('timed_out') });
    await h.run({ tenant: ON, from: STAFF, text: 'late but yes', quotedMessageId: 'q' });
    check('late answer to a timed_out escalation is relayed too', h.relayed.length === 1, h); }

  for (const s of ['answered', 'cancelled', 'failed']) {
    const h = harness({}, { q: row(s) });
    await h.run({ tenant: ON, from: STAFF, text: 'again', quotedMessageId: 'q' });
    check(`nothing is relayed for a ${s} escalation`, h.relayed.length === 0, h);
  }

  { const h = harness({ recordAnswer: async () => false }, { q: row('waiting') });
    await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q' });
    check('lost race -> not relayed', h.relayed.length === 0, h); }

  { const h = harness({ relay: async () => ({ ok: false, error: 'delivery_failed: x' }) }, { q: row('waiting') });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q' });
    check('relay failure -> staff is told to contact the guest, still a staff message', r === true && h.sent[0] === RELAY_FAILED_MESSAGE, h); }

  { const h = harness({}, { q: row('waiting', 'request') });
    await h.run({ tenant: ON, from: STAFF, text: 'towels on the way', quotedMessageId: 'q' });
    check('request kind + delivered -> short confirmation to staff', h.sent[0] === RELAYED_MESSAGE && h.sent.length === 1, h); }

  { const h = harness({}, { q: row('waiting', 'question') });
    await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q' });
    check('question kind + delivered -> no extra message yet (FAQ prompt is stage 5)', h.sent.length === 0, h); }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
