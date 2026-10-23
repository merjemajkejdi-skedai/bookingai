// Run: npx tsx src/escalation/inbound.test.ts
import {
  createStaffInterceptor, extractRefCode, toE164, HINT_MESSAGE, ALREADY_HANDLED_MESSAGE,
  RELAY_FAILED_MESSAGE, RELAYED_MESSAGE,
  type InboundDeps, type EscalationRow,
} from './inbound.js';
import { FAQ_WHICH_MESSAGE, type FaqPromptRow } from './faq.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const STAFF = '+355691234567';
const ON = { id: 't1', type: 'airbnb', human_escalation_enabled: true, human_escalation_number: STAFF };

interface FaqOpts { byQuote?: Record<string, FaqPromptRow>; pending?: FaqPromptRow[]; decideReply?: string | null; promptSent?: boolean }
const faqRow = (): FaqPromptRow => ({ id: 'f1', tenant_id: 't1', tenant_type: 'hotel', conversation_id: 'c1', faq_decision: 'pending', faq_question: 'Q?', faq_answer: 'A.', faq_reask_count: 0 });

function harness(over: Partial<InboundDeps> = {}, rowsByQuote: Record<string, EscalationRow> = {}, rowsByCode: Record<string, EscalationRow> = {}, faq: FaqOpts = {}) {
  const sent: string[] = [];
  const recorded: { id: string; answer: string }[] = [];
  const relayed: string[] = [];
  const decided: { id: string; text: string }[] = [];
  const prompted: string[] = [];
  const deps: InboundDeps = {
    listNumbers: async () => [STAFF],
    findByQuotedId: async (_t, _s, q) => rowsByQuote[q] ?? null,
    findByCode: async (_t, _s, c) => rowsByCode[c] ?? null,
    recordAnswer: async (id, answer) => { recorded.push({ id, answer }); return true; },
    isExistingStaffNumber: async () => false,
    relay: async id => { relayed.push(id); return { ok: true, guestReply: 'ok' }; },
    sendFaqPrompt: async id => { prompted.push(id); return faq.promptSent ?? true; },
    findFaqPromptByQuote: async (_t, _s, q) => faq.byQuote?.[q] ?? null,
    listPendingFaq: async () => faq.pending ?? [],
    decideFaq: async (r, t) => { decided.push({ id: r.id, text: t }); return faq.decideReply === undefined ? 'Saved.' : faq.decideReply; },
    send: async (_t, _to, text) => { sent.push(text); },
    ...over,
  };
  return { run: createStaffInterceptor(deps), sent, recorded, relayed, decided, prompted };
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
    check('question kind + delivered -> save-as-FAQ prompt requested, no separate confirmation', h.prompted.join() === 'e1' && h.sent.length === 0, h); }

  { const h = harness({}, { q: row('waiting', 'question') }, {}, { promptSent: false });
    await h.run({ tenant: ON, from: STAFF, text: 'yes', quotedMessageId: 'q' });
    check('question kind but no FAQ prompt could be offered -> plain confirmation', h.sent[0] === RELAYED_MESSAGE && h.sent.length === 1, h); }

  { const h = harness({}, { q: row('waiting', 'request') });
    await h.run({ tenant: ON, from: STAFF, text: 'on it', quotedMessageId: 'q' });
    check('request kind never gets an FAQ prompt', h.prompted.length === 0, h); }

  // ── YES / NO to the save-as-FAQ prompt ──
  { const h = harness({}, {}, {}, { byQuote: { fq: faqRow() } });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'YES', quotedMessageId: 'fq' });
    check('quoted YES applies to that FAQ prompt, reply sent to staff', r === true && h.decided.length === 1 && h.decided[0].id === 'f1' && h.sent[0] === 'Saved.' && h.recorded.length === 0, h); }

  { const h = harness({}, { q: row('waiting') }, {}, { byQuote: { q: faqRow() } });
    await h.run({ tenant: ON, from: STAFF, text: 'yes it is', quotedMessageId: 'q' });
    check('quoting an alert is an answer, never an FAQ decision', h.recorded.length === 1 && h.decided.length === 0, h); }

  { const h = harness({}, {}, {}, { pending: [faqRow()] });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'no' });
    check('bare NO with exactly one pending prompt applies to it', r === true && h.decided.length === 1 && h.sent.length === 1, h); }

  { const h = harness({}, {}, {}, { pending: [faqRow(), { ...faqRow(), id: 'f2' }] });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'yes' });
    check('bare YES with several pending prompts -> asks which one, applies nothing', r === true && h.decided.length === 0 && h.sent[0] === FAQ_WHICH_MESSAGE, h); }

  { const h = harness({}, {}, {}, { pending: [faqRow(), { ...faqRow(), id: 'f2' }] });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'what do you mean' });
    check('unclear text with several pending prompts is not captured as an FAQ answer', r === true && h.decided.length === 0 && h.sent[0] === HINT_MESSAGE, h); }

  { const h = harness({}, {}, {}, { pending: [faqRow()] });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'hmm let me think' });
    check('unclear text with one pending prompt goes to the decider (it re-asks once)', r === true && h.decided.length === 1, h); }

  { const h = harness({ isExistingStaffNumber: async () => true }, {}, {}, { pending: [faqRow()] });
    const r = await h.run({ tenant: ON, from: STAFF, text: '205 done' });
    check('existing staff flow: "205 done" is not swallowed by a pending FAQ prompt', r === false && h.decided.length === 0 && h.sent.length === 0, h); }

  { const h = harness({ isExistingStaffNumber: async () => true }, {}, {}, { pending: [faqRow()] });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'yes' });
    check('existing staff number answering YES still decides the FAQ', r === true && h.decided.length === 1, h); }

  { const h = harness({}, {}, {}, { pending: [faqRow()], decideReply: null });
    const r = await h.run({ tenant: ON, from: STAFF, text: 'maybe' });
    check('decider says stay silent -> nothing sent, still not a guest message', r === true && h.sent.length === 0, h); }

  { const h = harness();
    const r = await h.run({ tenant: ON, from: STAFF, text: 'yes' });
    check('bare YES with nothing pending behaves as before (hint)', r === true && h.sent[0] === HINT_MESSAGE && h.decided.length === 0, h); }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
