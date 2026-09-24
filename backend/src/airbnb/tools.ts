import Anthropic from '@anthropic-ai/sdk';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { sendWhatsAppMessage } from '../whatsapp/twilio.js';
import { setConversationListing } from './session.js';

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

export const airbnbTools: Anthropic.Tool[] = [
  {
    name: 'identify_listing',
    description: "Match the guest's own words (a property nickname, or an address if they don't know the nickname) to one of this host's listings. Call this as soon as you need to know which property the guest is at and you don't already know it. Never guess the listing yourself.",
    input_schema: {
      type: 'object' as const,
      properties: {
        guest_text: { type: 'string', description: "The guest's raw reply naming the property or its address" },
      },
      required: ['guest_text'],
    },
  },
  {
    name: 'get_faq',
    description: "Get the FAQ entries for the identified listing. Returns ALL of that listing's FAQs — decide which, if any, answers the guest's question. Never returns another listing's FAQs.",
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string', description: 'The identified listing ID' },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'create_request',
    description: "Log a maintenance, cleaning, or guest-issue request for the host to act on. This only records the request — it does NOT mean the task is done or scheduled. Never tell the guest it's completed or give a timeframe; only that the host has been notified and will confirm.",
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id:  { type: 'string', description: 'The identified listing ID' },
        category:    { type: 'string', description: "e.g. 'maintenance', 'cleaning', 'guest_issue', 'general'" },
        description: { type: 'string', description: 'Clear factual description of what is needed and where — write in English' },
      },
      required: ['listing_id', 'category', 'description'],
    },
  },
  {
    name: 'get_request_status',
    description: "Check the status of a guest's previously logged request(s) for this listing.",
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string', description: 'The identified listing ID' },
      },
      required: ['listing_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Fuzzy listing match — normalise both sides, then check substring
// containment (name-in-text, text-in-name) and address containment.
// No fuzzy-matching library dependency; good enough for short property names
// and addresses, and ambiguous/no matches always fall back to asking again
// rather than guessing.
// ---------------------------------------------------------------------------
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function matchListings(guestText: string, listings: any[]): any[] {
  const needle = normalise(guestText);
  if (!needle) return [];

  const scored = listings.map(l => {
    const name = normalise(l.name);
    const address = normalise(l.address);
    let score = 0;
    if (needle === name) score = 100;
    else if (name && (needle.includes(name) || name.includes(needle))) score = 80;
    else if (address && (needle.includes(address) || address.includes(needle))) score = 60;
    else {
      // Token overlap fallback — e.g. guest says "the loft downtown" for "Downtown Loft"
      const needleTokens = new Set(needle.split(' ').filter(t => t.length > 2));
      const nameTokens = name.split(' ').filter(t => t.length > 2);
      const overlap = nameTokens.filter(t => needleTokens.has(t)).length;
      if (overlap > 0 && nameTokens.length > 0) score = Math.round((overlap / nameTokens.length) * 50);
    }
    return { listing: l, score };
  }).filter(r => r.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(r => r.listing);
}

export async function executeAirbnbTool(
  toolName: string,
  toolInput: any,
  tenantId: string,
  conversationId: string,
): Promise<string> {
  try {
    if (toolName === 'identify_listing') return await handleIdentifyListing(toolInput, tenantId, conversationId);
    if (toolName === 'get_faq')            return await handleGetFaq(toolInput, tenantId, conversationId);
    if (toolName === 'create_request')     return await handleCreateRequest(toolInput, tenantId, conversationId);
    if (toolName === 'get_request_status') return await handleGetRequestStatus(toolInput, tenantId, conversationId);
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  } catch (e: any) {
    console.error(`[Airbnb Tool] ${toolName} error:`, e.message);
    return JSON.stringify({ error: e.message });
  }
}

// Resolves the listing_id to actually use: trust the agent's explicit value
// only if it belongs to this tenant, otherwise fall back to whatever is
// already persisted on the conversation. Guards against the agent passing a
// stale or malformed ID.
async function resolveListingId(explicit: string | undefined, tenantId: string, conversationId: string): Promise<string | null> {
  if (explicit) {
    const owned = await dbGet('SELECT id FROM airbnb_listings WHERE id = ? AND tenant_id = ?', explicit, tenantId) as any;
    if (owned) return owned.id;
  }
  const conv = await dbGet('SELECT listing_id FROM airbnb_conversations WHERE id = ?', conversationId) as any;
  return conv?.listing_id ?? null;
}

async function handleIdentifyListing(
  input: { guest_text: string },
  tenantId: string,
  conversationId: string,
): Promise<string> {
  const listings = await dbAll(
    'SELECT id, name, address FROM airbnb_listings WHERE tenant_id = ? AND is_active = true',
    tenantId,
  ) as any[];

  if (listings.length === 0) {
    return JSON.stringify({ matched: false, reason: 'no_listings_configured' });
  }
  if (listings.length === 1) {
    // Only one listing on this account — no ambiguity possible.
    await setConversationListing(conversationId, listings[0].id);
    return JSON.stringify({ matched: true, listing_id: listings[0].id, listing_name: listings[0].name });
  }

  const matches = matchListings(input.guest_text, listings);

  if (matches.length === 0) {
    return JSON.stringify({
      matched: false,
      candidates: listings.map(l => ({ id: l.id, name: l.name })),
    });
  }
  if (matches.length === 1 || (matches[0] && !matches[1])) {
    await setConversationListing(conversationId, matches[0].id);
    return JSON.stringify({ matched: true, listing_id: matches[0].id, listing_name: matches[0].name });
  }

  // Multiple plausible matches — ambiguous, ask rather than guess.
  return JSON.stringify({
    matched: false,
    ambiguous: true,
    candidates: matches.slice(0, 4).map(l => ({ id: l.id, name: l.name, address: l.address })),
  });
}

async function handleGetFaq(
  input: { listing_id?: string },
  tenantId: string,
  conversationId: string,
): Promise<string> {
  const listingId = await resolveListingId(input.listing_id, tenantId, conversationId);
  if (!listingId) return JSON.stringify({ faqs: [], count: 0 });

  // Return ALL FAQs for this listing — agent decides relevance semantically,
  // same pattern as hotel's get_faq_answer.
  const faqs = await dbAll(
    'SELECT question, answer, category FROM airbnb_faqs WHERE tenant_id = ? AND listing_id = ? ORDER BY category, question',
    tenantId, listingId,
  ) as any[];

  return JSON.stringify({ faqs, count: faqs.length });
}

// Finds the department whose name matches the request category
// (e.g. category 'cleaning' -> department named "Cleaning"), case-insensitive,
// matching either direction. No explicit request-type mapping column exists
// on airbnb_departments (unlike hotel_departments' request_types array) —
// the schema pairs category values with department name examples 1:1
// ('maintenance'/"Maintenance", 'cleaning'/"Cleaning"), so name matching is
// the intended mechanism here.
async function findMatchingDepartment(tenantId: string, category: string): Promise<any | null> {
  const depts = await dbAll(
    'SELECT * FROM airbnb_departments WHERE tenant_id = ? AND is_active = true',
    tenantId,
  ) as any[];
  if (depts.length === 0) return null;

  const needle = category.toLowerCase().trim();
  const matched = depts.find(d => {
    const name = String(d.name).toLowerCase().trim();
    return name === needle || name.includes(needle) || needle.includes(name);
  });
  return matched ?? null;
}

async function handleCreateRequest(
  input: { listing_id?: string; category: string; description: string },
  tenantId: string,
  conversationId: string,
): Promise<string> {
  const listingId = await resolveListingId(input.listing_id, tenantId, conversationId);
  if (!listingId) return JSON.stringify({ error: 'No listing identified yet — call identify_listing first.' });

  const [tenant, listing, matchedDept] = await Promise.all([
    dbGet('SELECT * FROM tenants WHERE id = ?', tenantId) as Promise<any>,
    dbGet('SELECT name FROM airbnb_listings WHERE id = ?', listingId) as Promise<any>,
    findMatchingDepartment(tenantId, input.category),
  ]);

  const id = crypto.randomUUID();
  await dbRun(
    `INSERT INTO airbnb_requests (id, tenant_id, listing_id, conversation_id, category, description, status, department_id)
     VALUES (?,?,?,?,?,?,'open',?)`,
    id, tenantId, listingId, conversationId, input.category, input.description, matchedDept?.id ?? null,
  );

  // Departments configured and matched -> notify that department. Otherwise
  // (no departments configured, or none match this category) fall back to
  // the host's own number — unchanged from before this feature existed.
  const notifyNumber = matchedDept?.notification_number || tenant?.owner_phone;
  if (notifyNumber) {
    const msg = [
      `🏠 New ${input.category} request — ${listing?.name || 'listing'}`,
      `Details: ${input.description}`,
      'Please check and confirm with the guest directly.',
    ].join('\n');
    sendWhatsAppMessage(notifyNumber, msg, tenant)
      .catch((e: any) => console.error('[Airbnb] Host notification failed:', e.message));
  }

  return JSON.stringify({ logged: true, request_id: id });
}

async function handleGetRequestStatus(
  input: { listing_id?: string },
  tenantId: string,
  conversationId: string,
): Promise<string> {
  const listingId = await resolveListingId(input.listing_id, tenantId, conversationId);
  if (!listingId) return JSON.stringify({ requests: [] });

  const requests = await dbAll(
    `SELECT category, description, status, created_at FROM airbnb_requests
     WHERE tenant_id = ? AND listing_id = ? AND conversation_id = ?
     ORDER BY created_at DESC LIMIT 5`,
    tenantId, listingId, conversationId,
  ) as any[];

  return JSON.stringify({ requests });
}
