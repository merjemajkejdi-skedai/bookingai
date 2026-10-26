// Run: npx tsx src/skedai/escalationPrompt.test.ts
import { buildSalesPrompt, buildSupportPrompt } from './prompts.js';
import { withSkedaiEscalationRule, applySkedaiEscalation } from './escalation.js';
import {
  escalationPromptActive, escalationPromptPending, escalationToolResult, ESCALATION_PROMPT_ACTIVE,
} from '../escalation/alert.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const faq = [{ q: 'What are the prices you apply?', a: 'Prices differ by business. Book an intro call.' }];
const base = buildSalesPrompt([], '', faq);
const out = withSkedaiEscalationRule(base);

check('base sales prompt has the original "don\'t know" rule', base.includes('say "Great question — let me have our team answer that properly"'));
check('rule replaced by the escalation version', out.includes('human check is ON') && out.includes('escalate_to_staff') && !out.includes('let me have our team answer that properly'));
check('every other rule untouched', out.includes('- Keep responses short — this is WhatsApp, not email') && out.includes('- Never make up features that don\'t exist') && out.includes('- Never promise custom development') && out.includes('- Be warm, confident, never pushy') && out.endsWith('- Sign off as "SkedAI"'));
check('FAQ block untouched', out.includes('FREQUENTLY ASKED QUESTIONS') && out.includes('What are the prices you apply?'));
check('everything before the rule is byte-identical', out.startsWith(base.slice(0, base.indexOf('- If asked something you don\'t know'))));
check('prompt without the rule is returned unchanged', withSkedaiEscalationRule('You are a bot.') === 'You are a bot.');

// the support route is not touched at all (it already alerts the team on every message)
const support = buildSupportPrompt(faq);
check('support prompt has no "don\'t know" rule to replace and is unchanged', withSkedaiEscalationRule(support) === support);

check('escalation not in play -> prompt returned unchanged', applySkedaiEscalation(base, null) === base);
const active = applySkedaiEscalation(base, { openQuestion: null });
check('active -> rule replaced and the no-request-tool wording appended', active.startsWith(out) && active.includes('escalate_to_staff') && !active.includes('create_request'));
const pending = applySkedaiEscalation(base, { openQuestion: 'Do you integrate with Shopify?' });
check('pending -> original prompt kept, pending note appended, no create_request', pending.startsWith(base) && pending.includes('Do you integrate with Shopify?') && !pending.includes('create_request'));

// shared wording: defaults byte-identical for hotel / general_business / airbnb / shop / art_class
check('default active prompt unchanged and still mentions create_request', escalationPromptActive() === ESCALATION_PROMPT_ACTIVE && ESCALATION_PROMPT_ACTIVE.includes('fall back to create_request as usual'));
check('default pending prompt unchanged', escalationPromptPending('Q?').includes('create a normal request with create_request as usual'));
check('default tool results unchanged', JSON.stringify(escalationToolResult({ ok: false, reason: 'send_failed' })).includes("Handle it with create_request as you normally would") && JSON.stringify(escalationToolResult({ ok: false, reason: 'already_waiting', openQuestion: 'Q' })).includes('use create_request as usual'));
check('no-request-tool variants never mention create_request', ![
  escalationPromptActive(undefined, true), escalationPromptPending('Q?', undefined, true),
  JSON.stringify(escalationToolResult({ ok: false, reason: 'send_failed' }, undefined, true)),
  JSON.stringify(escalationToolResult({ ok: false, reason: 'already_waiting', openQuestion: 'Q' }, undefined, true)),
].some(s => s.includes('create_request')));
check('no-request-tool variants still guide the model honestly', JSON.stringify(escalationToolResult({ ok: false, reason: 'send_failed' }, undefined, true)).includes('Do not guess'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
