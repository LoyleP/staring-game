import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { IceServerConfig } from '../src/net/protocol.js';

const TTL_SECONDS = 3600;
const STUN: IceServerConfig = { urls: ['stun:stun.l.google.com:19302'] };

type RawServer = { urls: string | string[]; username?: string; credential?: string };

const normalize = (servers: RawServer[]): IceServerConfig[] =>
  servers
    .map((s) => ({
      ...s,
      // Le port 53 expire dans les navigateurs (recommandation Cloudflare).
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !u.includes(':53')),
    }))
    .filter((s) => s.urls.length > 0);

/** Cloudflare Realtime TURN : identifiants temporaires (1 h). CF_TURN_KEY_ID + CF_TURN_API_TOKEN. */
async function cloudflare(): Promise<IceServerConfig[] | null> {
  const { CF_TURN_KEY_ID: id, CF_TURN_API_TOKEN: token } = process.env;
  if (!id || !token) return null;
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  });
  if (!res.ok) throw new Error(`cloudflare ${res.status}`);
  const data = (await res.json()) as { iceServers: RawServer[] };
  return normalize(data.iceServers);
}

/** Metered (dont Open Relay) : METERED_APP (ex. monapp.metered.live) + METERED_API_KEY. */
async function metered(): Promise<IceServerConfig[] | null> {
  const { METERED_APP: app, METERED_API_KEY: key } = process.env;
  if (!app || !key) return null;
  const res = await fetch(`https://${app}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`metered ${res.status}`);
  return normalize((await res.json()) as RawServer[]);
}

/** TURN statique : TURN_URLS (séparées par des virgules), TURN_USERNAME, TURN_CREDENTIAL. */
function fixed(): IceServerConfig[] | null {
  const urls = (process.env.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  const { TURN_USERNAME: username, TURN_CREDENTIAL: credential } = process.env;
  return urls.length && username && credential ? [{ urls, username, credential }] : null;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  let provider: string | null = null;
  let servers: IceServerConfig[] = [];
  try {
    for (const [name, get] of [['cloudflare', cloudflare], ['metered', metered], ['fixed', async () => fixed()]] as const) {
      const got = await get();
      if (got?.length) {
        servers = got;
        provider = name;
        break;
      }
    }
  } catch (e) {
    console.error('turn-credentials', (e as Error).message);
  }
  const hasStun = servers.some((s) => s.urls.some((u) => u.startsWith('stun:')));
  const iceServers = hasStun ? servers : [STUN, ...servers];
  res.status(200).json({ iceServers, turn: servers.some((s) => s.username), provider });
}
