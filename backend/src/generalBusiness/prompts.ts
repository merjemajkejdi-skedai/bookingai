import { isPg, prepare, query, queryOne } from '../db/database.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }

function formatHours(raw: any): string {
  const hours = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const labels: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  return days.map(d => {
    const slot = hours[d];
    if (!slot) return `${labels[d]}: Closed`;
    return `${labels[d]}: ${slot.open} – ${slot.close}`;
  }).join('\n');
}

export async function buildGbSystemPrompt(tenantId: string): Promise<string> {
  const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
  const config = await dbGet('SELECT * FROM gb_business_config WHERE tenant_id = ?', tenantId) as any;
  const locations = await dbAll('SELECT * FROM gb_locations WHERE tenant_id = ? AND is_active = true ORDER BY sort_order', tenantId) as any[];
  const faqs = await dbAll('SELECT * FROM gb_faqs WHERE tenant_id = ? AND is_active = true ORDER BY sort_order', tenantId) as any[];
  const docs = await dbAll('SELECT * FROM gb_documents WHERE tenant_id = ? AND is_active = true', tenantId) as any[];
  const departments = await dbAll('SELECT * FROM gb_departments WHERE tenant_id = ? AND is_active = true', tenantId) as any[];
  const menuEnabled = !!(tenant?.menu_enabled);

  const businessName = config?.business_name || tenant?.name || 'the business';
  const description = config?.business_description ? `\n${config.business_description}\n` : '';

  const locationsBlock = locations.length > 0
    ? '\nLOCATIONS:\n' + locations.map((l: any) =>
        `- ${l.name}: ${l.address}${l.phone ? ` (Phone: ${l.phone})` : ''}`
      ).join('\n') + '\n'
    : '';

  const hoursBlock = config?.opening_hours
    ? `\nOPENING HOURS:\n${formatHours(config.opening_hours)}\n`
    : '';

  const contactBlock = [
    config?.phone   ? `Phone: ${config.phone}` : null,
    config?.website ? `Website: ${config.website}` : null,
    config?.email   ? `Email: ${config.email}` : null,
  ].filter(Boolean);
  const contactSection = contactBlock.length > 0
    ? '\nCONTACT:\n' + contactBlock.map(c => `- ${c}`).join('\n') + '\n'
    : '';

  const faqBlock = faqs.length > 0
    ? '\nFREQUENTLY ASKED QUESTIONS:\n' + faqs.map((f: any) =>
        `Q: ${f.question}\nA: ${f.answer}`
      ).join('\n\n') + '\n'
    : '';

  const knowledgeTexts = docs.filter((d: any) => d.extracted_text).map((d: any) =>
    `--- ${d.name} ---\n${d.extracted_text}`
  );
  const knowledgeBlock = knowledgeTexts.length > 0
    ? '\nKNOWLEDGE BASE (use this to answer customer questions):\n' + knowledgeTexts.join('\n\n') + '\n'
    : '';

  const departmentsBlock = departments.length > 0
    ? '\nDEPARTMENTS (use these IDs when creating requests):\n' + departments.map((d: any) =>
        `- ${d.name} (ID: ${d.id})${d.request_types?.length ? ` — handles: ${(typeof d.request_types === 'string' ? JSON.parse(d.request_types) : d.request_types).join(', ')}` : ''}`
      ).join('\n') + '\n'
    : '';

  let menuBlock = '';
  if (menuEnabled) {
    const items = await dbAll(
      `SELECT * FROM gb_menu_items WHERE tenant_id = ? AND is_available = ${isPg ? 'true' : '1'} ORDER BY category, sort_order`,
      tenantId,
    ) as any[];
    if (items.length > 0) {
      const byCategory: Record<string, any[]> = {};
      for (const item of items) {
        const cat = item.category || 'Other';
        (byCategory[cat] ??= []).push(item);
      }
      menuBlock = '\nMENU:\n' + Object.entries(byCategory).map(([cat, catItems]) =>
        `${cat}:\n` + catItems.map((i: any) =>
          `  - ${i.name}${i.description ? ` — ${i.description}` : ''} — ${i.price} ${i.currency} (ID: ${i.id})`
        ).join('\n')
      ).join('\n') + '\n';
    }
  }

  const orderInstructions = menuEnabled ? `
When a customer wants to order:
1. Show them the menu if they haven't seen it
2. Confirm their items and total
3. Collect their name (you already have their phone from the conversation)
4. Use the create_order tool to place the order
` : '';

  return `You are a helpful assistant for ${businessName}.
${description}
You help customers with enquiries, provide information about services, locations, and opening hours${menuEnabled ? ', and take orders' : ''}.

Always respond in the language the customer uses.
Be friendly, professional, and concise.
${contactSection}${locationsBlock}${hoursBlock}${departmentsBlock}${faqBlock}${knowledgeBlock}${menuBlock}${orderInstructions}
IMPORTANT RULES:
- If asked where you are located, list ALL locations
- Do not make up information not provided above
- For complex requests or complaints, create a request for the relevant department using create_request
- When a customer asks for a document or file, use get_document to send it
- After-hours: tell customers the opening hours and that you'll respond when the team is back
`;
}
