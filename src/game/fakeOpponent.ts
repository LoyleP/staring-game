import type { DetectorOutput, FaceEvent, FaceFlags } from '../vision/types';
import type { RoundPhase } from './scoring';

export type Expression = 'neutral' | 'smile' | 'laugh' | 'moving';

export interface FakeOpponentOptions {
  /** Délai moyen entre deux actions, en ms. */
  meanGapMs?: number;
  /** Probabilité qu'une action soit un fou rire (fin de manche). */
  laughChance?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Action = { kind: Expression; until: number };

/**
 * Adversaire simulé pour tester l'interface sans second joueur :
 * produit les mêmes événements qu'un vrai détecteur facial.
 */
export class FakeOpponent {
  private rand: () => number;
  private action: Action | null = null;
  private nextAt: number | null = null;
  readonly name = 'Bot';

  constructor(
    seed = Date.now(),
    private readonly opts: Required<FakeOpponentOptions> = { meanGapMs: 6000, laughChance: 0.07 },
  ) {
    this.rand = mulberry32(seed);
  }

  step(t: number, phase: RoundPhase): { out: DetectorOutput; expression: Expression } {
    const events: FaceEvent[] = [];
    if (phase !== 'play') return { out: this.out(events, null), expression: 'neutral' };

    this.nextAt ??= t + this.gap();
    if (this.action && t >= this.action.until) this.action = null;

    if (!this.action && t >= this.nextAt) {
      const r = this.rand();
      const { laughChance } = this.opts;
      if (r < laughChance) {
        events.push({ type: 'laugh', t });
        this.action = { kind: 'laugh', until: t + 1500 };
      } else if (r < 0.45) {
        events.push({ type: 'smileLight', t });
        this.action = { kind: 'smile', until: t + 700 + this.rand() * 700 };
      } else if (r < 0.6) {
        events.push({ type: 'smileFull', t });
        this.action = { kind: 'smile', until: t + 900 + this.rand() * 700 };
      } else {
        this.action = { kind: 'moving', until: t + 1200 + this.rand() * 1000 };
      }
      this.nextAt = this.action.until + this.gap();
    }
    return { out: this.out(events, this.action), expression: this.action?.kind ?? 'neutral' };
  }

  private gap(): number {
    return this.opts.meanGapMs * (0.5 + this.rand());
  }

  private out(events: FaceEvent[], action: Action | null): DetectorOutput {
    const flags: FaceFlags = {
      smiling: action?.kind === 'smile' || action?.kind === 'laugh',
      headMoving: action?.kind === 'moving',
      faceLost: false,
    };
    return { events, flags };
  }
}
