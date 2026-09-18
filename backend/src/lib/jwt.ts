import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SECRET_FILE = path.join(process.cwd(), 'data', '.jwt_secret');

// Returns JWT_SECRET from env, or generates + persists one automatically.
// This means you never need to set JWT_SECRET manually in dev.
// In production, set JWT_SECRET as a real environment variable — Railway has
// no persistent volume configured for this app, so anything written to
// data/.jwt_secret does not survive a redeploy or restart, and the fallback
// below would silently generate a new secret each time, invalidating every
// existing session's token.
let loggedSource = false;

// Fire-and-forget — getJwtSecret() is called synchronously from jwt.sign/
// jwt.verify call sites, so this can't be awaited here. Read by the JWT
// health check (monitoring/healthChecks.ts) instead of re-parsing logs.
function recordJwtSecretSource(source: 'environment' | 'fallback'): void {
  import('../db/database.js')
    .then(({ isPg, queryRun }) => {
      if (!isPg) return;
      return queryRun(
        `INSERT INTO system_status (key, value, updated_at) VALUES ('jwt_secret_source', ?, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [source],
      );
    })
    .catch((e: any) => console.warn('[system_status] jwt_secret_source write failed:', e.message));
}

export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    if (!loggedSource) {
      console.log(`[Auth] JWT_SECRET source: environment variable (length: ${process.env.JWT_SECRET.length})`);
      loggedSource = true;
      recordJwtSecretSource('environment');
    }
    return process.env.JWT_SECRET;
  }

  if (!loggedSource) {
    console.warn('[Auth] ⚠️ JWT_SECRET not set in environment — generating a temporary secret. All existing sessions will be invalidated on next restart.');
    loggedSource = true;
    recordJwtSecretSource('fallback');
  }

  // Try to load persisted secret
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }

  // Generate a new 64-byte hex secret and persist it
  const secret = crypto.randomBytes(64).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 }); // owner-only read
  console.log('🔑 Generated new JWT secret — saved to data/.jwt_secret');
  return secret;
}
