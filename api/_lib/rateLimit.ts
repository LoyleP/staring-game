import type { IncomingHttpHeaders } from 'node:http';
import { keys } from './redis.js';
import { sha256 } from './tokens.js';
import { getStore } from './store.js';

export function clientIpHash(headers: IncomingHttpHeaders, remote?: string): string {
  const fwd = headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? remote ?? 'unknown';
  return sha256(ip).slice(0, 32);
}

/** Renvoie true si la limite est dépassée. */
export async function limited(key: string, max: number, windowSeconds: number): Promise<boolean> {
  return (await getStore().incrementCounter(key, windowSeconds)) > max;
}

export const createLimitKey = (ipHash: string) => keys.rateCreate(ipHash);
