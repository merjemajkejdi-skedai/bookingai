import type { FiscalMiddleware } from './types.js';
import { nexiaMiddleware, getNexiaUrl } from './nexia.js';
import { otherMiddleware, getOtherUrl } from './other.js';

const MIDDLEWARES: Record<string, FiscalMiddleware> = {
  nexia: nexiaMiddleware,
  other: otherMiddleware,
};

export function getMiddleware(name: string): FiscalMiddleware {
  return MIDDLEWARES[name] || MIDDLEWARES['nexia'];
}

export function getAllMiddlewares(): { value: string; label: string }[] {
  return Object.values(MIDDLEWARES).map(m => ({ value: m.name, label: m.displayName }));
}

export function getMiddlewareUrl(
  middleware:  string,
  environment: 'test' | 'production',
): string {
  switch (middleware) {
    case 'nexia': return getNexiaUrl(environment);
    case 'other': return getOtherUrl(environment);
    default:      return getNexiaUrl(environment);
  }
}
