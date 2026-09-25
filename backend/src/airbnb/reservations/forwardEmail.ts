import { createHash } from 'crypto';
import { isPg, prepare, query, queryRun } from '../../db/database.js';

// Reuses the domain the Mailgun inbound route already receives for hotel
// review forwarding (reviews.skedai.net) — no new DNS/Mailgun route needed
// as long as that route catches the whole domain. Override with
// RESERVATION_EMAIL_DOMAIN if a dedicated domain is set up later.
const DOMAIN = (process.env.RESERVATION_EMAIL_DOMAIN || 'reviews.skedai.net').toLowerCase();

async function dbAll(sql: string, ...p: unknown[]) { return (isPg ? query(sql, p) : prepare(sql).all(...p)) as any[]; }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

// Deterministic from the listing id, so it never needs to be looked up to be
// regenerated, and the unique index catches the (astronomically unlikely)
// collision. The "res-" prefix keeps it in its own namespace next to
// hotels' chosen review slugs, and the webhook checks listings first.
export function forwardEmailForListing(listingId: string): string {
  return `res-${listingId.replace(/-/g, '').slice(0, 10)}@${DOMAIN}`.toLowerCase();
}

// One per tenant, for listings that opt into sharing instead of using their
// own dedicated address. Hashed rather than sliced from the id since tenant ids
// aren't all UUIDs. "res-t-" can't collide with a listing address
// ("res-<hex>" has no second dash) or a hotel's chosen review slug in practice.
export function sharedForwardEmailForTenant(tenantId: string): string {
  const hash = createHash('sha1').update(tenantId).digest('hex').slice(0, 10);
  return `res-t-${hash}@${DOMAIN}`.toLowerCase();
}

// Fills confirmation_forward_email for any of this tenant's listings that
// don't have one yet (listings created before this feature existed), and the
// tenant's shared address.
export async function ensureForwardEmails(tenantId: string): Promise<void> {
  await dbRun(
    'UPDATE tenants SET shared_confirmation_forward_email = ? WHERE id = ? AND shared_confirmation_forward_email IS NULL',
    sharedForwardEmailForTenant(tenantId), tenantId,
  );
  const missing = await dbAll(
    'SELECT id FROM airbnb_listings WHERE tenant_id = ? AND confirmation_forward_email IS NULL',
    tenantId,
  );
  for (const row of missing) {
    await dbRun(
      'UPDATE airbnb_listings SET confirmation_forward_email = ? WHERE id = ? AND confirmation_forward_email IS NULL',
      forwardEmailForListing(row.id), row.id,
    );
  }
}
