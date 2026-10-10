import type { DetectorOutput, FaceFlags } from '../vision/types';
import { gameConfig } from './gameConfig';
import {
  applyEvent,
  createRoundState,
  roundPhase,
  tick,
  type RoundEnd,
  type RoundPhase,
  type RoundState,
} from './scoring';

export interface RoundSnapshot {
  phase: RoundPhase;
  elapsedMs: number;
  /** Secondes restantes du compte à rebours (0 une fois lancé). */
  countdown: number;
  timeLeftMs: number;
  aura: number;
  ended: RoundEnd | null;
  flags: FaceFlags;
  /** Variations ponctuelles survenues sur cette image. */
  deltas: number[];
}

const IDLE_FLAGS: FaceFlags = { smiling: false, headMoving: false, faceLost: false };

/** Une manche en solo : compte à rebours, grâce, jeu, fin. */
export class SoloRound {
  private state: RoundState = createRoundState();
  private lastT: number;
  private last: RoundSnapshot;

  constructor(private readonly startT: number) {
    this.lastT = startT;
    this.last = this.snapshot(startT, [], IDLE_FLAGS);
  }

  step(t: number, out: DetectorOutput): RoundSnapshot {
    if (this.state.ended) return this.last;
    const phase = roundPhase(t - this.startT);
    const deltas: number[] = [];
    for (const event of out.events) {
      const r = applyEvent(this.state, event, phase);
      this.state = r.state;
      if (r.delta !== 0) deltas.push(r.delta);
    }
    // Évite un saut énorme si l'onglet a gelé.
    const dt = Math.min(t - this.lastT, 500);
    this.lastT = t;
    this.state = tick(this.state, dt, phase, out.flags);
    this.last = this.snapshot(t, deltas, out.flags);
    return this.last;
  }

  private snapshot(t: number, deltas: number[], flags: FaceFlags): RoundSnapshot {
    const { countdownMs, durationMs } = gameConfig.round;
    const elapsedMs = t - this.startT;
    return {
      phase: this.state.ended ? 'ended' : roundPhase(elapsedMs),
      elapsedMs,
      countdown: Math.max(0, Math.ceil((countdownMs - elapsedMs) / 1000)),
      timeLeftMs: Math.max(0, countdownMs + durationMs - elapsedMs),
      aura: this.state.aura,
      ended: this.state.ended,
      flags,
      deltas,
    };
  }
}
