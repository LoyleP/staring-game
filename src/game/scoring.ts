import type { FaceEvent, FaceFlags } from '../vision/types';
import { gameConfig } from './gameConfig';

type Config = typeof gameConfig;

export type RoundPhase = 'countdown' | 'grace' | 'play' | 'ended';
export type RoundEnd = 'crack' | 'zero' | 'time';

export interface RoundState {
  aura: number;
  ended: RoundEnd | null;
}

/**
 * Chronologie d'une manche à partir du début du compte à rebours :
 * compte à rebours, puis grâce (comprise dans la durée de la manche), puis jeu.
 */
export function roundPhase(elapsedMs: number, cfg: Config = gameConfig): RoundPhase {
  const { countdownMs, graceMs, durationMs } = cfg.round;
  if (elapsedMs < countdownMs) return 'countdown';
  if (elapsedMs < countdownMs + graceMs) return 'grace';
  if (elapsedMs < countdownMs + durationMs) return 'play';
  return 'ended';
}

export function createRoundState(cfg: Config = gameConfig): RoundState {
  return { aura: cfg.round.startAura, ended: null };
}

function withAura(state: RoundState, delta: number): RoundState {
  const aura = Math.max(0, state.aura + delta);
  return { aura, ended: state.ended ?? (aura <= 0 ? 'zero' : null) };
}

/** Coût d'une action volontaire (son lancé). Sans effet hors de la phase de jeu. */
export function spend(state: RoundState, cost: number, phase: RoundPhase): { state: RoundState; delta: number } {
  if (phase !== 'play' || state.ended) return { state, delta: 0 };
  return { state: withAura(state, cost), delta: cost };
}

/** Pénalité ponctuelle d'un événement facial. Sans effet hors de la phase de jeu. */
export function applyEvent(
  state: RoundState,
  event: FaceEvent,
  phase: RoundPhase,
  cfg: Config = gameConfig,
): { state: RoundState; delta: number } {
  if (phase !== 'play' || state.ended) return { state, delta: 0 };
  const p = cfg.penalties;
  switch (event.type) {
    case 'smileLight':
      return hit(state, p.smileLight.aura);
    case 'smileFull':
      // Un sourire léger déjà pénalisé n'est compté qu'une fois : on ne facture que la différence.
      return hit(state, event.upgrade ? p.smileFull.aura - p.smileLight.aura : p.smileFull.aura);
    case 'laugh':
      return { state: { ...withAura(state, p.laugh.aura), ended: 'crack' }, delta: p.laugh.aura };
    case 'faceLost':
      return hit(state, p.faceLost.aura);
  }
}

function hit(state: RoundState, delta: number) {
  return { state: withAura(state, delta), delta };
}

/** Évolution continue sur `dtMs` : farming si neutre et immobile, sinon pénalités par seconde. */
export function tick(
  state: RoundState,
  dtMs: number,
  phase: RoundPhase,
  flags: FaceFlags,
  cfg: Config = gameConfig,
): RoundState {
  if (state.ended) return state;
  if (phase === 'ended') return { ...state, ended: 'time' };
  if (phase !== 'play') return state;
  const s = dtMs / 1000;
  let delta = 0;
  if (flags.faceLost) delta += cfg.penalties.faceLost.auraPerSecond * s;
  else if (flags.headMoving) delta += cfg.penalties.headMove.auraPerSecond * s;
  if (!flags.faceLost && !flags.headMoving && !flags.smiling) delta += cfg.round.farmingPerSecond * s;
  return delta === 0 ? state : withAura(state, delta);
}

export type RoundOutcome = 'a' | 'b' | 'suddenDeath';

/** Vainqueur au temps ; écart inférieur à la marge → mort subite. */
export function decideByTime(auraA: number, auraB: number, cfg: Config = gameConfig): RoundOutcome {
  if (Math.abs(auraA - auraB) < cfg.round.tieMargin) return 'suddenDeath';
  return auraA > auraB ? 'a' : 'b';
}
