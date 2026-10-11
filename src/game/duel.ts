import { canFire, createBoard, fire, reloadProgress, type BoardState } from '../audio/board';
import { SOUNDS } from '../audio/sounds';
import { resumeAudio } from '../audio/unlock';
import type { DetectorOutput, FaceFrame } from '../vision/types';
import type { GameMessage, MatchResult, MatchSide, RoundEndReason } from '../net/protocol';
import { addWin, decideAtTime, decideCrack, decideSuddenDeath, matchWinner, other, type Wins } from './matchLogic';
import { useDuelStore, type DuelStoreHook, type RoundSummary, type SideView } from './duelStore';
import { gameConfig } from './gameConfig';
import { SoloRound, type RoundSnapshot } from './machine';

const AURA_EVERY_MS = 500;
const SILENCE_MS = 3000;
const FLOATER_MS = 1200;
const ROUND_BREAK_MS = 4000;
const START_LEAD_MS = 1500;
const CRACK_WINDOW_MS = 250;
const TIME_END_WAIT_MS = 300;

export interface DuelDeps {
  side: MatchSide;
  /** Envoi sur le DataChannel ; false si indisponible. */
  send: (m: GameMessage) => boolean;
  /** Message critique : DataChannel, sinon relayé par la signalisation. */
  sendCritical: (m: GameMessage) => void;
  /** Convertit un instant de l'horloge de l'hôte vers l'horloge locale, et inversement. */
  toLocal: (hostTime: number) => number;
  toHost: (localTime: number) => number;
  now: () => number;
  /** Store de l'affichage (injectable pour les tests). */
  store?: DuelStoreHook;
  /** Lecture d'un son `delayMs` plus tard (injectable pour les tests). */
  play?: (id: string, delayMs: number) => void;
}

/**
 * Boucle de jeu d'un duel. L'hôte fait autorité sur le temps et les verdicts ; chaque joueur arbitre son propre
 * visage et annonce ses pénalités. Chaque client simule les deux auras et se recale sur les messages `aura`.
 */
export class Duel {
  private round: SoloRound | null = null;
  private roundNo = 0;
  private wins: Wins = { host: 0, guest: 0 };
  private results: MatchResult[] = [];
  private suddenDeath = false;
  private decided = true; // aucune manche en cours
  private cracks: MatchSide[] = [];
  private crackTimer: ReturnType<typeof setTimeout> | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastAuraSent = 0;
  private lastOppAura = 0;
  private peerLostSince: number | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private floaterId = 0;
  private selfEnded = false;
  private timeEndHandled = false;
  private matchOver = false;
  private rematch = { me: false, opp: false };
  private board: BoardState | null = null;

  private readonly view: DuelStoreHook;

  constructor(private readonly d: DuelDeps) {
    this.view = d.store ?? useDuelStore;
  }

  // ---- Démarrage ----

  /** Hôte : lance une nouvelle partie (première ou revanche). */
  startMatch(): void {
    if (this.d.side !== 'host') return;
    this.wins = { host: 0, guest: 0 };
    this.results = [];
    this.roundNo = 0;
    this.matchOver = false;
    this.rematch = { me: false, opp: false };
    this.view.getState().reset();
    this.hostStartRound();
  }

  requestRematch(): void {
    this.rematch.me = true;
    this.view.getState().set({ rematchMe: true });
    this.d.sendCritical({ type: 'rematch' });
    this.maybeRematch();
  }

  private maybeRematch(): void {
    if (this.d.side === 'host' && this.rematch.me && this.rematch.opp) this.startMatch();
  }

  /** Surveille silence et déconnexion de l'adversaire. */
  startWatchdog(peerConnected: () => boolean): void {
    this.watchdog ??= setInterval(() => {
      if (this.matchOver || (this.decided && !this.round)) return;
      const now = this.d.now();
      const silent = this.round !== null && !this.decided && this.lastOppAura > 0 && now - this.lastOppAura > SILENCE_MS;
      const lost = !peerConnected() || silent;
      if (!lost) {
        this.peerLostSince = null;
        this.view.getState().set({ forfeitIn: null });
        return;
      }
      this.peerLostSince ??= now;
      const left = Math.ceil((gameConfig.net.reconnectGraceMs - (now - this.peerLostSince)) / 1000);
      if (left <= 0) this.endByForfeit();
      else this.view.getState().set({ forfeitIn: left });
    }, 1000);
  }

  dispose(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.crackTimer) clearTimeout(this.crackTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.view.getState().reset();
  }

  // ---- Réception ----

  onMessage(m: GameMessage): void {
    const store = this.view.getState();
    switch (m.type) {
      case 'roundStart':
        if (this.d.side === 'guest') this.beginRound(m.round, this.d.toLocal(m.startAt));
        break;
      case 'penalty':
        this.round?.addOppDelta(m.amount);
        this.addFloater('opp', m.amount);
        break;
      case 'aura':
        this.lastOppAura = this.d.now();
        this.round?.setOppAura(m.aura);
        break;
      case 'sound':
        this.d.play?.(m.id, Math.max(0, this.d.toLocal(m.playAt) - this.d.now()));
        break;
      case 'crack':
        if (this.d.side === 'host') this.hostOnCrack(other(this.d.side), m.reason);
        break;
      case 'suddenDeath':
        if (this.d.side === 'guest') this.beginSuddenDeath(this.d.toLocal(m.endAt));
        break;
      case 'roundEnd':
        if (this.d.side === 'guest') this.applyRoundEnd(m.result, m.wins);
        break;
      case 'matchEnd':
        if (this.d.side === 'guest') this.applyMatchEnd(m.winner, m.forfeit, m.wins);
        break;
      case 'rematch':
        this.rematch.opp = true;
        store.set({ rematchOpp: true });
        this.maybeRematch();
        break;
      default:
        break;
    }
  }

  // ---- Manche ----

  private hostStartRound(): void {
    const round = ++this.roundNo;
    const startAt = this.d.toHost(this.d.now()) + START_LEAD_MS;
    this.d.sendCritical({ type: 'roundStart', round, startAt });
    this.beginRound(round, this.d.toLocal(startAt));
  }

  private beginRound(round: number, startLocal: number): void {
    if (round === 1) {
      // Nouvelle partie (première ou revanche) : repart d'un état propre, y compris côté invité.
      this.wins = { host: 0, guest: 0 };
      this.results = [];
      this.matchOver = false;
      this.rematch = { me: false, opp: false };
      this.view.getState().reset();
    }
    this.roundNo = round;
    this.round = new SoloRound(startLocal, true);
    this.decided = false;
    this.suddenDeath = false;
    this.selfEnded = false;
    this.timeEndHandled = false;
    this.cracks = [];
    this.lastAuraSent = 0;
    this.lastOppAura = this.d.now();
    this.board = createBoard(SOUNDS.map((x) => x.id));
    this.view.getState().set({ phase: 'round', round, snap: null, floaters: [], suddenDeath: false, hand: this.hand(), reload: 1 });
  }

  private beginSuddenDeath(endLocal: number): void {
    const prev = this.round?.step(this.d.now(), { events: [], flags: { smiling: false, headMoving: false, faceLost: false } });
    const sdMs = gameConfig.round.suddenDeathMs;
    const cfg = { ...gameConfig, round: { ...gameConfig.round, countdownMs: 0, graceMs: 0, durationMs: sdMs } };
    this.round = new SoloRound(endLocal - sdMs, true, cfg, {
      me: prev?.aura ?? gameConfig.round.startAura,
      opp: prev?.oppAura ?? gameConfig.round.startAura,
    });
    this.suddenDeath = true;
    this.selfEnded = false;
    this.timeEndHandled = false;
    this.lastOppAura = this.d.now();
    this.view.getState().set({ suddenDeath: true });
  }

  /** Tap sur un son : coût d'aura, lecture sur les deux téléphones au même instant (horloge de l'hôte). */
  fireSound(index: number): void {
    const round = this.round;
    const board = this.board;
    const snap = this.view.getState().snap;
    if (!round || !board || this.decided || this.selfEnded || snap?.phase !== 'play') return;
    const now = this.d.now();
    if (canFire(board, index, now) !== 'ok') return;
    void resumeAudio(); // dans le geste du tap : iOS n'autorise la reprise qu'ici
    const id = board.hand[index] as string;
    this.board = fire(board, index, now);
    const playAt = this.d.toHost(now) + gameConfig.soundboard.playDelayMs;
    this.d.sendCritical({ type: 'sound', id, playAt });
    this.d.play?.(id, gameConfig.soundboard.playDelayMs);
    const cost = round.spendAura('me', gameConfig.soundboard.auraCost, now);
    if (cost !== 0) {
      this.d.send({ type: 'penalty', kind: 'sound', amount: cost, t: now });
      this.addFloater('me', cost);
    }
    this.view.getState().set({ hand: this.hand(), reload: 0 });
  }

  private hand() {
    const board = this.board;
    if (!board) return [];
    return board.hand.map((id, i) => ({
      sound: SOUNDS.find((x) => x.id === id) ?? { id, label: id, url: '' },
      used: board.used[i] ?? false,
    }));
  }

  /** Image analysée de mon visage. */
  onFrame(out: DetectorOutput, frame: FaceFrame): void {
    const round = this.round;
    if (!round || this.decided) return;
    const snap = round.step(frame.t, out);

    for (const a of snap.applied) {
      this.d.send({ type: 'penalty', kind: a.type, amount: a.delta, t: frame.t });
      this.addFloater('me', a.delta);
    }
    if (frame.t - this.lastAuraSent >= AURA_EVERY_MS || (snap.ended && !this.selfEnded)) {
      this.lastAuraSent = frame.t;
      this.d.send({ type: 'aura', aura: snap.aura, t: frame.t });
    }

    if (snap.ended && !this.selfEnded) {
      this.selfEnded = true;
      if (snap.ended === 'crack' || snap.ended === 'zero') {
        if (this.d.side === 'host') this.hostOnCrack('host', snap.ended);
        else this.d.sendCritical({ type: 'crack', reason: snap.ended, t: frame.t });
      } else if (snap.ended === 'time' && this.d.side === 'host' && !this.timeEndHandled) {
        this.timeEndHandled = true;
        // Laisse arriver la dernière valeur d'aura de l'adversaire avant de trancher.
        this.later(TIME_END_WAIT_MS, () => this.hostOnTimeEnd());
      }
    }
    this.publish(snap);
  }

  // ---- Verdicts de l'hôte ----

  private hostOnCrack(side: MatchSide, reason: 'crack' | 'zero'): void {
    if (this.decided) return;
    if (!this.cracks.includes(side)) this.cracks.push(side);
    this.crackTimer ??= setTimeout(() => {
      this.crackTimer = null;
      const winner = decideCrack(this.cracks);
      this.hostFinishRound(winner, reason);
    }, CRACK_WINDOW_MS);
  }

  private hostOnTimeEnd(): void {
    if (this.decided) return;
    const snap = this.round?.step(this.d.now(), { events: [], flags: { smiling: false, headMoving: false, faceLost: false } });
    const host = snap?.aura ?? 0;
    const guest = snap?.oppAura ?? 0;
    if (this.suddenDeath) return this.hostFinishRound(decideSuddenDeath(host, guest), 'time');
    const verdict = decideAtTime(host, guest);
    if (verdict !== 'suddenDeath') return this.hostFinishRound(verdict, 'time');
    const endAt = this.d.toHost(this.d.now()) + gameConfig.round.suddenDeathMs;
    this.d.sendCritical({ type: 'suddenDeath', endAt });
    this.beginSuddenDeath(this.d.toLocal(endAt));
  }

  private hostFinishRound(winner: MatchSide | 'draw', reason: RoundEndReason): void {
    if (this.decided) return;
    const snap = this.round?.step(this.d.now(), { events: [], flags: { smiling: false, headMoving: false, faceLost: false } });
    const result: MatchResult = {
      winner,
      reason,
      hostAura: Math.round(snap?.aura ?? 0),
      guestAura: Math.round(snap?.oppAura ?? 0),
    };
    this.wins = addWin(this.wins, result);
    const done = matchWinner(this.wins);
    this.d.sendCritical({ type: 'roundEnd', round: this.roundNo, result, wins: this.wins });
    this.applyRoundEnd(result, this.wins);
    if (done) {
      this.d.sendCritical({ type: 'matchEnd', winner: done, forfeit: false, wins: this.wins, rounds: this.results });
      this.applyMatchEnd(done, false, this.wins);
    } else {
      this.later(ROUND_BREAK_MS, () => !this.matchOver && this.hostStartRound());
    }
  }

  // ---- Application des verdicts (hôte et invité) ----

  private applyRoundEnd(result: MatchResult, wins: Wins): void {
    this.decided = true;
    this.wins = wins;
    if (!this.results.includes(result)) this.results.push(result);
    const mine = this.d.side;
    const view = (side: MatchSide | 'draw'): SideView | 'draw' => (side === 'draw' ? 'draw' : side === mine ? 'me' : 'opp');
    const summary: RoundSummary = {
      winner: view(result.winner),
      reason: result.reason,
      meAura: mine === 'host' ? result.hostAura : result.guestAura,
      oppAura: mine === 'host' ? result.guestAura : result.hostAura,
    };
    const store = this.view.getState();
    store.set({
      phase: 'between',
      wins: { me: wins[mine], opp: wins[other(mine)] },
      lastRound: summary,
      summaries: [...store.summaries, summary],
    });
  }

  private applyMatchEnd(winner: MatchSide, forfeit: boolean, wins: Wins): void {
    this.matchOver = true;
    this.decided = true;
    this.view.getState().set({
      phase: 'ended',
      matchWinner: winner === this.d.side ? 'me' : 'opp',
      forfeit,
      wins: { me: wins[this.d.side], opp: wins[other(this.d.side)] },
      forfeitIn: null,
    });
  }

  /** L'adversaire est injoignable depuis trop longtemps : victoire par forfait. */
  private endByForfeit(): void {
    if (this.matchOver) return;
    const mine = this.d.side;
    this.wins = { ...this.wins, [mine]: Math.max(this.wins[mine], gameConfig.match.roundsToWin) };
    this.applyMatchEnd(mine, true, this.wins);
  }

  // ---- Affichage ----

  private publish(snap: RoundSnapshot): void {
    const store = this.view.getState();
    const now = performance.now();
    store.set({
      snap,
      floaters: store.floaters.filter((f) => now - f.id < FLOATER_MS),
      reload: this.board ? reloadProgress(this.board, this.d.now()) : 1,
    });
  }

  private addFloater(side: SideView, delta: number): void {
    const store = this.view.getState();
    const now = performance.now();
    store.set({ floaters: [...store.floaters.filter((f) => now - f.id < FLOATER_MS), { id: now + this.floaterId++ / 1000, side, delta }] });
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
