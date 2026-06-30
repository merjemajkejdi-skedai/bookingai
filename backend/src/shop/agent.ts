import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { buildShopSystemPrompt } from './prompts.js';
import { shopTools, executeShopTool } from './tools.js';
import { sendWhatsAppMedia } from '../whatsapp/twilio.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function dbGet(sql: string, ...p: unknown[]) { return (isPg ? queryOne(sql, p) : prepare(sql).get(...p)) as any; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

/**
 * Calls Claude API with automatic retry on 500/529 errors.
 * Waits 3 seconds between attempts.
 */
async function callClaudeWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  maxRetries = 1,
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err: any) {
      const isRetryable = err.status === 500 || err.status === 529;
      if (attempt < maxRetries && isRetryable) {
        console.log(`[Shop] Claude error ${err.status} (attempt ${attempt + 1}) — retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('callClaudeWithRetry: exhausted retries');
}

export async function runShopAgent(
  message: string,
  guestPhone: string,
  tenantId: string,
): Promise<string> {
  console.log('[Shop] *** runShopAgent called, tenantId:', tenantId, 'phone:', guestPhone);
  console.log(`[Shop] runShopAgent tenantId=${tenantId} phone=${guestPhone}`);
  console.log('[Shop] tools loaded:', shopTools.map(t => t.name));

  try {
    const [config, tenant] = await Promise.all([
      dbGet(`SELECT * FROM shop_config WHERE tenant_id = ?`, tenantId),
      dbGet(`SELECT * FROM tenants WHERE id = ?`, tenantId),
    ]);

    const { getCurrentDeliveryTime } = await import('../services/deliveryTime.js');
    const deliveryInfo = await getCurrentDeliveryTime(tenantId);

    // Load or create conversation record
    let conv = await dbGet(
      `SELECT * FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?`,
      tenantId, guestPhone,
    );

    if (!conv) {
      const convId = crypto.randomUUID();
      const now = new Date().toISOString();
      await dbRun(
        `INSERT INTO shop_conversations (id, tenant_id, guest_phone, messages, cart, cart_state, created_at, updated_at) VALUES (?,?,?,'[]','[]','idle',?,?)`,
        convId, tenantId, guestPhone, now, now,
      );
      conv = { id: convId, messages: '[]' };
      console.log(`[Shop] created conversation ${convId} for ${guestPhone}`);
    }

    // Parse stored history
    const storedMessages: Array<{ role: string; content: string }> = (() => {
      try { return JSON.parse(conv.messages || '[]'); } catch { return []; }
    })();

    const history: Anthropic.MessageParam[] = storedMessages
      .slice(-6)
      .filter((m: any) => m.content && m.content.trim())
      .map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    history.push({ role: 'user', content: message });

    const systemPrompt = buildShopSystemPrompt(tenant, config, deliveryInfo);
    const messages = [...history];
    let finalReply = '';
    let pendingMenuPdf: { url: string; label: string } | null = null;

    // Agentic tool-use loop
    while (true) {
      console.log('[Shop] calling Claude with', shopTools.length, 'tools, messages:', messages.length);
      const response = await callClaudeWithRetry(anthropic, {
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools: shopTools,
        tool_choice: { type: 'auto' },
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          try {
            const result = await executeShopTool(block.name, block.input as any, tenantId, guestPhone);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });

            // Track a single PDF document to send after the text reply
            if (block.name === 'get_menu_documents' && result.found && Array.isArray(result.documents)) {
              const pdfs = result.documents.filter((d: any) => d.type === 'pdf' && d.value);
              if (pdfs.length === 1) {
                pendingMenuPdf = { url: pdfs[0].value, label: pdfs[0].label };
              } else {
                pendingMenuPdf = null; // multi-PDF or no PDF: Claude handles via text
              }
            }
          } catch (toolErr: any) {
            console.error(`[Shop] tool ${block.name} threw:`, toolErr.message);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: toolErr.message, success: false }),
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      for (const block of response.content) {
        if (block.type === 'text') finalReply += block.text;
      }
      break;
    }

    // Send pending PDF document after the text reply
    if (pendingMenuPdf && finalReply) {
      try {
        await sendWhatsAppMedia(guestPhone, pendingMenuPdf.url, pendingMenuPdf.label, tenant);
        console.log('[Shop] ✅ Menu PDF sent:', pendingMenuPdf.label);
      } catch (pdfErr: any) {
        console.error('[Shop] Menu PDF send failed:', pdfErr.message);
      }
    }

    // Reset consecutive error counter on success (fire-and-forget, must not break reply)
    dbRun(
      `UPDATE shop_conversations SET consecutive_errors = 0 WHERE tenant_id = ? AND guest_phone = ?`,
      tenantId, guestPhone,
    ).catch(() => {});

    // Persist conversation — keep last 40 messages (~20 turns) to avoid unbounded growth
    const updatedHistory = [
      ...storedMessages,
      { role: 'user', content: message },
      { role: 'assistant', content: finalReply },
    ].slice(-40);

    await dbRun(
      `UPDATE shop_conversations SET messages = ?, updated_at = ? WHERE tenant_id = ? AND guest_phone = ?`,
      JSON.stringify(updatedHistory), new Date().toISOString(), tenantId, guestPhone,
    );

    return finalReply;

  } catch (err: any) {
    console.error('[Shop] Agent error:', err.message);

    try {
      const cfg = await dbGet(
        `SELECT fallback_message, fallback_backup_number, fallback_after_attempts FROM shop_config WHERE tenant_id = ?`,
        tenantId,
      );

      // Increment consecutive error count then read back the new value
      await dbRun(
        `UPDATE shop_conversations SET consecutive_errors = COALESCE(consecutive_errors, 0) + 1 WHERE tenant_id = ? AND guest_phone = ?`,
        tenantId, guestPhone,
      );
      const convAfter = await dbGet(
        `SELECT consecutive_errors FROM shop_conversations WHERE tenant_id = ? AND guest_phone = ?`,
        tenantId, guestPhone,
      );
      const errorCount: number = convAfter?.consecutive_errors || 1;

      const fallbackMsg   = cfg?.fallback_message || 'We are temporarily unable to process your order online.';
      const backupNumber  = cfg?.fallback_backup_number as string | undefined;
      const afterAttempts = cfg?.fallback_after_attempts ?? 1;

      let reply = fallbackMsg;
      if (backupNumber && errorCount >= afterAttempts) {
        reply += `\n\nPlease contact us directly on WhatsApp:\n📱 ${backupNumber}`;
      }
      return reply;

    } catch (fallbackErr: any) {
      console.error('[Shop] Fallback config load failed:', fallbackErr.message);
      return 'We are temporarily unavailable. Please try again shortly.';
    }
  }
}
