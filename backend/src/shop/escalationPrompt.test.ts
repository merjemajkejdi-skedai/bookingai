// Run: npx tsx src/shop/escalationPrompt.test.ts
import { buildShopSystemPrompt } from './prompts.js';
import { withShopEscalationRule } from './escalation.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

for (const [label, config] of [
  ['with contact details', { shop_name: 'Bloom', phone: '+355 69 000 0000', address: 'Rruga 1', opening_hours: '9-18' }],
  ['bare config', {}],
] as const) {
  const base = buildShopSystemPrompt({ name: 'Bloom' }, config, { minutes: 15, label: '15 minutes' });
  const out = withShopEscalationRule(base);

  check(`${label}: base prompt has the original rule 4`, base.includes("4. When you don't have the specific answer:") && base.includes('point them to contact the shop'));
  check(`${label}: rule 4 replaced by the escalation version`, out.includes('human check is ON for this shop') && out.includes('escalate_to_staff') && !out.includes('point them to contact the shop'));
  check(`${label}: rules 1-3, 5 and 6 untouched`, out.includes('1. NEVER say "FAQ"') && out.includes('3. NEVER invent specific details') && out.includes("5. Match your tone's confidence") && out.includes('6. Whenever rule 4 applies'));
  check(`${label}: ordering flow untouched`, out.includes('STEP 4 — PLACE THE ORDER IMMEDIATELY') && out.includes('POST-ORDER BEHAVIOUR') && out.includes('ITEM ID RULE'));
  check(`${label}: everything before rule 4 is byte-identical`, out.startsWith(base.slice(0, base.indexOf("4. When you don't have the specific answer:"))));
  check(`${label}: response style (after the rules) untouched`, out.includes('RESPONSE STYLE') && out.endsWith('always include the order number'));
}

check('prompt without the markers is returned unchanged', withShopEscalationRule('You are a bot.') === 'You are a bot.');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
