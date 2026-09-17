import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { logUnansweredQuestion } from '../faqGap/logUnansweredQuestion.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

export function getGbTools(menuEnabled: boolean): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: 'create_request',
      description: 'Create a service request routed to a department. Use for complaints, enquiries, or anything requiring human follow-up.',
      input_schema: {
        type: 'object' as const,
        properties: {
          department_id: { type: 'string', description: 'Department ID to route the request to' },
          request_type:  { type: 'string', description: 'Type of request e.g. complaint, enquiry, technical' },
          description:   { type: 'string', description: 'Detailed description of the request' },
        },
        required: ['description'],
      },
    },
    {
      name: 'get_document',
      description: 'Send a document file to the customer. Use when they explicitly ask for a file, catalogue, or PDF.',
      input_schema: {
        type: 'object' as const,
        properties: {
          document_id: { type: 'string', description: 'The document ID to send' },
        },
        required: ['document_id'],
      },
    },
  ];

  tools.push({
    name: 'log_unanswered_question',
    description: "Call this whenever you are deferring a customer's question because you don't have the specific information in your FAQ/config — i.e. whenever you give an honest 'let me find out' style response instead of a direct answer. This logs the gap so staff can add the missing information to your knowledge base. This is a silent internal action — never mention it to the customer.",
    input_schema: {
      type: 'object' as const,
      properties: {
        guest_question: { type: 'string', description: "The customer's question, in their original words or a faithful paraphrase" },
        topic_hint: { type: 'string', description: "A short category guess, e.g. 'opening hours', 'pricing', 'delivery' — best guess only" },
      },
      required: ['guest_question', 'topic_hint'],
    },
  });

  if (menuEnabled) {
    tools.push({
      name: 'create_order',
      description: 'Create a new order for the customer after confirming items and total.',
      input_schema: {
        type: 'object' as const,
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item_id:  { type: 'string' },
                name:     { type: 'string' },
                price:    { type: 'number' },
                quantity: { type: 'number' },
              },
              required: ['item_id', 'name', 'quantity'],
            },
          },
          notes: { type: 'string', description: 'Special instructions or notes' },
        },
        required: ['items'],
      },
    });
  }

  return tools;
}

export async function executeGbTool(
  toolName: string,
  toolInput: any,
  tenantId: string,
  customerPhone: string,
  conversationId?: string,
): Promise<string> {
  try {
    if (toolName === 'log_unanswered_question') {
      const { guest_question, topic_hint } = toolInput as { guest_question: string; topic_hint: string };
      logUnansweredQuestion(tenantId, 'general_business', guest_question, topic_hint, conversationId).catch(() => {});
      return JSON.stringify({ logged: true });
    }
    if (toolName === 'create_request') return await handleCreateRequest(toolInput, tenantId, customerPhone, conversationId);
    if (toolName === 'get_document')   return await handleGetDocument(toolInput, tenantId);
    if (toolName === 'create_order')   return await handleCreateOrder(toolInput, tenantId, customerPhone, conversationId);
    return `Unknown tool: ${toolName}`;
  } catch (e: any) {
    console.error(`[GB Tool] ${toolName} error:`, e.message);
    return `Error: ${e.message}`;
  }
}

async function handleCreateRequest(
  input: { department_id?: string; request_type?: string; description: string },
  tenantId: string,
  customerPhone: string,
  conversationId?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const conv = await dbGet(
    'SELECT guest_name FROM gb_conversations WHERE tenant_id = ? AND guest_phone = ?',
    tenantId, customerPhone,
  ) as any;

  await dbRun(
    `INSERT INTO gb_requests (id, tenant_id, conversation_id, department_id, guest_phone, guest_name, request_type, description, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,'open',?,?)`,
    id, tenantId, conversationId ?? null, input.department_id ?? null,
    customerPhone, conv?.guest_name ?? null, input.request_type ?? null,
    input.description, now, now,
  );

  if (input.department_id) {
    const dept = await dbGet('SELECT * FROM gb_departments WHERE id = ? AND tenant_id = ?', input.department_id, tenantId) as any;
    if (dept?.whatsapp_number) {
      const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
      const msg = [
        'Business request received.',
        `Request: ${input.request_type || 'General'}`,
        `Details: ${input.description}`,
        `From: ${customerPhone}`,
        `Logged at: ${now}`,
        'Please attend as soon as possible.',
      ].join('\n');
      sendWhatsAppMessage(dept.whatsapp_number, msg, tenant)
        .catch((e: any) => console.error('[GB] Dept notification failed:', e.message));
    }
  }

  return `Request created successfully (ID: ${id}). The relevant team has been notified.`;
}

async function handleGetDocument(
  input: { document_id: string },
  tenantId: string,
): Promise<string> {
  const doc = await dbGet(
    `SELECT * FROM gb_documents WHERE id = ? AND tenant_id = ? AND is_active = ${isPg ? 'true' : '1'}`,
    input.document_id, tenantId,
  ) as any;
  if (!doc) return 'Document not found or no longer available.';

  const publicUrl = `${process.env.R2_PUBLIC_URL || ''}/${doc.r2_key}`;
  return `Here is the document "${doc.name}": ${publicUrl}`;
}

async function handleCreateOrder(
  input: { items: { item_id: string; name: string; price?: number; quantity: number }[]; notes?: string },
  tenantId: string,
  customerPhone: string,
  conversationId?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const orderNumber = `GB-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  const conv = await dbGet(
    'SELECT guest_name, guest_username, guest_email FROM gb_conversations WHERE tenant_id = ? AND guest_phone = ?',
    tenantId, customerPhone,
  ) as any;

  let total = 0;
  for (const item of input.items) {
    if (item.price) total += item.price * item.quantity;
    else {
      const dbItem = await dbGet('SELECT price FROM gb_menu_items WHERE id = ? AND tenant_id = ?', item.item_id, tenantId) as any;
      if (dbItem?.price) { item.price = Number(dbItem.price); total += Number(dbItem.price) * item.quantity; }
    }
  }

  const config = await dbGet('SELECT * FROM gb_business_config WHERE tenant_id = ?', tenantId) as any;
  const currency = config?.currency || 'ALL';

  await dbRun(
    `INSERT INTO gb_orders (id, tenant_id, conversation_id, order_number, guest_phone, guest_name, guest_instagram, guest_email, items, total_price, currency, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
    id, tenantId, conversationId ?? null, orderNumber, customerPhone,
    conv?.guest_name ?? null, conv?.guest_username ?? null, conv?.guest_email ?? null,
    JSON.stringify(input.items), total, currency, input.notes ?? null, now, now,
  );

  if (config?.notification_whatsapp) {
    const tenant = await dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as any;
    const itemLines = input.items.map(i => `  ${i.quantity}x ${i.name}${i.price ? ` — ${i.price} ${currency}` : ''}`).join('\n');
    const msg = [
      `🛒 New Order — ${config.business_name || tenant?.name || 'Business'}`,
      `Order: #${orderNumber}`,
      '', itemLines, '',
      `Total: ${total} ${currency}`,
      '',
      `Customer: ${conv?.guest_name || 'Unknown'}`,
      `Phone: ${customerPhone}`,
      conv?.guest_username ? `Instagram: @${conv.guest_username}` : null,
      conv?.guest_email ? `Email: ${conv.guest_email}` : null,
      input.notes ? `\nNotes: ${input.notes}` : null,
    ].filter(Boolean).join('\n');

    sendWhatsAppMessage(config.notification_whatsapp, msg, tenant)
      .catch((e: any) => console.error('[GB] Order notification failed:', e.message));
  }

  return `Order #${orderNumber} created successfully! Total: ${total} ${currency}. The team has been notified.`;
}
