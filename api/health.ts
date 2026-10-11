import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStore } from './_lib/store.js';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const store = getStore();
    const ok = await store.ping();
    res.status(ok ? 200 : 500).json({ store: store.kind, ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
