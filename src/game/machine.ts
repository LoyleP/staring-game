import type { DetectorOutput, FaceEventType, FaceFlags } from '../vision/types';
import { gameConfig } from './gameConfig';
import {
  applyEvent,
  createRoundState,
  decideByTime,
  roundPhase,
  spend,
  tick,
  type RoundEnd,
  type RoundPhase,
  type RoundState,
} from './scoring';

type Config = typeof gameConfig;

export type Winner = 'me' | 'opp' | 'draw';

export interface RoundSnapshot {
  phase: RoundPhase;
  elapsedMs: number;
  /** Secondes restantes du compte à rebours (0 une fois lancé). */
  countdown: number;
  timeLeftMs: number;
  aura: number;
  oppAura: number | null;
  /** Raison de fin de la manche pour celui qui l'a causée. */
  ended: RoundEnd | null;
  winner: Winner | null;
  flags: FaceFlags;
  /** Variations ponctuelles survenues sur cette image. */
  deltas: number[];
  /** Mêmes variations avec leur type, pour les envoyer à l'adversaire. */
  applied: { type: FaceEventType; delta: number }[];
  oppDeltas: number[];
}

const IDLE_FLAGS: FaceFlags = { smiling: false, headMoving: false, faceLost: false };

/** Une manche : contre le chronomètre, ou contre un adversaire (réel ou simulé). */
export class SoloRound {
  private me: RoundState;
  private opp: RoundState | null;
  private lastT: number;
  private last: RoundSnapshot;
  private done = false;

  constructor(
    private readonly startT: number,
    withOpponent = false,
    private readonly cfg: Config = gameConfig,
    initial?: { me: number; opp: number },
  ) {
    this.me = { ...createRoundState(cfg), ...(initial && { aura: initial.me }) };
    this.opp = withOpponent ? { ...createRoundState(cfg), ...(initial && { aura: initial.opp }) } : null;
    this.lastT = startT;
    this.last = this.snapshot(startT, [], [], IDLE_FLAGS);
  }

  step(t: number, out: DetectorOutput, oppOut?: DetectorOutput): RoundSnapshot {
    if (this.done) return this.last;
    const phase = roundPhase(t - this.startT, this.cfg);
    const deltas: number[] = [];
    const oppDeltas: number[] = [];
    const applied: RoundSnapshot['applied'] = [];

    for (const event of out.events) {
      const r = applyEvent(this.me, event, phase, this.cfg);
      this.me = r.state;
      if (r.delta !== 0) {
        deltas.push(r.delta);
        applied.push({ type: event.type, delta: r.delta });
      }
    }
    if (this.opp && oppOut) {
      for (const event of oppOut.events) {
        const r = applyEvent(this.opp, event, phase, this.cfg);
        this.opp = r.state;
        if (r.delta !== 0) oppDeltas.push(r.delta);
      }
    }
    // Évite un saut énorme si l'onglet a gelé.
    const dt = Math.min(t - this.lastT, 500);
    this.lastT = t;
    this.me = tick(this.me, dt, phase, out.flags, this.cfg);
    if (this.opp && oppOut) this.opp = tick(this.opp, dt, phase, oppOut.flags, this.cfg);

    this.last = this.snapshot(t, deltas, oppDeltas, out.flags, applied);
    if (this.last.ended) this.done = true;
    return this.last;
  }

  /**
   * Mode réseau : l'adversaire est arbitré sur son téléphone. On applique ses pénalités annoncées,
   * puis `setOppAura` corrige la dérive avec sa valeur réelle. La fin de sa manche vient de son message `crack`.
   */
  addOppDelta(delta: number): void {
    if (this.opp) this.opp = { ...this.opp, aura: Math.max(0, this.opp.aura + delta) };
  }

  setOppAura(aura: number): void {
    if (this.opp) this.opp = { ...this.opp, aura: Math.max(0, aura) };
  }

  /** Applique le coût d'un son lancé (négatif) ; renvoie la variation réellement appliquée. */
  spendAura(side: 'me' | 'opp', cost: number, t: number): number {
    const phase = roundPhase(t - this.startT, this.cfg);
    const target = side === 'me' ? this.me : this.opp;
    if (this.done || !target) return 0;
    const r = spend(target, cost, phase);
    if (side === 'me') this.me = r.state;
    else this.opp = r.state;
    return r.delta;
  }

  private winner(): Winner | null {
    const lost = (s: RoundState | null) => s?.ended === 'crack' || s?.ended === 'zero';
    if (!this.opp) return null;
    const meLost = lost(this.me);
    const oppLost = lost(this.opp);
    if (meLost && oppLost) return 'draw';
    if (meLost) return 'opp';
    if (oppLost) return 'me';
    if (this.me.ended === 'time') {
      // La mort subite viendra avec la boucle de jeu en réseau ; ici une égalité reste une égalité.
      const o = decideByTime(this.me.aura, this.opp.aura, this.cfg);
      return o === 'a' ? 'me' : o === 'b' ? 'opp' : 'draw';
    }
    return null;
  }

  private snapshot(
    t: number,
    deltas: number[],
    oppDeltas: number[],
    flags: FaceFlags,
    applied: RoundSnapshot['applied'] = [],
  ): RoundSnapshot {
    const { countdownMs, durationMs } = this.cfg.round;
    const elapsedMs = t - this.startT;
    const ended = this.me.ended ?? this.opp?.ended ?? null;
    return {
      phase: ended ? 'ended' : roundPhase(elapsedMs, this.cfg),
      elapsedMs,
      countdown: Math.min(Math.ceil(countdownMs / 1000), Math.max(0, Math.ceil((countdownMs - elapsedMs) / 1000))),
      // Le minuteur reste à la durée complète pendant le compte à rebours.
      timeLeftMs: Math.min(durationMs, Math.max(0, countdownMs + durationMs - elapsedMs)),
      aura: this.me.aura,
      oppAura: this.opp?.aura ?? null,
      ended,
      winner: this.winner(),
      flags,
      deltas,
      applied,
      oppDeltas,
    };
  }
}
