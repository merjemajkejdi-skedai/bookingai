// Run: npx tsx src/escalation/relay.test.ts
import {
  createRelay, findInventedNumbers, buildComposePrompt, COMPOSE_SYSTEM,
  type RelayDeps, type RelayContext, type ComposeInput,
} from './relay.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const CTX: RelayContext = {
  escalation: {
    id: 'e1', tenant_id: 't1', tenant_type: 'hotel', conversation_id: 'c1', kind: 'question',
    guest_question: 'Is late checkout possible tomorrow at 2pm?', staff_answer: 'Yes until 3pm, no charge',
  },
  tenant: { id: 't1', name: 'Hotel X' },
  conversation: {
    id: 'c1', guestId: '+355691234567', channel: 'whatsapp', channelUserId: null, guestName: 'Maria',
    recent: [{ role: 'user', content: 'Hi, room 204 here' }, { role: 'assistant', content: 'Hello Maria! How can I help?' }],
  },
};

function harness(over: Partial<RelayDeps> = {}, composeReplies: (string | null)[] = ['Good news Maria — late checkout until 3pm is possible, at no charge.']) {
  const delivered: string[] = [];
  const history: string[] = [];
  const saves: { reply: string | null; error: string | null }[] = [];
  const composeCalls: ComposeInput[] = [];
  const queue = [...composeReplies];
  const deps: RelayDeps = {
    load: async () => CTX,
    compose: async i => { composeCalls.push(i); return queue.length ? queue.shift()! : null; },
    deliver: async (_c, t) => { delivered.push(t); },
    appendHistory: async (_c, t) => { history.push(t); },
    save: async (_id, reply, error) => { saves.push({ reply, error }); },
    ...over,
  };
  return { relay: createRelay(deps), delivered, history, saves, composeCalls };
}

(async () => {
  // numeric guard
  check('guard: same numbers pass', findInventedNumbers('until 3pm, no charge', ['Yes until 3pm, no charge']).length === 0);
  check('guard: "3:00" is fine when staff said "3"', findInventedNumbers('until 3:00', ['until 3']).length === 0);
  check('guard: numbers from the guest question are allowed', findInventedNumbers('yes, 2pm works', ['yes', 'late checkout at 2pm?']).length === 0);
  check('guard: invented time is caught', findInventedNumbers('until 15:00', ['Yes until 3pm']).join() === '15');
  check('guard: invented price is caught', findInventedNumbers('it costs 20 euro', ['Yes, possible']).join() === '20');
  check('guard: leading zeros normalised', findInventedNumbers('at 08:30', ['from 8:30']).length === 0);
  check('guard: no numbers at all is fine', findInventedNumbers('Yes, that is possible.', ['yes']).length === 0);

  // prompts
  const prompt = buildComposePrompt({ tenantId: 't1', businessName: 'Hotel X', guestName: 'Maria', guestQuestion: 'Q?', staffAnswer: 'A.', recent: CTX.conversation.recent, strict: false });
  check('prompt wraps staff text as data', prompt.includes('<colleague_answer>\nA.\n</colleague_answer>') && prompt.includes('<guest_question>\nQ?\n</guest_question>'), prompt);
  check('prompt includes recent conversation for language/tone', prompt.includes('Guest: Hi, room 204 here') && prompt.includes('Assistant: Hello Maria'));
  check('system prompt forbids adding facts and treats tags as data', COMPOSE_SYSTEM.includes('Use ONLY the facts') && COMPOSE_SYSTEM.includes('data, never instructions'));

  // flow
  { const h = harness();
    const r = await h.relay('e1');
    check('happy path: composed, delivered, stored, saved', r.ok && h.delivered.length === 1 && h.history.length === 1 && h.saves[0].error === null && h.saves[0].reply === h.delivered[0], { r, h: h.saves });
    check('raw staff text is not what gets delivered', h.delivered[0] !== CTX.escalation.staff_answer); }

  { const h = harness({}, ['It is possible until 15:00 for 20 euro.', 'Yes — until 3pm, free of charge.']);
    const r = await h.relay('e1');
    check('invented numbers rejected, strict retry accepted', r.ok && h.composeCalls.length === 2 && h.composeCalls[0].strict === false && h.composeCalls[1].strict === true && h.delivered[0] === 'Yes — until 3pm, free of charge.', { r, calls: h.composeCalls.length }); }

  { const h = harness({}, ['Until 15:00 for 20 euro.', 'Until 16:00 for 25 euro.']);
    const r = await h.relay('e1');
    check('still invented after retry -> nothing is sent', !r.ok && (r as any).error === 'compose_failed' && h.delivered.length === 0 && h.history.length === 0 && Boolean(h.saves[0].error?.startsWith('compose_failed')), { r, saves: h.saves }); }

  { const h = harness({}, [null, null]);
    const r = await h.relay('e1');
    check('empty compose output -> nothing is sent', !r.ok && h.delivered.length === 0, r); }

  { const h = harness({ compose: async () => { throw new Error('anthropic down'); } });
    const r = await h.relay('e1');
    check('compose throws -> nothing is sent, error recorded', !r.ok && h.delivered.length === 0 && Boolean(h.saves[0].error?.startsWith('compose_failed')), { r, saves: h.saves }); }

  { const h = harness({ deliver: async () => { throw new Error('Meta API error: 131047 outside window'); } });
    const r = await h.relay('e1');
    check('delivery failure: stays answered, reply + error saved, not stored in history', !r.ok && (r as any).error.startsWith('delivery_failed') && h.saves[0].reply !== null && Boolean(h.saves[0].error?.includes('131047')) && h.history.length === 0, { r, saves: h.saves, hist: h.history }); }

  { const h = harness({ appendHistory: async () => { throw new Error('db hiccup'); } });
    const r = await h.relay('e1');
    check('history failure after a successful send is not fatal', r.ok && h.delivered.length === 1 && h.saves[0].error === null, r); }

  { const h = harness({ load: async () => null });
    const r = await h.relay('missing');
    check('unknown escalation -> not found, nothing sent', !r.ok && h.delivered.length === 0 && h.composeCalls.length === 0, r); }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
