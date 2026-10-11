import type { Role, RoomStatus, SignalMessage } from '../../src/net/protocol.js';
import { getRedis, keys, redisConfigured } from './redis.js';

export interface RoomRecord {
  status: RoomStatus;
  hostTokenHash: string;
  guestTokenHash: string | null;
}

/** Accès aux données éphémères : Redis en production, mémoire en développement local. */
export interface Store {
  readonly kind: 'redis' | 'memory';
  createRoom(code: string, hostTokenHash: string, ttlSeconds: number): Promise<boolean>;
  /** Place l'invité de façon atomique. */
  claimGuest(code: string, guestTokenHash: string): Promise<'ok' | 'full' | 'missing'>;
  getRoom(code: string): Promise<RoomRecord | null>;
  setStatus(code: string, status: RoomStatus): Promise<void>;
  pushInbox(code: string, role: Role, messages: SignalMessage[], ttlSeconds: number): Promise<void>;
  popInbox(code: string, role: Role): Promise<SignalMessage[]>;
  incrementCounter(key: string, windowSeconds: number): Promise<number>;
  saveMatch(id: string, data: unknown, ttlSeconds: number): Promise<void>;
  ping(): Promise<boolean>;
}

class RedisStore implements Store {
  readonly kind = 'redis' as const;
  private r = getRedis();

  async createRoom(code: string, hostTokenHash: string, ttl: number) {
    const key = keys.room(code);
    const created = await this.r.hsetnx(key, 'hostTokenHash', hostTokenHash);
    if (!created) return false;
    await this.r.hset(key, { status: 'waiting', createdAt: Date.now() });
    await this.r.expire(key, ttl);
    return true;
  }

  async claimGuest(code: string, guestTokenHash: string) {
    const key = keys.room(code);
    if (!(await this.r.exists(key))) return 'missing' as const;
    return (await this.r.hsetnx(key, 'guestTokenHash', guestTokenHash)) ? ('ok' as const) : ('full' as const);
  }

  async getRoom(code: string): Promise<RoomRecord | null> {
    const h = await this.r.hgetall<Record<string, string>>(keys.room(code));
    if (!h?.hostTokenHash) return null;
    return {
      status: (h.status as RoomStatus) ?? 'waiting',
      hostTokenHash: h.hostTokenHash,
      guestTokenHash: h.guestTokenHash ?? null,
    };
  }

  async setStatus(code: string, status: RoomStatus) {
    await this.r.hset(keys.room(code), { status });
  }

  async pushInbox(code: string, role: Role, messages: SignalMessage[], ttl: number) {
    if (!messages.length) return;
    const key = keys.inbox(code, role);
    await this.r.rpush(key, ...messages);
    await this.r.expire(key, ttl);
  }

  async popInbox(code: string, role: Role) {
    const out = await this.r.lpop<SignalMessage[]>(keys.inbox(code, role), 100);
    return out ?? [];
  }

  async incrementCounter(key: string, windowSeconds: number) {
    const n = await this.r.incr(key);
    if (n === 1) await this.r.expire(key, windowSeconds);
    return n;
  }

  async saveMatch(id: string, data: unknown, ttl: number) {
    await this.r.set(keys.match(id), JSON.stringify(data), { ex: ttl });
  }

  async ping() {
    await this.r.set('health:ping', '1', { ex: 30 });
    return (await this.r.get('health:ping')) !== null;
  }
}

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private rooms = new Map<string, Expiring<RoomRecord>>();
  private inboxes = new Map<string, Expiring<SignalMessage[]>>();
  private counters = new Map<string, Expiring<number>>();
  private matches = new Map<string, Expiring<unknown>>();

  private live<T>(map: Map<string, Expiring<T>>, key: string): Expiring<T> | undefined {
    const e = map.get(key);
    if (e && e.expiresAt < Date.now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  }

  async createRoom(code: string, hostTokenHash: string, ttl: number) {
    if (this.live(this.rooms, code)) return false;
    this.rooms.set(code, {
      value: { status: 'waiting', hostTokenHash, guestTokenHash: null },
      expiresAt: Date.now() + ttl * 1000,
    });
    return true;
  }

  async claimGuest(code: string, guestTokenHash: string) {
    const room = this.live(this.rooms, code);
    if (!room) return 'missing' as const;
    if (room.value.guestTokenHash) return 'full' as const;
    room.value.guestTokenHash = guestTokenHash;
    return 'ok' as const;
  }

  async getRoom(code: string) {
    return this.live(this.rooms, code)?.value ?? null;
  }

  async setStatus(code: string, status: RoomStatus) {
    const room = this.live(this.rooms, code);
    if (room) room.value.status = status;
  }

  async pushInbox(code: string, role: Role, messages: SignalMessage[], ttl: number) {
    if (!messages.length) return;
    const key = keys.inbox(code, role);
    const box = this.live(this.inboxes, key) ?? { value: [], expiresAt: 0 };
    box.value.push(...messages);
    box.expiresAt = Date.now() + ttl * 1000;
    this.inboxes.set(key, box);
  }

  async popInbox(code: string, role: Role) {
    const key = keys.inbox(code, role);
    const box = this.live(this.inboxes, key);
    if (!box) return [];
    this.inboxes.delete(key);
    return box.value;
  }

  async incrementCounter(key: string, windowSeconds: number) {
    const c = this.live(this.counters, key) ?? { value: 0, expiresAt: Date.now() + windowSeconds * 1000 };
    c.value += 1;
    this.counters.set(key, c);
    return c.value;
  }

  async saveMatch(id: string, data: unknown, ttl: number) {
    this.matches.set(id, { value: data, expiresAt: Date.now() + ttl * 1000 });
  }

  async ping() {
    return true;
  }
}

// Singleton conservé entre les rechargements du serveur de développement.
const g = globalThis as typeof globalThis & { __auraStore?: Store };

export function getStore(): Store {
  g.__auraStore ??= redisConfigured() ? new RedisStore() : new MemoryStore();
  return g.__auraStore;
}
