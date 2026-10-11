import type { VercelRequest, VercelResponse } from '@vercel/node';
import { gameConfig } from '../src/game/gameConfig.js';
import { ROOM_CODE_RE, type Role, type SignalMessage } from '../src/net/protocol.js';
import { getStore } from './_lib/store.js';
import { tokenMatches } from './_lib/tokens.js';

const MAX_MESSAGES = 50;
const MAX_BYTES = 16 * 1024;
const RELAYED = new Set(['offer', 'answer', 'ice-candidate', 'relay']);

/**
 * Signalisation de secours par HTTP : envoie les messages sortants et renvoie ceux en attente,
 * en une seule requête. POST { code, token, send?: SignalMessage[] } → { messages }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const body = (req.body ?? {}) as { code?: string; token?: string; send?: unknown };
  const code = (body.code ?? '').toUpperCase();
  const token = body.token ?? '';
  if (!ROOM_CODE_RE.test(code)) return res.status(400).json({ error: 'bad-code' });

  try {
    const store = getStore();
    const room = await store.getRoom(code);
    if (!room) return res.status(404).json({ error: 'not-found' });
    const role: Role | null = tokenMatches(token, room.hostTokenHash)
      ? 'host'
      : tokenMatches(token, room.guestTokenHash)
        ? 'guest'
        : null;
    if (!role) return res.status(403).json({ error: 'forbidden' });

    const send = Array.isArray(body.send) ? (body.send as SignalMessage[]) : [];
    if (send.length > MAX_MESSAGES || JSON.stringify(send).length > MAX_BYTES) {
      return res.status(413).json({ error: 'too-large' });
    }
    const valid = send.filter((m) => m && typeof m.type === 'string' && RELAYED.has(m.type));
    await store.pushInbox(code, role === 'host' ? 'guest' : 'host', valid, gameConfig.room.ttlSeconds);

    return res.status(200).json({ messages: await store.popInbox(code, role) });
  } catch (e) {
    return res.status(500).json({ error: 'server', message: (e as Error).message });
  }
}
