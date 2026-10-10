import { Redis } from '@upstash/redis';

/** Les identifiants sont injectés par l'intégration Vercel Marketplace (KV_REST_API_* ou UPSTASH_REDIS_REST_*). */
export const redis = Redis.fromEnv();

export const keys = {
  room: (code: string) => `room:${code}`,
  roomChannel: (code: string) => `room:${code}:events`,
  inbox: (code: string, role: 'host' | 'guest') => `room:${code}:inbox:${role}`,
  match: (id: string) => `match:${id}`,
  rateCreate: (ipHash: string) => `ratelimit:create:${ipHash}`,
} as const;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
