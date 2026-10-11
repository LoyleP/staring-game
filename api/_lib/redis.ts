import { Redis } from '@upstash/redis';

/** Les identifiants sont injectés par l'intégration Vercel Marketplace (KV_REST_API_* ou UPSTASH_REDIS_REST_*). */
export function redisConfigured(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

let client: Redis | null = null;
export function getRedis(): Redis {
  client ??= Redis.fromEnv();
  return client;
}

export const keys = {
  room: (code: string) => `room:${code}`,
  inbox: (code: string, role: 'host' | 'guest') => `room:${code}:inbox:${role}`,
  match: (id: string) => `match:${id}`,
  rateCreate: (ipHash: string) => `ratelimit:create:${ipHash}`,
} as const;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
