import { create } from 'zustand';
import type { MatchResult } from '../net/protocol';
import type { RoundSnapshot } from './machine';
import type { Floater } from './store';

export type DuelPhase = 'idle' | 'round' | 'between' | 'ended';
export type SideView = 'me' | 'opp';

export interface RoundSummary {
  winner: SideView | 'draw';
  reason: MatchResult['reason'];
  meAura: number;
  oppAura: number;
}

interface DuelStore {
  phase: DuelPhase;
  round: number;
  wins: { me: number; opp: number };
  snap: RoundSnapshot | null;
  floaters: Floater[];
  lastRound: RoundSummary | null;
  summaries: RoundSummary[];
  matchWinner: SideView | null;
  forfeit: boolean;
  suddenDeath: boolean;
  /** Secondes restantes avant la victoire par forfait, si l'adversaire est injoignable. */
  forfeitIn: number | null;
  rematchMe: boolean;
  rematchOpp: boolean;
  set: (patch: Partial<Omit<DuelStore, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const initial = {
  phase: 'idle' as DuelPhase,
  round: 0,
  wins: { me: 0, opp: 0 },
  snap: null,
  floaters: [] as Floater[],
  lastRound: null,
  summaries: [] as RoundSummary[],
  matchWinner: null,
  forfeit: false,
  suddenDeath: false,
  forfeitIn: null,
  rematchMe: false,
  rematchOpp: false,
};

export const createDuelStore = () =>
  create<DuelStore>()((set) => ({
    ...initial,
    set: (patch) => set(patch),
    reset: () => set(initial),
  }));

export type DuelStoreHook = ReturnType<typeof createDuelStore>;

export const useDuelStore = createDuelStore();
