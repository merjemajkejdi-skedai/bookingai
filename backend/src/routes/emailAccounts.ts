import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireAuth, resolveTenantId } from '../middleware/auth.js';
import { isPg, prepare, query, queryOne, queryRun } from '../db/database.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { ImapSmtpAdapter } from '../channels/email/ImapSmtpAdapter.js';
import { GraphAdapter } from '../channels/email/GraphAdapter.js';
import type { EmailAccountRow } from '../channels/email/types.js';

export const emailAccountsRouter = Router();

async function dbAll(sql: string, ...p: unknown[]) { return isPg ? query(sql, p) : prepare(sql).all(...p); }
async function dbGet(sql: string, ...p: unknown[]) { return isPg ? queryOne(sql, p) : prepare(sql).get(...p); }
async function dbRun(sql: string, ...p: unknown[]) { if (isPg) return queryRun(sql, p); prepare(sql).run(...p); }

const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
const err = (res: Response, msg: string, code = 400) =>
  res.status(code).json({ success: false, error: msg });

function scrubAccount(row: any): any {
  const out = { ...row };
  delete out.password_enc;
  delete out.oauth_access_token_enc;
  delete out.oauth_refresh_token_enc;
  return out;
}

function buildAdapter(account: EmailAccountRow) {
  return account.provider === 'graph'
    ? new GraphAdapter(account)
    : new ImapSmtpAdapter(account);
}

// ---------------------------------------------------------------------------
// GET /hotel/email/accounts
// ---------------------------------------------------------------------------
emailAccountsRouter.get('/accounts', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT * FROM tenant_email_accounts WHERE tenant_id = ? ORDER BY created_at`,
      tenantId,
    );
    ok(res, rows.map(scrubAccount));
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// POST /hotel/email/accounts
// ---------------------------------------------------------------------------
emailAccountsRouter.post('/accounts', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const b = req.body as any;
  if (!b.email_address || !b.provider) return err(res, 'email_address and provider are required');
  if (b.provider !== 'imap' && b.provider !== 'graph') return err(res, 'provider must be imap or graph');
  if (b.provider === 'imap' && (!b.imap_host || !b.smtp_host)) return err(res, 'imap_host and smtp_host are required for IMAP accounts');

  try {
    const id = crypto.randomUUID();
    const passwordEnc = b.password ? encrypt(b.password) : null;
    await dbRun(
      `INSERT INTO tenant_email_accounts
         (id, tenant_id, provider, email_address, display_name,
          imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
          username, password_enc, watch_folder, answered_folder, failed_folder,
          is_enabled, ai_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, tenantId, b.provider, b.email_address.toLowerCase().trim(),
      b.display_name ?? '', b.imap_host ?? null,
      b.imap_port ?? 993, b.imap_secure != null ? (b.imap_secure ? 1 : 0) : 1,
      b.smtp_host ?? null, b.smtp_port ?? 587,
      b.smtp_secure != null ? (b.smtp_secure ? 1 : 0) : 0,
      b.username ?? null, passwordEnc,
      b.watch_folder ?? 'SkedAI', b.answered_folder ?? 'SkedAI/Answered',
      b.failed_folder ?? 'SkedAI/Failed', 0, 0,
    );
    const row = await dbGet('SELECT * FROM tenant_email_accounts WHERE id = ?', id);
    ok(res, scrubAccount(row));
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// PUT /hotel/email/accounts/:id
// ---------------------------------------------------------------------------
emailAccountsRouter.put('/accounts/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const b = req.body as any;
  const allowed = ['display_name', 'imap_host', 'imap_port', 'imap_secure', 'smtp_host',
    'smtp_port', 'smtp_secure', 'username', 'watch_folder', 'answered_folder', 'failed_folder'];
  const updates = allowed.filter(f => b[f] !== undefined);

  if (b.password !== undefined) updates.push('password_enc');

  if (!updates.length) return ok(res, { updated: false });

  try {
    const setClause = updates.map(f => `${f} = ?`).join(', ');
    const values = updates.map(f => {
      if (f === 'password_enc') return b.password ? encrypt(b.password) : null;
      return b[f];
    });
    await dbRun(
      `UPDATE tenant_email_accounts SET ${setClause} WHERE id = ? AND tenant_id = ?`,
      ...values, req.params.id, tenantId,
    );
    ok(res, { updated: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// DELETE /hotel/email/accounts/:id
// ---------------------------------------------------------------------------
emailAccountsRouter.delete('/accounts/:id', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    await dbRun(
      'DELETE FROM tenant_email_accounts WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    );
    ok(res, { deleted: true });
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// PUT /hotel/email/accounts/:id/toggle
// ---------------------------------------------------------------------------
emailAccountsRouter.put('/accounts/:id/toggle', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const { field } = req.body as { field: 'is_enabled' | 'ai_enabled' };
  if (!['is_enabled', 'ai_enabled'].includes(field)) return err(res, 'field must be is_enabled or ai_enabled');
  try {
    await dbRun(
      `UPDATE tenant_email_accounts SET ${field} = CASE WHEN ${field} = 1 THEN 0 ELSE 1 END
       WHERE id = ? AND tenant_id = ?`,
      req.params.id, tenantId,
    );
    const row = await dbGet('SELECT * FROM tenant_email_accounts WHERE id = ?', req.params.id);
    ok(res, scrubAccount(row));
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// POST /hotel/email/accounts/:id/test
// ---------------------------------------------------------------------------
emailAccountsRouter.post('/accounts/:id/test', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      'SELECT * FROM tenant_email_accounts WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as EmailAccountRow | undefined;
    if (!row) return err(res, 'Account not found', 404);
    const adapter = buildAdapter(row);
    const result = await adapter.testConnection();
    ok(res, result);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// GET /hotel/email/accounts/:id/folders
// ---------------------------------------------------------------------------
emailAccountsRouter.get('/accounts/:id/folders', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const row = await dbGet(
      'SELECT * FROM tenant_email_accounts WHERE id = ? AND tenant_id = ?',
      req.params.id, tenantId,
    ) as EmailAccountRow | undefined;
    if (!row) return err(res, 'Account not found', 404);
    const adapter = buildAdapter(row);
    await adapter.connect();
    const folders = await adapter.listFolders();
    await adapter.disconnect();
    ok(res, folders);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// GET /hotel/email/oauth/microsoft  — start OAuth flow
// ---------------------------------------------------------------------------
emailAccountsRouter.get('/oauth/microsoft', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const state = crypto.randomBytes(16).toString('hex');
  const url = GraphAdapter.authUrl(tenantId, state);
  res.redirect(url);
});

// ---------------------------------------------------------------------------
// GET /hotel/email/oauth/callback  — exchange code, store encrypted tokens
// ---------------------------------------------------------------------------
emailAccountsRouter.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;
  if (oauthError) return res.send(`OAuth error: ${oauthError}`);
  if (!code || !state) return res.send('Missing code or state');

  let tenantId: string;
  try {
    const parsed = JSON.parse(state);
    tenantId = parsed.tenantId;
  } catch {
    return res.send('Invalid state parameter');
  }

  try {
    const tokens = await GraphAdapter.exchangeCode(code);

    // Fetch the user's email address from Graph
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,displayName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user: any = await userRes.json();
    const emailAddress = (user.mail ?? '').toLowerCase().trim();
    if (!emailAddress) return res.send('Could not determine email address from Microsoft account');

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO tenant_email_accounts
         (id, tenant_id, provider, email_address, display_name,
          oauth_access_token_enc, oauth_refresh_token_enc, oauth_expires_at, oauth_email,
          watch_folder, answered_folder, failed_folder, is_enabled, ai_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (tenant_id, email_address) DO UPDATE SET
         oauth_access_token_enc = excluded.oauth_access_token_enc,
         oauth_refresh_token_enc = excluded.oauth_refresh_token_enc,
         oauth_expires_at = excluded.oauth_expires_at`,
      id, tenantId, 'graph', emailAddress, user.displayName ?? emailAddress,
      encrypt(tokens.access_token), encrypt(tokens.refresh_token),
      expiresAt, emailAddress,
      'SkedAI', 'SkedAI/Answered', 'SkedAI/Failed', 0, 0,
    );

    // Redirect back to the app
    const appUrl = process.env.APP_URL ?? 'https://app.skedai.net';
    res.redirect(`${appUrl}?oauth_success=email`);
  } catch (e: any) {
    console.error('[EmailOAuth] callback error:', e.message);
    res.send(`OAuth callback error: ${e.message}`);
  }
});

// ---------------------------------------------------------------------------
// GET /hotel/email/conversations  — list email conversations for this tenant
// ---------------------------------------------------------------------------
emailAccountsRouter.get('/conversations', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT c.id, c.channel, c.channel_user_id, c.subject, c.updated_at,
              m.from_name, m.from_address, m.body_text as last_body
       FROM hotel_conversations c
       LEFT JOIN email_messages m ON m.id = (
         SELECT id FROM email_messages
         WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
       )
       WHERE c.tenant_id = ? AND c.channel = 'email'
       ORDER BY c.updated_at DESC LIMIT 100`,
      tenantId,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});

// ---------------------------------------------------------------------------
// GET /hotel/email/conversations/:id/messages
// ---------------------------------------------------------------------------
emailAccountsRouter.get('/conversations/:id/messages', requireAuth, async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  try {
    const rows = await dbAll(
      `SELECT id, direction, from_address, from_name, to_address, subject, body_text, created_at
       FROM email_messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at`,
      tenantId, req.params.id,
    );
    ok(res, rows);
  } catch (e: any) { err(res, e.message, 500); }
});
