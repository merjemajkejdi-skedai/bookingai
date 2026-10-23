// Run: npx tsx src/escalation/faq.test.ts
import {
  parseDecision, isNearDuplicate, findNearDuplicate, parseFaqDraft, buildFaqPromptMessage,
  createFaqPrompter, createFaqDecider,
  FAQ_SAVED_MESSAGE, FAQ_DECLINED_MESSAGE, FAQ_DUPLICATE_MESSAGE, FAQ_REASK_MESSAGE, FAQ_FAILED_MESSAGE, FAQ_ALREADY_HANDLED_MESSAGE,
  type PromptDeps, type PromptTarget, type DecideDeps, type FaqPromptRow, type FaqDraft,
} from './faq.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

(async () => {
  // ── YES / NO ──
  for (const t of ['YES', 'yes', 'Y', 'y', 'ja', 'Yes please', 'yes!', 'po', 'Ok', 'sure']) check(`yes: "${t}"`, parseDecision(t) === 'yes');
  for (const t of ['NO', 'no', 'N', 'nope', 'nein', 'jo', 'No thanks.', 'no!']) check(`no: "${t}"`, parseDecision(t) === 'no');
  for (const t of ['maybe', 'what?', '', '   ', 'not sure about this one really', 'the answer is yes', '205 done']) check(`neither: "${t}"`, parseDecision(t) === null);

  // ── near-duplicates ──
  check('dup: identical', isNearDuplicate('Is late checkout possible?', 'Is late checkout possible?'));
  check('dup: check-out vs checkout', isNearDuplicate('Is late check-out possible?', 'Is late checkout possible?'));
  check('dup: one extra content word keeps them distinct (conservative: when unsure, allow saving)', !isNearDuplicate('Are pets allowed?', 'Are pets allowed in the hotel?'));
  check('dup: "Are pets allowed?" vs "Are pets allowed?" different case/punct', isNearDuplicate('are PETS allowed', 'Are pets allowed?'));
  check('not dup: different topic', !isNearDuplicate('Is there a gym?', 'Is there a spa?'));
  check('not dup: related but different', !isNearDuplicate('Can I get a late check-out?', 'Can I get an early check-in?'));
  check('not dup: empty/stopword-only never matches', !isNearDuplicate('Is it?', 'Is it?'));
  check('findNearDuplicate returns the match', findNearDuplicate('Is smoking allowed?', ['Is there a gym?', 'Is smoking allowed?']) === 'Is smoking allowed?');
  check('findNearDuplicate none', findNearDuplicate('Is smoking allowed?', ['Is there a gym?']) === null);

  // ── draft parsing / guard ──
  const SRC = ['Yes, late check-out is possible until 3pm, free of charge', 'Can I check out late tomorrow?'];
  const good = '{"question":"Is late check-out possible?","answer":"Yes, late check-out is possible until 3pm at no charge.","guest_specific":false}';
  check('draft: valid', JSON.stringify(parseFaqDraft(good, SRC)) === JSON.stringify({ question: 'Is late check-out possible?', answer: 'Yes, late check-out is possible until 3pm at no charge.', guestSpecific: false }));
  check('draft: fenced JSON still parsed', parseFaqDraft('```json\n' + good + '\n```', SRC)?.guestSpecific === false);
  check('draft: guest_specific flag kept', parseFaqDraft(good.replace('false', 'true'), SRC)?.guestSpecific === true);
  check('draft: invented number rejected', parseFaqDraft(good.replace('3pm at no charge', '4pm for 20 euro'), SRC) === null);
  check('draft: not JSON', parseFaqDraft('Sure! Here is the FAQ', SRC) === null);
  check('draft: null', parseFaqDraft(null, SRC) === null);
  check('draft: missing answer', parseFaqDraft('{"question":"Q?"}', SRC) === null);
  check('draft: overlong answer', parseFaqDraft(JSON.stringify({ question: 'Q?', answer: 'x'.repeat(601) }), SRC) === null);

  // ── prompt text ──
  const d: FaqDraft = { question: 'Is late check-out possible?', answer: 'Yes, until 3pm.', guestSpecific: false };
  check('prompt format', buildFaqPromptMessage(d) === 'Sent to the guest. Save this as an FAQ for next time?\nQ: Is late check-out possible?\nA: Yes, until 3pm.\nReply YES or NO.', buildFaqPromptMessage(d));
  check('prompt: guest-specific warning', buildFaqPromptMessage({ ...d, guestSpecific: true }).split('\n')[1].includes('specific to this guest'));

  // ── prompter ──
  const target = (over: Partial<PromptTarget> = {}): PromptTarget => ({
    id: 'e1', tenant: { id: 't1', name: 'Hotel X' }, kind: 'question', staffNumber: '+355691234567', businessName: 'Hotel X',
    guestQuestion: 'Can I check out late tomorrow?', staffAnswer: 'Yes, late check-out is possible until 3pm, free of charge',
    guestReply: 'Yes, you can check out late until 3pm.', alreadyPrompted: false, ...over,
  });
  function promptHarness(over: Partial<PromptDeps> = {}, t: PromptTarget | null = target()) {
    const sent: string[] = []; const saved: { draft: FaqDraft; messageId: string | null }[] = [];
    const deps: PromptDeps = {
      load: async () => t,
      compose: async () => good,
      send: async (_t, _to, text) => { sent.push(text); return 'wamid.faq1'; },
      save: async (_id, draft, messageId) => { saved.push({ draft, messageId }); },
      ...over,
    };
    return { run: createFaqPrompter(deps), sent, saved };
  }

  { const h = promptHarness(); const r = await h.run('e1');
    check('prompter: sends prompt and stores draft + provider message id', r === true && h.sent.length === 1 && h.saved[0].messageId === 'wamid.faq1' && h.saved[0].draft.question === 'Is late check-out possible?', h); }
  { const h = promptHarness({}, target({ kind: 'request' })); const r = await h.run('e1');
    check('prompter: never for request kind', r === false && h.sent.length === 0, h); }
  { const h = promptHarness({}, target({ alreadyPrompted: true })); const r = await h.run('e1');
    check('prompter: never twice', r === false && h.sent.length === 0, h); }
  { const h = promptHarness({ compose: async () => null }); const r = await h.run('e1');
    check('prompter: no usable draft -> no prompt (caller sends plain confirmation)', r === false && h.sent.length === 0, h); }
  { const h = promptHarness({ compose: async () => good.replace('3pm at no charge', '5pm for 30 euro') }); const r = await h.run('e1');
    check('prompter: draft with invented numbers is not offered', r === false && h.sent.length === 0, h); }
  { const h = promptHarness({ send: async () => { throw new Error('window closed'); } }); const r = await h.run('e1');
    check('prompter: send failure -> false, nothing saved as pending', r === false && h.saved.length === 0, h); }
  { const h = promptHarness({}, null); const r = await h.run('missing');
    check('prompter: unknown escalation', r === false && h.sent.length === 0, h); }

  // ── decider ──
  const faqRow = (over: Partial<FaqPromptRow> = {}): FaqPromptRow => ({
    id: 'e1', tenant_id: 't1', tenant_type: 'hotel', conversation_id: 'c1', faq_decision: 'pending',
    faq_question: 'Is late check-out possible?', faq_answer: 'Yes, until 3pm.', faq_reask_count: 0, ...over,
  });
  function decideHarness(over: Partial<DecideDeps> = {}, existing: string[] = []) {
    const inserted: { q: string; a: string }[] = []; const decisions: string[] = []; const events: string[] = [];
    const deps: DecideDeps = {
      existingQuestions: async () => existing,
      insertFaq: async (_r, q, a) => { inserted.push({ q, a }); },
      setDecision: async (_id, dec) => { decisions.push(dec); return true; },
      reopen: async () => { events.push('reopen'); },
      markReasked: async () => { events.push('reasked'); },
      ...over,
    };
    return { run: createFaqDecider(deps), inserted, decisions, events };
  }

  { const h = decideHarness(); const r = await h.run(faqRow(), 'YES');
    check('decide: YES saves exactly the proposed Q/A', r === FAQ_SAVED_MESSAGE && h.inserted.length === 1 && h.inserted[0].q === 'Is late check-out possible?' && h.inserted[0].a === 'Yes, until 3pm.' && h.decisions.join() === 'saved', h); }
  { const h = decideHarness(); const r = await h.run(faqRow(), 'no');
    check('decide: NO declines, nothing inserted', r === FAQ_DECLINED_MESSAGE && h.inserted.length === 0 && h.decisions.join() === 'declined', h); }
  { const h = decideHarness({}, ['Can I get a late checkout?']); const r = await h.run(faqRow(), 'yes');
    check('decide: near-identical FAQ exists -> not inserted, staff told', r === FAQ_DUPLICATE_MESSAGE && h.inserted.length === 0, h); }
  { const h = decideHarness({}, ['Is there a gym?']); const r = await h.run(faqRow(), 'yes');
    check('decide: unrelated existing FAQs do not block saving', r === FAQ_SAVED_MESSAGE && h.inserted.length === 1, h); }
  { const h = decideHarness({ setDecision: async () => false }); const r = await h.run(faqRow(), 'yes');
    check('decide: lost race (already decided elsewhere) -> nothing inserted', r === FAQ_ALREADY_HANDLED_MESSAGE && h.inserted.length === 0, h); }
  { const h = decideHarness({ insertFaq: async () => { throw new Error('db down'); } }); const r = await h.run(faqRow(), 'yes');
    check('decide: insert failure -> staff told, prompt reopened for a retry', r === FAQ_FAILED_MESSAGE && h.events.includes('reopen'), h); }
  { const h = decideHarness(); const r = await h.run(faqRow({ faq_decision: 'saved' }), 'yes');
    check('decide: already saved -> already handled, no second insert', r === FAQ_ALREADY_HANDLED_MESSAGE && h.inserted.length === 0, h); }
  { const h = decideHarness(); const r = await h.run(faqRow({ faq_decision: 'declined' }), 'yes');
    check('decide: already declined -> stays declined', r === FAQ_ALREADY_HANDLED_MESSAGE && h.inserted.length === 0, h); }
  { const h = decideHarness(); const r = await h.run(faqRow(), 'hmm maybe later');
    check('decide: unclear -> re-ask once, nothing saved', r === FAQ_REASK_MESSAGE && h.events.join() === 'reasked' && h.inserted.length === 0 && h.decisions.length === 0, h); }
  { const h = decideHarness(); const r = await h.run(faqRow({ faq_reask_count: 1 }), 'hmm maybe later');
    check('decide: unclear again -> stay silent and pending, nothing saved', r === null && h.inserted.length === 0 && h.decisions.length === 0, h); }
  { const h = decideHarness(); const r = await h.run(faqRow({ faq_question: null }), 'yes');
    check('decide: nothing stored to save -> failure message, no insert', r === FAQ_FAILED_MESSAGE && h.inserted.length === 0, h); }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
