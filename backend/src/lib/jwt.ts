import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SECRET_FILE = path.join(process.cwd(), 'data', '.jwt_secret');

// Returns JWT_SECRET from env, or generates + persists one automatically.
// This means you never need to set JWT_SECRET manually in dev.
// In production on AWS, set JWT_SECRET in Secrets Manager / .env — it takes priority.
export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

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
