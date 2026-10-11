import { gameConfig } from '../game/gameConfig';
import type { SignalMessage } from './protocol';

export type SignalingStatus = 'connected' | 'degraded';

/**
 * Signalisation par polling HTTP (repli du WebSocket) : une requête toutes les `pollIntervalMs`
 * envoie les messages en attente et récupère ceux de l'autre joueur.
 */
export class PollSignaling {
  private queue: SignalMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private failures = 0;

  constructor(
    private readonly code: string,
    private readonly token: string,
    private readonly onMessage: (m: SignalMessage) => void,
    private readonly onStatus: (s: SignalingStatus) => void = () => undefined,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  send(message: SignalMessage): void {
    this.queue.push(message);
    // Évite d'attendre un tour complet pour une offre ou un candidat ICE.
    if (this.running && this.timer) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.loop(), 40);
    }
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    const batch = this.queue.splice(0, 50);
    try {
      const res = await fetch('/api/signal-poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: this.code, token: this.token, send: batch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { messages: SignalMessage[] };
      if (this.failures > 0) this.onStatus('connected');
      this.failures = 0;
      for (const m of data.messages) this.onMessage(m);
    } catch {
      this.queue.unshift(...batch);
      this.failures += 1;
      if (this.failures === 3) this.onStatus('degraded');
    }
    if (this.running) {
      this.timer = setTimeout(() => void this.loop(), gameConfig.net.pollIntervalMs);
    }
  }
}
