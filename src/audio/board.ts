import { gameConfig } from '../game/gameConfig';

type Config = typeof gameConfig;

/** Main de sons tirée pour la manche : chaque carte ne sert qu'une fois (munitions), recharge commune. */
export interface BoardState {
  hand: string[];
  used: boolean[];
  lastFiredAt: number | null;
}

export type FireCheck = 'ok' | 'used' | 'reload' | 'invalid';

export function pickHand(ids: string[], size: number, rand: () => number = Math.random): string[] {
  const pool = [...ids];
  const hand: string[] = [];
  while (hand.length < size && pool.length) {
    hand.push(pool.splice(Math.floor(rand() * pool.length), 1)[0] as string);
  }
  return hand;
}

export function createBoard(
  ids: string[],
  cfg: Config = gameConfig,
  rand: () => number = Math.random,
): BoardState {
  const hand = pickHand(ids, cfg.soundboard.ammoPerRound, rand);
  return { hand, used: hand.map(() => false), lastFiredAt: null };
}

export function ammoLeft(state: BoardState): number {
  return state.used.filter((u) => !u).length;
}

/** 0 = vient de tirer, 1 = prêt. */
export function reloadProgress(state: BoardState, now: number, cfg: Config = gameConfig): number {
  if (state.lastFiredAt === null) return 1;
  return Math.min(1, Math.max(0, (now - state.lastFiredAt) / cfg.soundboard.reloadMs));
}

export function canFire(state: BoardState, index: number, now: number, cfg: Config = gameConfig): FireCheck {
  if (index < 0 || index >= state.hand.length) return 'invalid';
  if (state.used[index]) return 'used';
  if (reloadProgress(state, now, cfg) < 1) return 'reload';
  return 'ok';
}

export function fire(state: BoardState, index: number, now: number): BoardState {
  return {
    ...state,
    used: state.used.map((u, i) => u || i === index),
    lastFiredAt: now,
  };
}
