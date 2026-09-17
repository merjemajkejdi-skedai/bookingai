// draftSuggestedAnswer.ts — asks Claude for a candidate FAQ answer to a
// question the live agent couldn't answer. Unlike the live guest-facing
// agent, this is safe to let draft a plausible answer using general
// knowledge: it is never shown to a guest, only to staff for review/edit
// before it becomes a real FAQ entry (see faqGap/applyAction.ts).
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY });

const BUSINESS_LABEL: Record<string, string> = {
  hotel: 'hotel',
  shop: 'shop',
  general_business: 'business',
  art_class: 'art studio',
};

export async function draftSuggestedAnswer(tenantType: string, guestQuestion: string): Promise<string> {
  const label = BUSINESS_LABEL[tenantType] || 'business';

  const prompt = `A guest asked this ${label} the following question, which the AI could not answer because it wasn't in the FAQ: "${guestQuestion}"

Draft a SHORT, plausible candidate answer that staff can review and edit before adding it as a real FAQ entry. If the question requires specific facts you cannot know (exact prices, exact mechanisms like door locks or safes, specific policies), write the draft as a TEMPLATE with a clear placeholder, e.g. "[Confirm exact price] for parking" rather than inventing a number.

Keep it to 1-2 sentences. Reply with the draft answer only, no preamble.`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content.find((b: any) => b.type === 'text') as any;
  const text = block?.text?.trim();
  return text || '[Draft unavailable — please write an answer]';
}
