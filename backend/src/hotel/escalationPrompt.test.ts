// Run: npx tsx src/hotel/escalationPrompt.test.ts
import { buildHotelSystemPrompt } from './prompts.js';
import { withEscalationCase2 } from './escalation.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

for (const [label, config] of [
  ['identity step off (Grand Hotel)', { hotel_name: 'Grand Hotel', message_forward: 1, ask_guest_identity: 0 }],
  ['identity step on (default)', { hotel_name: 'Grand Hotel', message_forward: 1 }],
] as const) {
  const base = buildHotelSystemPrompt({ id: 't', name: 'Grand Hotel' }, config, false);
  const out = withEscalationCase2(base);

  check(`${label}: base prompt still has the original CASE 2`, base.includes('CASE 2 — UNANSWERED QUESTION') && base.includes('type = concierge_question'));
  check(`${label}: CASE 2 is replaced by the escalation version`, out.includes('human check is ON') && out.includes('escalate_to_staff') && !out.includes('type = concierge_question'));
  check(`${label}: no instruction left to ask for room number/name on an unanswered question`, !out.includes('Could you also share your room number and name so our team can find you easily'));
  check(`${label}: CASE 1 (service requests) untouched`, out.includes('CASE 1 — SERVICE REQUEST') && out.includes('PHYSICAL ITEMS vs SERVICES'));
  check(`${label}: sections after CASE 2 untouched`, out.includes('QUICK LINKS') && out.includes('TOOLS REFERENCE'));
  check(`${label}: only CASE 2 changed (everything before it is byte-identical)`, out.startsWith(base.slice(0, base.indexOf('  CASE 2 — UNANSWERED QUESTION'))));
}

check('prompt without CASE 2 markers is returned unchanged', withEscalationCase2('You are a bot.') === 'You are a bot.');
const off = buildHotelSystemPrompt({ id: 't', name: 'G' }, { hotel_name: 'G', message_forward: 0 }, false);
check('forwarding-off prompt (no CASE 2) is returned unchanged', withEscalationCase2(off) === off);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
