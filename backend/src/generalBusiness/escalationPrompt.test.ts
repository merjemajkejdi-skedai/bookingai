// Run: npx tsx src/generalBusiness/escalationPrompt.test.ts
import { renderGbSystemPrompt, type GbPromptData } from './prompts.js';
import { withGbEscalationRules } from './escalation.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const data = (menu: boolean): GbPromptData => ({
  tenant: { id: 't1', name: 'Acme', menu_enabled: menu },
  config: { business_name: 'Acme Ltd' },
  locations: [{ name: 'Main', address: 'Rruga 1' }],
  faqs: [{ question: 'Q1?', answer: 'A1' }],
  docs: [], departments: [{ id: 'd1', name: 'Sales', request_types: ['quote'] }],
  menuItems: menu ? [{ id: 'm1', name: 'Latte', price: 3, currency: 'EUR', category: 'Drinks' }] : [],
});

for (const [label, d] of [['no menu', data(false)], ['with menu', data(true)]] as const) {
  const base = renderGbSystemPrompt(d);
  const out = withGbEscalationRules(base);

  check(`${label}: base prompt has the original rules 4 and 5`, base.includes('4. When you don\'t have the specific answer:') && base.includes('create_request so a human follows up'));
  check(`${label}: rules 4/5 replaced by the escalation version`, out.includes('human check is ON') && out.includes('escalate_to_staff') && !out.includes('create_request so a human follows up'));
  check(`${label}: rules 1-3 untouched`, out.includes('1. Never mention "FAQ"') && out.includes('3. Never invent specific details'));
  check(`${label}: rules 6-7 and OTHER RULES untouched`, out.includes("6. Match your tone's confidence") && out.includes('7. Whenever rule 4 applies') && out.includes('OTHER RULES:'));
  check(`${label}: complaints/complex requests still use create_request`, out.includes('For complex requests or complaints, create a request'));
  check(`${label}: everything before rule 4 is byte-identical`, out.startsWith(base.slice(0, base.indexOf("4. When you don't have the specific answer:"))));
  check(`${label}: data blocks (FAQ, departments) still present`, out.includes('FREQUENTLY ASKED QUESTIONS') && out.includes('DEPARTMENTS'));
}

check('prompt without the markers is returned unchanged', withGbEscalationRules('You are a bot.') === 'You are a bot.');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
