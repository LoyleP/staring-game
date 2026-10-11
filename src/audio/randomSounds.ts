import { gameConfig } from '../game/gameConfig';

type Config = typeof gameConfig;

/** Planifie les sons aléatoires du jeu : un premier après quelques secondes de jeu, puis à intervalle variable. */
export class RandomSoundScheduler {
  private nextAt: number | null = null;

  constructor(
    private readonly cfg: Config = gameConfig,
    private readonly rand: () => number = Math.random,
  ) {}

  /** À appeler au début de la phase de jeu (ou d'une mort subite). */
  reset(): void {
    this.nextAt = null;
  }

  /** Vrai si un son doit partir maintenant ; programme alors le suivant. */
  due(now: number): boolean {
    const c = this.cfg.randomSounds;
    if (!c.enabled) return false;
    this.nextAt ??= now + c.firstMinMs + this.rand() * (c.firstMaxMs - c.firstMinMs);
    if (now < this.nextAt) return false;
    this.nextAt = now + c.minGapMs + this.rand() * (c.maxGapMs - c.minGapMs);
    return true;
  }

  /** Choisit un son au hasard dans le catalogue. */
  pick(ids: string[]): string | null {
    return ids.length ? (ids[Math.floor(this.rand() * ids.length)] as string) : null;
  }
}
