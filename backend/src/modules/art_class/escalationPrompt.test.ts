// Run: npx tsx src/modules/art_class/escalationPrompt.test.ts
import { renderArtClassPrompt } from './agent.js';
import { withArtClassEscalationRule, applyArtClassEscalation } from './escalation.js';
import { getSession, updateSession, appendAssistantToSession, clearSession } from '../../whatsapp/sessions.js';
import { ESCALATION_PROMPT_ACTIVE } from '../../escalation/alert.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

for (const [label, tenant] of [
  ['configured studio', { name: 'WeArt', studio_location: 'Rruga 1, Tirana', studio_emojis: '🎨 ✨', studio_greeting: 'Hello from WeArt!', studio_farewell: 'See you soon!' }],
  ['bare studio', { name: 'WeArt' }],
] as const) {
  const base = renderArtClassPrompt(tenant, 'Monday 1 January 2026, 10:00');
  const out = withArtClassEscalationRule(base);

  check(`${label}: base prompt has the original rule 4`, base.includes("4. When you don't have the specific answer to a question:") && base.includes('offer to connect them with the'));
  check(`${label}: rule 4 replaced by the escalation version`, out.includes('human check is ON for this studio') && out.includes('escalate_to_staff') && !out.includes('offer to connect them with the'));
  check(`${label}: human handoff section kept for explicit requests`, out.includes('=== HUMAN HANDOFF ===') && out.includes('get_owner_contact'));
  check(`${label}: rules 1-3, 5, 6 untouched`, out.includes('1. Never mention "settings"') && out.includes('3. Never invent specific studio details') && out.includes("5. Match your tone's confidence") && out.includes('6. Whenever rule 4 applies'));
  check(`${label}: registration flows untouched`, out.includes('STEP 7 — REGISTER ALL 4') && out.includes('SPECIAL EVENT FLOW'));
  check(`${label}: everything before rule 4 is byte-identical`, out.startsWith(base.slice(0, base.indexOf("4. When you don't have the specific answer to a question:"))));
  check(`${label}: ends with the same STYLE section`, out.endsWith('- Warm and encouraging'));
  check(`${label}: escalation not in play -> prompt returned unchanged`, applyArtClassEscalation(base, null) === base);
  check(`${label}: active -> rule replaced and rules appended`, applyArtClassEscalation(base, { openQuestion: null }) === out + ESCALATION_PROMPT_ACTIVE);
  check(`${label}: pending -> original rule kept, pending note appended`, (() => { const p = applyArtClassEscalation(base, { openQuestion: 'Do you do pottery?' }); return p.startsWith(base) && p.includes('PENDING CHECK') && p.includes('Do you do pottery?'); })());
}
check('prompt without the markers is returned unchanged', withArtClassEscalationRule('You are a bot.') === 'You are a bot.');

// in-memory session append: only into a live session, never creating one that would start with an assistant turn
const phone = '+355690000001';
clearSession(phone);
appendAssistantToSession(phone, 'orphan');
check('no live session -> nothing is created (history must not start with an assistant message)', getSession(phone).length === 0);
updateSession(phone, 'Do you do pottery?', 'Let me check.');
appendAssistantToSession(phone, 'Yes, on Saturdays.');
const h = getSession(phone);
check('live session -> relayed answer appended after the turn', h.length === 3 && h[0].role === 'user' && h[2].role === 'assistant' && h[2].content === 'Yes, on Saturdays.');
clearSession(phone);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
