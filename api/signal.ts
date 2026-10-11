import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { gameConfig } from '../src/game/gameConfig.js';
import { ROOM_CODE_RE, type Role, type SignalMessage } from '../src/net/protocol.js';
import { getStore } from './_lib/store.js';
import { tokenMatches } from './_lib/tokens.js';

const MAX_BYTES = 16 * 1024;
const MAX_PER_SECOND = 50;
const RELAYED = new Set(['offer', 'answer', 'ice-candidate', 'relay']);

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES });

/**
 * Chaque joueur a une boîte aux lettres (la même que le repli par polling) : un message pour l'autre joueur
 * y est déposé puis un signal de réveil est publié ; l'instance qui tient la connexion de l'autre joueur vide
 * sa boîte et lui transmet. Les deux modes de transport restent ainsi interopérables entre instances.
 */
async function onConnection(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? '', 'http://localhost');
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  const token = url.searchParams.get('token') ?? '';
  const store = getStore();

  let role: Role | null = null;
  try {
    const room = ROOM_CODE_RE.test(code) ? await store.getRoom(code) : null;
    if (room) {
      role = tokenMatches(token, room.hostTokenHash) ? 'host' : tokenMatches(token, room.guestTokenHash) ? 'guest' : null;
    }
  } catch {
    return ws.close(1011, 'server');
  }
  if (!role) return ws.close(4401, 'forbidden');
  const other: Role = role === 'host' ? 'guest' : 'host';

  let chain: Promise<void> = Promise.resolve();
  const flush = () => {
    chain = chain
      .then(async () => {
        for (const m of await store.popInbox(code, role)) {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
        }
      })
      .catch(() => undefined);
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = store.subscribeInbox(code, role, flush);
  } catch {
    return ws.close(1011, 'server');
  }
  flush(); // messages arrivés avant la connexion (ex. peer-joined)

  let windowStart = Date.now();
  let count = 0;
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 1000) [windowStart, count] = [now, 0];
    if (++count > MAX_PER_SECOND) return ws.close(4429, 'rate');
    let m: SignalMessage | { type: 'ping' };
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (m.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    if (!RELAYED.has(m.type)) return;
    chain = chain
      .then(() => store.pushInbox(code, other, [m as SignalMessage], gameConfig.room.ttlSeconds))
      .catch(() => undefined);
  });
  ws.on('close', () => unsubscribe());
  ws.on('error', () => unsubscribe());
}

wss.on('connection', (ws, req) => void onConnection(ws, req));

/** Utilisé par le serveur de développement Vite (voir scripts/vite-api-plugin.ts). */
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}

// Vercel Functions : un serveur http dont les requêtes Upgrade sont traitées par `ws`.
const server = http.createServer((_req, res) => {
  res.statusCode = 426;
  res.end('Upgrade Required');
});
server.on('upgrade', upgrade);

export default server;
