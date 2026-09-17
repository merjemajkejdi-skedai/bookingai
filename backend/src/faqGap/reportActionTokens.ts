// reportActionTokens.ts — signs/verifies the no-login-required "Add to FAQ" /
// "Dismiss" links sent in the owner report email. Reuses the same JWT secret
// as dashboard login sessions (lib/jwt.ts) rather than inventing a new one.
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../lib/jwt.js';

export interface ReportActionPayload {
  questionId: string;
  action: 'add' | 'dismiss';
}

export function signReportActionToken(questionId: string, action: 'add' | 'dismiss'): string {
  return jwt.sign({ questionId, action }, getJwtSecret(), { expiresIn: '30d' });
}

export function verifyReportActionToken(token: string | undefined): ReportActionPayload | null {
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret()) as ReportActionPayload;
  } catch {
    return null;
  }
}

// Same fallback chain routes/shop.ts uses for building an absolute backend URL.
function backendBaseUrl(): string {
  return process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.VITE_API_URL || 'http://localhost:3001';
}

export function buildReportActionUrl(questionId: string, action: 'add' | 'dismiss'): string {
  const token = signReportActionToken(questionId, action);
  return `${backendBaseUrl()}/report-actions/faq/${questionId}/${action}?token=${encodeURIComponent(token)}`;
}
