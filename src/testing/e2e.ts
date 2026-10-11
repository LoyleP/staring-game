/**
 * Points d'accroche pour les tests de bout en bout (Playwright). Inactifs en production :
 * ils exigent un build de développement ET `window.__AURA_E2E__ = true` posé par le test avant le chargement.
 */
export interface E2EWindow {
  __AURA_E2E__?: boolean;
  /** Force la signalisation par polling (test du repli). */
  __AURA_FORCE_POLL__?: boolean;
  /** Visage simulé que lit le faux suivi facial ; le test modifie ces valeurs pour sourire, rire, bouger. */
  __auraFace?: { face: boolean; smile: number; jaw: number; noseDx: number };
  /** Journal des sons réellement programmés dans l'AudioContext. */
  __auraAudioLog?: { id: string; state: string; at: number; loaded: boolean }[];
  __auraAudioStatus?: () => unknown;
}

export const e2eWindow = (): E2EWindow => (typeof window === 'undefined' ? {} : (window as unknown as E2EWindow));

export function e2e(): boolean {
  return import.meta.env.DEV && e2eWindow().__AURA_E2E__ === true;
}
