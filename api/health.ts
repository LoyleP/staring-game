import { redis } from './_lib/redis.js';

export default async function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    await redis.set('health:ping', '1', { ex: 30 });
    const ok = (await redis.get('health:ping')) !== null;
    res.status(ok ? 200 : 500).json({ redis: ok });
  } catch (e) {
    res.status(500).json({ redis: false, error: (e as Error).message });
  }
}
