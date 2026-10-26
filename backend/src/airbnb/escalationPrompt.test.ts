// Run: npx tsx src/airbnb/escalationPrompt.test.ts
// Airbnb needs no replacement of its base prompt (measured: append-only already escalates 12/12 on Sonnet and Haiku);
// what matters is that the shared wording says "the host" and leaves the hotel / general_business text untouched.
import { escalationPromptActive, escalationPromptPending, escalationToolResult, ESCALATION_PROMPT_ACTIVE } from '../escalation/alert.js';
import { buildAirbnbSystemPrompt } from './prompts.js';
import { AIRBNB_WHO } from './escalation.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

check('host wording constant', AIRBNB_WHO === 'the host');
check('default active prompt is exactly the existing constant', escalationPromptActive() === ESCALATION_PROMPT_ACTIVE && ESCALATION_PROMPT_ACTIVE.includes('check with your colleagues'));
check('host variant says "the host"', escalationPromptActive(AIRBNB_WHO).includes('check with the host') && !escalationPromptActive(AIRBNB_WHO).includes('check with your colleagues'));
check('pending prompt default wording unchanged', escalationPromptPending('Q?').includes('checking this with colleagues for this guest'));
check('pending prompt host variant', escalationPromptPending('Q?', AIRBNB_WHO).includes('checking this with the host for this guest'));
const ok = { ok: true as const, id: 'x', code: 'A1', staffNumber: '+1' };
check('tool result default wording unchanged', JSON.stringify(escalationToolResult(ok)).includes('check this with your colleagues'));
check('tool result host variant', JSON.stringify(escalationToolResult(ok, AIRBNB_WHO)).includes('check this with the host'));
check('"already waiting" result default wording unchanged', JSON.stringify(escalationToolResult({ ok: false, reason: 'already_waiting', openQuestion: 'Q' })).includes('A check with colleagues is already in progress'));
check('"already waiting" result host variant', JSON.stringify(escalationToolResult({ ok: false, reason: 'already_waiting', openQuestion: 'Q' }, AIRBNB_WHO)).includes('A check with the host is already in progress'));

// the listing prompt the escalation text is appended to is the existing one, untouched
const p = buildAirbnbSystemPrompt({ name: 'Elda' }, { name: 'Sea View', address: 'A', config: {} });
check('listing prompt unchanged by this feature (still has its own rules 3 and 4)', p.includes('3. When you do not have the specific answer') && p.includes('4. Do not confirm operational requests'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
