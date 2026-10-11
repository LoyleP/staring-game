import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectorOutput } from '../vision/types';
import type { GameMessage, MatchSide } from '../net/protocol';
import { Duel } from './duel';
import { createDuelStore } from './duelStore';

const FRAME_MS = 67;
const LATENCY_MS = 40;
/** L'horloge de l'invité retarde de 7 s sur celle de l'hôte : toutes les dates du protocole doivent être converties. */
const GUEST_LAG = 7000;
const calm: DetectorOutput = { events: [], flags: { smiling: false, headMoving: false, faceLost: false } };

class Pair {
  hostStore = createDuelStore();
  guestStore = createDuelStore();
  connected = true;
  /** Sons programmés, avec leur instant de lecture converti dans l'horloge de l'hôte. */
  plays: { side: MatchSide; id: string; hostTime: number }[] = [];
  /** Détecteur scripté par côté : appelé à chaque image, renvoie les événements. */
  script: Record<MatchSide, (elapsedMs: number, round: number) => DetectorOutput> = {
    host: () => calm,
    guest: () => calm,
  };
  host: Duel;
  guest: Duel;
  private startedAt = new Map<MatchSide, number>();

  constructor() {
    const mk = (side: MatchSide, store: ReturnType<typeof createDuelStore>, lag: number): Duel => {
      const to = (m: GameMessage) => {
        const target = side === 'host' ? this.guest : this.host;
        setTimeout(() => this.connected && target.onMessage(structuredClone(m)), LATENCY_MS);
        return true;
      };
      return new Duel({
        side,
        send: to,
        sendCritical: (m) => void to(m),
        toLocal: (t) => t - (side === 'guest' ? GUEST_LAG : 0),
        toHost: (t) => t + (side === 'guest' ? GUEST_LAG : 0),
        now: () => performance.now() - lag,
        store,
        play: (id, delay) =>
          this.plays.push({ side, id, hostTime: performance.now() - lag + delay + (side === 'guest' ? GUEST_LAG : 0) }),
      });
    };
    this.host = mk('host', this.hostStore, 0);
    this.guest = mk('guest', this.guestStore, GUEST_LAG);
    this.host.startWatchdog(() => this.connected);
    this.guest.startWatchdog(() => this.connected);
  }

  /** Avance le temps virtuel en envoyant une image aux deux joueurs à chaque pas. */
  run(ms: number): void {
    const steps = Math.ceil(ms / FRAME_MS);
    for (let i = 0; i < steps; i++) {
      vi.advanceTimersByTime(FRAME_MS);
      for (const [side, duel, lag] of [['host', this.host, 0], ['guest', this.guest, GUEST_LAG]] as const) {
        const t = performance.now() - lag;
        const phaseStart = this.startedAt.get(side) ?? t;
        duel.onFrame(this.script[side](t - phaseStart, 0), { t, face: true, smileL: 0, smileR: 0, jawOpen: 0, noseX: 0, noseY: 0, faceWidth: 1 });
      }
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});
afterEach(() => vi.useRealTimers());

describe('Duel : deux joueurs simulés', () => {
  /** Joueur qui émet `event` une fois, à `atMs` après le début de la partie courante. */
  const trigger = (pair: Pair, side: MatchSide, event: 'laugh' | 'smileLight', atMs: number) => {
    const origin = performance.now();
    let fired = false;
    pair.script[side] = () => {
      if (!fired && performance.now() - origin >= atMs) {
        fired = true;
        const t = performance.now();
        return { events: [{ type: event, t }], flags: calm.flags };
      }
      return calm;
    };
  };

  it('l’hôte lance la partie et l’invité démarre sa manche malgré 7 s de décalage d’horloge', () => {
    const p = new Pair();
    p.host.startMatch();
    p.run(1000);
    expect(p.hostStore.getState().phase).toBe('round');
    expect(p.guestStore.getState().phase).toBe('round');
    p.run(4000);
    // Les deux horloges en phase : les deux affichent la même seconde de compte à rebours (à une image près).
    const h = p.hostStore.getState().snap?.phase;
    const g = p.guestStore.getState().snap?.phase;
    expect(h).toBe(g);
  });

  it('un craquage de l’invité donne la manche à l’hôte, puis la manche suivante démarre', () => {
    const p = new Pair();
    p.host.startMatch();
    trigger(p, 'guest', 'laugh', 8000);
    p.run(10_000);
    expect(p.hostStore.getState().lastRound).toMatchObject({ winner: 'me', reason: 'crack' });
    expect(p.guestStore.getState().lastRound).toMatchObject({ winner: 'opp', reason: 'crack' });
    expect(p.hostStore.getState().wins).toEqual({ me: 1, opp: 0 });
    expect(p.guestStore.getState().wins).toEqual({ me: 0, opp: 1 });
    p.run(6000);
    expect(p.hostStore.getState().round).toBe(2);
    expect(p.guestStore.getState().round).toBe(2);
    expect(p.guestStore.getState().phase).toBe('round');
  });

  it('deux manches gagnées terminent la partie, des deux côtés', () => {
    const p = new Pair();
    p.host.startMatch();
    // Manche 1 : phase de jeu dès 6,5 s. Manche 2 : démarre vers 13,8 s, jeu dès 18,8 s.
    trigger(p, 'host', 'laugh', 8000);
    p.run(10_000);
    trigger(p, 'host', 'laugh', 10_000);
    p.run(12_000);
    p.run(2000);
    expect(p.guestStore.getState().phase).toBe('ended');
    expect(p.guestStore.getState().matchWinner).toBe('me');
    expect(p.hostStore.getState().matchWinner).toBe('opp');
    expect(p.hostStore.getState().wins).toEqual({ me: 0, opp: 2 });
  });

  it('au temps, le joueur le moins pénalisé gagne', () => {
    const p = new Pair();
    p.host.startMatch();
    trigger(p, 'guest', 'smileLight', 8000); // -150 pour l'invité
    p.run(70_000);
    expect(p.hostStore.getState().lastRound).toMatchObject({ winner: 'me', reason: 'time', meAura: 1000, oppAura: 850 });
    expect(p.guestStore.getState().lastRound).toMatchObject({ winner: 'opp', meAura: 850, oppAura: 1000 });
  });

  it('égalité : mort subite, puis victoire du moins pénalisé', () => {
    const p = new Pair();
    p.host.startMatch();
    p.run(66_500); // temps écoulé sans aucune pénalité
    expect(p.hostStore.getState().suddenDeath).toBe(true);
    expect(p.guestStore.getState().suddenDeath).toBe(true);
    trigger(p, 'guest', 'smileLight', 3000);
    p.run(17_000);
    expect(p.hostStore.getState().lastRound).toMatchObject({ winner: 'me', reason: 'time' });
    expect(p.guestStore.getState().lastRound?.winner).toBe('opp');
  });

  it('égalité parfaite en mort subite : manche nulle, rejouée', () => {
    const p = new Pair();
    p.host.startMatch();
    p.run(66_500);
    p.run(17_000);
    expect(p.hostStore.getState().lastRound?.winner).toBe('draw');
    expect(p.hostStore.getState().wins).toEqual({ me: 0, opp: 0 });
    p.run(6000);
    expect(p.hostStore.getState().round).toBe(2);
  });

  it('adversaire injoignable 15 s : victoire par forfait', () => {
    const p = new Pair();
    p.host.startMatch();
    p.run(10_000);
    p.connected = false;
    p.run(5000);
    expect(p.hostStore.getState().forfeitIn).not.toBeNull();
    p.run(14_000);
    const s = p.hostStore.getState();
    expect(s.phase).toBe('ended');
    expect(s.forfeit).toBe(true);
    expect(s.matchWinner).toBe('me');
  });

  it('la revanche relance une partie propre quand les deux la demandent', () => {
    const p = new Pair();
    p.host.startMatch();
    trigger(p, 'guest', 'laugh', 8000);
    p.run(10_000);
    trigger(p, 'guest', 'laugh', 10_000);
    p.run(12_000);
    p.run(2000);
    expect(p.hostStore.getState().phase).toBe('ended');
    p.script = { host: () => calm, guest: () => calm };
    p.host.requestRematch();
    p.run(500);
    expect(p.hostStore.getState().phase).toBe('ended'); // il attend l'invité
    p.guest.requestRematch();
    p.run(3000);
    expect(p.hostStore.getState().phase).toBe('round');
    expect(p.guestStore.getState().phase).toBe('round');
    expect(p.hostStore.getState().wins).toEqual({ me: 0, opp: 0 });
    expect(p.guestStore.getState().matchWinner).toBeNull();
  });

  describe('soundboard', () => {
    it('joue le même son au même instant sur les deux téléphones, malgré 7 s de décalage d’horloge', () => {
      const p = new Pair();
      p.host.startMatch();
      p.run(8000);
      p.guest.fireSound(0);
      p.run(500);
      expect(p.plays).toHaveLength(2);
      const [a, b] = p.plays;
      expect(a?.id).toBe(b?.id);
      expect(new Set(p.plays.map((x) => x.side))).toEqual(new Set(['host', 'guest']));
      expect(Math.abs((a?.hostTime ?? 0) - (b?.hostTime ?? 99999))).toBeLessThan(5);
    });

    it('coûte 50 d’aura au lanceur et l’adversaire le voit', () => {
      const p = new Pair();
      p.host.startMatch();
      p.run(8000);
      p.guest.fireSound(1);
      p.run(500);
      expect(p.guestStore.getState().snap?.aura).toBe(950);
      expect(p.hostStore.getState().snap?.oppAura).toBe(950);
      expect(p.hostStore.getState().floaters.some((f) => f.side === 'opp' && f.delta === -50)).toBe(true);
    });

    it('recharge de 8 s commune, 3 munitions, une carte ne sert qu’une fois', () => {
      const p = new Pair();
      p.host.startMatch();
      p.run(8000);
      p.guest.fireSound(0);
      p.run(1000);
      p.guest.fireSound(1); // en recharge : ignoré
      p.run(500);
      expect(p.guestStore.getState().hand.filter((c) => c.used)).toHaveLength(1);
      p.run(8000);
      p.guest.fireSound(0); // déjà utilisée : ignoré
      p.guest.fireSound(1);
      p.run(500);
      expect(p.guestStore.getState().hand.filter((c) => c.used)).toHaveLength(2);
      expect(p.guestStore.getState().snap?.aura).toBe(900);
    });

    it('refuse pendant le compte à rebours et après un craquage', () => {
      const p = new Pair();
      p.host.startMatch();
      p.run(3000); // compte à rebours
      p.guest.fireSound(0);
      p.run(300);
      expect(p.plays).toHaveLength(0);
      expect(p.guestStore.getState().snap?.aura).toBe(1000);
    });

    it('remet une main neuve à chaque manche', () => {
      const p = new Pair();
      p.host.startMatch();
      p.run(8000);
      p.guest.fireSound(0);
      trigger(p, 'guest', 'laugh', 1000);
      p.run(20_000);
      expect(p.guestStore.getState().round).toBe(2);
      expect(p.guestStore.getState().hand.every((c) => !c.used)).toBe(true);
    });
  });
});
