// Human-in-the-loop escalation — real dependencies for the save-as-FAQ step (stage 5).
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/database.js';
import { getModelForTenant } from '../utils/modelForTenant.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import {
  createFaqPrompter, createFaqDecider, FAQ_COMPOSE_SYSTEM, buildFaqComposePrompt,
  type PromptDeps, type DecideDeps, type FaqPromptRow, type FaqComposeInput,
} from './faq.js';

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function rows(sql: string, params: unknown[]): Promise<any[]> {
  return (await query(sql, params)) as any[];
}

const FAQ_ROW_COLUMNS = 'id, tenant_id, tenant_type, conversation_id, faq_decision, faq_question, faq_answer, faq_reask_count';

// ── Sending the prompt ────────────────────────────────────────────────────────

const promptDeps: PromptDeps = {
  async load(escalationId) {
    const [e] = await rows(
      `SELECT id, tenant_id, kind, staff_number, guest_question, staff_answer, guest_reply, faq_decision
       FROM staff_escalations WHERE id = ?`,
      [escalationId],
    );
    if (!e || !e.staff_answer || !e.guest_reply) return null;
    const [tenant] = await rows(`SELECT * FROM tenants WHERE id = ?`, [e.tenant_id]);
    if (!tenant) return null;
    return {
      id: String(e.id), tenant, kind: e.kind, staffNumber: e.staff_number,
      businessName: tenant.name || 'the business',
      guestQuestion: e.guest_question, staffAnswer: e.staff_answer, guestReply: e.guest_reply,
      alreadyPrompted: !!e.faq_decision,
    };
  },

  async compose(i: FaqComposeInput) {
    const response = await client.messages.create({
      model: await getModelForTenant(i.tenantId),
      max_tokens: 500,
      system: FAQ_COMPOSE_SYSTEM,
      messages: [{ role: 'user', content: buildFaqComposePrompt(i) }],
    });
    const block = response.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : null;
  },

  send: (tenant, to, text) => sendWhatsAppMessage(to, text, tenant),

  async save(escalationId, draft, messageId) {
    await query(
      `UPDATE staff_escalations
       SET faq_question = ?, faq_answer = ?, faq_prompt_message_id = ?, faq_decision = 'pending'
       WHERE id = ? RETURNING id`,
      [draft.question, draft.answer, messageId, escalationId],
    );
  },
};

export const sendFaqPrompt = createFaqPrompter(promptDeps);

// ── Looking up which FAQ prompt a staff message refers to ─────────────────────

export async function findFaqPromptByQuote(tenantId: string, staffNumber: string, quotedId: string): Promise<FaqPromptRow | null> {
  const [r] = await rows(
    `SELECT ${FAQ_ROW_COLUMNS} FROM staff_escalations
     WHERE tenant_id = ? AND faq_prompt_message_id = ? AND staff_number = ? LIMIT 1`,
    [tenantId, quotedId, staffNumber],
  );
  return r ?? null;
}

/** Prompts still waiting for YES/NO, newest first. Older than 24h no longer capture an un-quoted reply. */
export async function listPendingFaq(tenantId: string, staffNumber: string): Promise<FaqPromptRow[]> {
  return rows(
    `SELECT ${FAQ_ROW_COLUMNS} FROM staff_escalations
     WHERE tenant_id = ? AND staff_number = ? AND faq_decision = 'pending'
       AND answered_at > now() - interval '24 hours'
     ORDER BY answered_at DESC`,
    [tenantId, staffNumber],
  );
}

// ── Saving into the tenant type's own FAQ table ───────────────────────────────

const FAQ_QUESTION_TABLES: Record<string, string> = {
  hotel: 'hotel_faq', shop: 'shop_faq', general_business: 'gb_faqs', art_class: 'art_class_faq', airbnb: 'airbnb_faqs',
};

async function existingQuestions(tenantType: string, tenantId: string): Promise<string[]> {
  if (tenantType === 'skedai') {
    const [c] = await rows(`SELECT support_faq FROM skedai_config WHERE tenant_id = ?`, [tenantId]);
    return parseJsonArray(c?.support_faq).map((f: any) => String(f?.q ?? ''));
  }
  const table = FAQ_QUESTION_TABLES[tenantType];
  if (!table) throw new Error(`no FAQ table for tenant type ${tenantType}`);
  return (await rows(`SELECT question FROM ${table} WHERE tenant_id = ?`, [tenantId])).map(r => String(r.question));
}

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(String(raw || '[]')); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Same per-table insert shapes as faqGap/applyAction.ts (the report-email "Add to FAQ" button).
async function insertFaq(row: FaqPromptRow, question: string, answer: string): Promise<void> {
  const t = row.tenant_id;
  switch (row.tenant_type) {
    case 'hotel':
      await query(`INSERT INTO hotel_faq (id, tenant_id, question, answer, category, is_active) VALUES (?, ?, ?, ?, 'General', 1) RETURNING id`,
        [crypto.randomUUID(), t, question, answer]);
      return;
    case 'shop':
      await query(`INSERT INTO shop_faq (id, tenant_id, question, answer) VALUES (?, ?, ?, ?) RETURNING id`,
        [crypto.randomUUID(), t, question, answer]);
      return;
    case 'general_business':
      await query(`INSERT INTO gb_faqs (tenant_id, question, answer) VALUES (?, ?, ?) RETURNING id`, [t, question, answer]);
      return;
    case 'art_class':
      await query(`INSERT INTO art_class_faq (tenant_id, question, answer) VALUES (?, ?, ?) RETURNING id`, [t, question, answer]);
      return;
    case 'airbnb': {
      // Airbnb FAQs belong to a listing: use the listing this conversation is about.
      const [c] = await rows(`SELECT listing_id FROM airbnb_conversations WHERE id = ? AND tenant_id = ?`, [row.conversation_id, t]);
      if (!c?.listing_id) throw new Error('this conversation has no listing to attach the FAQ to');
      await query(`INSERT INTO airbnb_faqs (tenant_id, listing_id, question, answer) VALUES (?, ?, ?, ?) RETURNING id`,
        [t, c.listing_id, question, answer]);
      return;
    }
    case 'skedai': {
      const [c] = await rows(`SELECT support_faq FROM skedai_config WHERE tenant_id = ?`, [t]);
      const faqs = [...parseJsonArray(c?.support_faq), { id: crypto.randomBytes(6).toString('hex'), q: question, a: answer }];
      if (c) await query(`UPDATE skedai_config SET support_faq = ? WHERE tenant_id = ? RETURNING tenant_id`, [JSON.stringify(faqs), t]);
      else await query(`INSERT INTO skedai_config (tenant_id, support_faq) VALUES (?, ?) RETURNING tenant_id`, [t, JSON.stringify(faqs)]);
      return;
    }
    default:
      throw new Error(`no FAQ table for tenant type ${row.tenant_type}`);
  }
}

const decideDeps: DecideDeps = {
  existingQuestions,
  insertFaq,
  async setDecision(id, decision) {
    const r = await rows(`UPDATE staff_escalations SET faq_decision = ? WHERE id = ? AND faq_decision = 'pending' RETURNING id`, [decision, id]);
    return r.length > 0;
  },
  async reopen(id) {
    await query(`UPDATE staff_escalations SET faq_decision = 'pending' WHERE id = ? AND faq_decision = 'saved' RETURNING id`, [id]);
  },
  async markReasked(id) {
    await query(`UPDATE staff_escalations SET faq_reask_count = faq_reask_count + 1 WHERE id = ? RETURNING id`, [id]);
  },
};

export const decideFaq = createFaqDecider(decideDeps);
