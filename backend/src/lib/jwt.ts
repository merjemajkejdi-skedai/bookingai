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

export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    if (!loggedSource) {
      console.log(`[Auth] JWT_SECRET source: environment variable (length: ${process.env.JWT_SECRET.length})`);
      loggedSource = true;
    }
    return process.env.JWT_SECRET;
  }

  if (!loggedSource) {
    console.warn('[Auth] ⚠️ JWT_SECRET not set in environment — generating a temporary secret. All existing sessions will be invalidated on next restart.');
    loggedSource = true;
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
