import type { MatchResult, MatchSide } from '../net/protocol';
import { gameConfig } from './gameConfig';
import { decideByTime } from './scoring';

type Config = typeof gameConfig;

export const other = (side: MatchSide): MatchSide => (side === 'host' ? 'guest' : 'host');

export type Wins = Record<MatchSide, number>;

/** Verdict de l'hôte à la fin du temps : vainqueur, ou mort subite si les auras sont trop proches. */
export function decideAtTime(
  hostAura: number,
  guestAura: number,
  cfg: Config = gameConfig,
): MatchSide | 'suddenDeath' {
  const o = decideByTime(hostAura, guestAura, cfg);
  return o === 'a' ? 'host' : o === 'b' ? 'guest' : 'suddenDeath';
}

/** Fin de la mort subite : le plus d'aura gagne, une égalité parfaite est nulle (manche rejouée). */
export function decideSuddenDeath(hostAura: number, guestAura: number): MatchSide | 'draw' {
  if (hostAura === guestAura) return 'draw';
  return hostAura > guestAura ? 'host' : 'guest';
}

/** Un craquage ou une aura à 0 fait perdre le joueur ; les deux sur la même fenêtre = nul. */
export function decideCrack(crackers: MatchSide[]): MatchSide | 'draw' {
  if (crackers.length !== 1) return 'draw';
  return other(crackers[0] as MatchSide);
}

export function addWin(wins: Wins, result: MatchResult): Wins {
  return result.winner === 'draw' ? wins : { ...wins, [result.winner]: wins[result.winner] + 1 };
}

export function matchWinner(wins: Wins, cfg: Config = gameConfig): MatchSide | null {
  if (wins.host >= cfg.match.roundsToWin) return 'host';
  if (wins.guest >= cfg.match.roundsToWin) return 'guest';
  return null;
}

/**
 * Décalage d'horloge (hôte − local) : chaque échantillon vient d'un ping/pong, en supposant
 * que la réponse a été émise au milieu de l'aller-retour. On prend la médiane.
 */
export function clockOffsetSample(tSent: number, tRemote: number, tReceived: number): number {
  return tRemote - (tSent + tReceived) / 2;
}

export function medianOffset(samples: number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
