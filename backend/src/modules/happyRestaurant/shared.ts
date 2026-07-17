import { Response } from 'express';
import { isPg, prepare, query, queryOne, queryRun } from '../../db/database.js';

export async function dbAll(sql: string, ...params: unknown[]) {
  return (isPg ? query(sql, params) : prepare(sql).all(...params)) as any[];
}
export async function dbGet(sql: string, ...params: unknown[]) {
  return (isPg ? queryOne(sql, params) : prepare(sql).get(...params)) as any;
}
export async function dbRun(sql: string, ...params: unknown[]) {
  if (isPg) return queryRun(sql, params);
  prepare(sql).run(...params);
}

export const ok  = <T>(res: Response, data: T) => res.json({ success: true, data });
export const err = (res: Response, msg: string, status = 400) =>
  res.status(status).json({ success: false, error: msg });

export const HAPPY_VENUE_TYPES = ['happy_restaurant', 'happy_bar', 'happy_hybrid'] as const;
export const HAPPY_ROLES = ['waiter', 'manager', 'kitchen', 'bar', 'admin'] as const;

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const boolOut = (v: unknown) => v === true || v === 1 || v === '1';
