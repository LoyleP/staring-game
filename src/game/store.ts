import { create } from 'zustand';
import type { DetectorDebug } from '../vision/detector';
import type { Expression } from './fakeOpponent';
import type { SoundDef } from '../audio/sounds';
import type { RoundSnapshot } from './machine';

export type SoloScreen =
  | 'prepare'
  | 'loading'
  | 'denied'
  | 'error'
  | 'calibrating'
  | 'ready'
  | 'running'
  | 'ended';

export interface Floater {
  id: number;
  side: 'me' | 'opp';
  delta: number;
}

export interface HandCard {
  sound: SoundDef;
  used: boolean;
}

export interface DebugInfo extends DetectorDebug {
  fps: number;
  mode: string;
  delegate: string;
  recent: string[];
}

interface SoloStore {
  screen: SoloScreen;
  message: string | null;
  calibProgress: number;
  snap: RoundSnapshot | null;
  floaters: Floater[];
  oppExpression: Expression;
  hand: HandCard[];
  /** 0 = recharge en cours, 1 = prêt. */
  reload: number;
  debug: DebugInfo | null;
  set: (patch: Partial<Omit<SoloStore, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const initial = {
  screen: 'prepare' as SoloScreen,
  message: null,
  calibProgress: 0,
  snap: null,
  floaters: [] as Floater[],
  oppExpression: 'neutral' as Expression,
  hand: [] as HandCard[],
  reload: 1,
  debug: null,
};

export const useSoloStore = create<SoloStore>()((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set(initial),
}));
