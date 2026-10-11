import type { VercelRequest, VercelResponse } from '@vercel/node';
import { gameConfig } from '../src/game/gameConfig.js';
import { ROOM_CODE_RE, type Role, type RoomJoinResponse } from '../src/net/protocol.js';
import { clientIpHash, createLimitKey, limited } from './_lib/rateLimit.js';
import { ROOM_CODE_ALPHABET } from './_lib/redis.js';
import { getStore } from './_lib/store.js';
import { randomToken, sha256, tokenMatches } from './_lib/tokens.js';

const { codeLength, ttlSeconds, createLimitPerHour } = gameConfig.room;

function newCode(): string {
  let code = '';
  for (let i = 0; i < codeLength; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

const other = (role: Role): Role => (role === 'host' ? 'guest' : 'host');

/**
 * POST /api/rooms  { action: 'create' | 'join' | 'resume' | 'leave' | 'status' | 'result', ... }
 * Les jetons ne sont jamais stockés : seule leur empreinte SHA-256 l'est.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const store = getStore();
  const code = typeof body.code === 'string' ? body.code.toUpperCase() : '';
  const token = typeof body.token === 'string' ? body.token : '';

  try {
    switch (body.action) {
      case 'create': {
        const ip = clientIpHash(req.headers, req.socket?.remoteAddress);
        // Le store mémoire ne sert qu'en local (développement, tests) : pas de limite de création.
        if (store.kind === 'redis' && (await limited(createLimitKey(ip), createLimitPerHour, 3600))) {
          return res.status(429).json({ error: 'rate-limited' });
        }
        const hostToken = randomToken();
        for (let attempt = 0; attempt < 8; attempt++) {
          const c = newCode();
          if (await store.createRoom(c, sha256(hostToken), ttlSeconds)) {
            const out: RoomJoinResponse = { code: c, role: 'host', token: hostToken, peerPresent: false };
            return res.status(200).json(out);
          }
        }
        return res.status(503).json({ error: 'no-code' });
      }

      case 'join': {
        if (!ROOM_CODE_RE.test(code)) return res.status(400).json({ error: 'bad-code' });
        const guestToken = randomToken();
        const result = await store.claimGuest(code, sha256(guestToken));
        if (result === 'missing') return res.status(404).json({ error: 'not-found' });
        if (result === 'full') return res.status(409).json({ error: 'full' });
        await store.pushInbox(code, 'host', [{ type: 'peer-joined' }], ttlSeconds);
        const out: RoomJoinResponse = { code, role: 'guest', token: guestToken, peerPresent: true };
        return res.status(200).json(out);
      }

      case 'resume': {
        const room = ROOM_CODE_RE.test(code) ? await store.getRoom(code) : null;
        if (!room) return res.status(404).json({ error: 'not-found' });
        const role: Role | null = tokenMatches(token, room.hostTokenHash)
          ? 'host'
          : tokenMatches(token, room.guestTokenHash)
            ? 'guest'
            : null;
        if (!role) return res.status(403).json({ error: 'forbidden' });
        const peerPresent = role === 'guest' || room.guestTokenHash !== null;
        if (peerPresent) await store.pushInbox(code, other(role), [{ type: 'peer-joined' }], ttlSeconds);
        const out: RoomJoinResponse = { code, role, token, peerPresent };
        return res.status(200).json(out);
      }

      case 'leave': {
        const room = ROOM_CODE_RE.test(code) ? await store.getRoom(code) : null;
        if (!room) return res.status(200).json({ ok: true });
        const role: Role | null = tokenMatches(token, room.hostTokenHash)
          ? 'host'
          : tokenMatches(token, room.guestTokenHash)
            ? 'guest'
            : null;
        if (role) await store.pushInbox(code, other(role), [{ type: 'peer-left' }], ttlSeconds);
        return res.status(200).json({ ok: true });
      }

      case 'status': {
        const room = ROOM_CODE_RE.test(code) ? await store.getRoom(code) : null;
        if (!room || !tokenMatches(token, room.hostTokenHash)) return res.status(403).json({ error: 'forbidden' });
        const status = body.status;
        if (status !== 'waiting' && status !== 'playing' && status !== 'finished') {
          return res.status(400).json({ error: 'bad-status' });
        }
        await store.setStatus(code, status);
        return res.status(200).json({ ok: true });
      }

      case 'result': {
        const room = ROOM_CODE_RE.test(code) ? await store.getRoom(code) : null;
        if (!room || !tokenMatches(token, room.hostTokenHash)) return res.status(403).json({ error: 'forbidden' });
        const id = randomToken().slice(0, 16);
        await store.saveMatch(id, { code, ...(body.match as object), createdAt: Date.now() }, 30 * 24 * 3600);
        return res.status(200).json({ id });
      }

      default:
        return res.status(400).json({ error: 'bad-action' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'server', message: (e as Error).message });
  }
}
