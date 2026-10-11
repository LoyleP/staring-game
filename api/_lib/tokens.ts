import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function tokenMatches(token: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  const a = Buffer.from(sha256(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
