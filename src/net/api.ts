import type { IceServerConfig, Role, RoomJoinResponse } from './protocol';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function post<T>(path: string, body: unknown, keepalive = false): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server');
  return data;
}

const storageKey = (code: string) => `aura.room.${code}`;

export interface Session {
  token: string;
  role: Role;
}

/** Le jeton survit à un rechargement (sessionStorage) mais pas à la fermeture de l'onglet. */
export function savedSession(code: string): Session | null {
  try {
    const raw = sessionStorage.getItem(storageKey(code));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(code: string, s: Session): void {
  try {
    sessionStorage.setItem(storageKey(code), JSON.stringify(s));
  } catch {
    // stockage indisponible : le rechargement refera une jonction
  }
}

export function clearSession(code: string): void {
  try {
    sessionStorage.removeItem(storageKey(code));
  } catch {
    // ignoré
  }
}

export async function createRoom(): Promise<RoomJoinResponse> {
  const r = await post<RoomJoinResponse>('/api/rooms', { action: 'create' });
  saveSession(r.code, { token: r.token, role: r.role });
  return r;
}

const inFlight = new Map<string, Promise<RoomJoinResponse>>();

/** Reprend la place sauvegardée, sinon rejoint le salon. Les appels simultanés partagent la même requête. */
export function enterRoom(code: string): Promise<RoomJoinResponse> {
  const existing = inFlight.get(code);
  if (existing) return existing;
  const saved = savedSession(code);
  const p = (async () => {
    if (saved) {
      try {
        return await post<RoomJoinResponse>('/api/rooms', { action: 'resume', code, token: saved.token });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 429) throw e;
        clearSession(code);
      }
    }
    const r = await post<RoomJoinResponse>('/api/rooms', { action: 'join', code });
    saveSession(code, { token: r.token, role: r.role });
    return r;
  })();
  inFlight.set(code, p);
  // Libère le cache après un court délai : le double montage de React réutilise la même requête.
  const release = () => setTimeout(() => inFlight.delete(code), 1500);
  p.then(release, release);
  return p;
}

export function leaveRoom(code: string, token: string): void {
  void post('/api/rooms', { action: 'leave', code, token }, true).catch(() => undefined);
}

export async function fetchIceServers(): Promise<IceServerConfig[]> {
  try {
    const res = await fetch('/api/turn-credentials');
    const data = (await res.json()) as { iceServers: IceServerConfig[] };
    return data.iceServers;
  } catch {
    return [{ urls: ['stun:stun.l.google.com:19302'] }];
  }
}
