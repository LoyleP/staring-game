import { gameConfig } from '../game/gameConfig';
import type { SignalMessage } from './protocol';

export type SignalingStatus = 'connected' | 'degraded';
export type SignalingTransport = 'ws' | 'poll';

interface Callbacks {
  onMessage: (m: SignalMessage) => void;
  onStatus?: (s: SignalingStatus) => void;
  onTransport?: (t: SignalingTransport) => void;
}

/**
 * Signalisation : WebSocket en priorité, repli automatique sur le polling HTTP après
 * `wsFailuresBeforePolling` échecs de connexion consécutifs (ou si `forceSignalPolling`).
 * Les messages sortants sont mis en file tant qu'aucun transport n'est prêt.
 */
export class Signaling {
  private queue: SignalMessage[] = [];
  private transport: SignalingTransport = 'ws';
  private running = false;

  // WebSocket
  private ws: WebSocket | null = null;
  private wsFailures = 0;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  // Polling
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollFailures = 0;

  constructor(
    private readonly code: string,
    private readonly token: string,
    private readonly cb: Callbacks,
  ) {}

  get mode(): SignalingTransport {
    return this.transport;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (gameConfig.net.forceSignalPolling || typeof WebSocket === 'undefined') this.startPolling();
    else this.connectWs();
  }

  stop(): void {
    this.running = false;
    if (this.wsTimer) clearTimeout(this.wsTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(message: SignalMessage): void {
    if (this.transport === 'ws' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.queue.push(message);
    // Évite d'attendre un tour complet de polling pour une offre ou un candidat ICE.
    if (this.transport === 'poll' && this.running && this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = setTimeout(() => void this.pollOnce(), 40);
    }
  }

  // ---- WebSocket ----

  private connectWs(): void {
    if (!this.running) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${location.host}/api/signal?code=${encodeURIComponent(this.code)}&token=${encodeURIComponent(this.token)}`;
    let opened = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.onWsFailure();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      opened = true;
      this.wsFailures = 0;
      this.cb.onTransport?.('ws');
      this.cb.onStatus?.('connected');
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, gameConfig.net.pingIntervalMs);
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as SignalMessage | { type: 'pong' };
        if (m.type !== 'pong') this.cb.onMessage(m);
      } catch {
        // message illisible ignoré
      }
    };
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      if (!this.running || this.transport !== 'ws') return;
      // Fermeture à la durée maximale de la fonction : on rouvre aussitôt, ce n'est pas un échec.
      if (opened && e.code !== 4401) this.wsTimer = setTimeout(() => this.connectWs(), 200);
      else this.onWsFailure();
    };
  }

  private onWsFailure(): void {
    this.wsFailures += 1;
    if (this.wsFailures >= gameConfig.net.wsFailuresBeforePolling) {
      this.startPolling();
      return;
    }
    this.wsTimer = setTimeout(() => this.connectWs(), 500 * 2 ** this.wsFailures);
  }

  // ---- Polling ----

  private startPolling(): void {
    this.transport = 'poll';
    this.ws?.close();
    this.ws = null;
    this.cb.onTransport?.('poll');
    void this.pollOnce();
  }

  private async pollOnce(): Promise<void> {
    if (!this.running || this.transport !== 'poll') return;
    const batch = this.queue.splice(0, 50);
    try {
      const res = await fetch('/api/signal-poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: this.code, token: this.token, send: batch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { messages: SignalMessage[] };
      if (this.pollFailures > 0) this.cb.onStatus?.('connected');
      this.pollFailures = 0;
      for (const m of data.messages) this.cb.onMessage(m);
    } catch {
      this.queue.unshift(...batch);
      this.pollFailures += 1;
      if (this.pollFailures === 3) this.cb.onStatus?.('degraded');
    }
    if (this.running && this.transport === 'poll') {
      this.pollTimer = setTimeout(() => void this.pollOnce(), gameConfig.net.pollIntervalMs);
    }
  }
}
