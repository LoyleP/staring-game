/** Toutes les valeurs ajustables en playtest. */
export const gameConfig = {
  match: { roundsToWin: 2, maxRounds: 3 },
  round: {
    durationMs: 60_000,
    countdownMs: 3_000,
    graceMs: 2_000,
    startAura: 1000,
    /** Gain passif par seconde en restant neutre. 0 = la jauge ne bouge que sur un événement. */
    farmingPerSecond: 0,
    tieMargin: 50,
    suddenDeathMs: 15_000,
  },
  penalties: {
    smileLight: { threshold: 0.5, minMs: 400, aura: -150, cooldownMs: 1_500 },
    smileFull: { threshold: 0.75, minMs: 400, aura: -400, cooldownMs: 1_500 },
    laugh: { smile: 0.6, jawOpen: 0.55, minMs: 500, aura: -1000 },
    headMove: { nosePct: 0.12, minMs: 700, auraPerSecond: -50 },
    faceLost: { minMs: 1_000, aura: -200, auraPerSecond: -100 },
  },
  detection: {
    smoothing: 0.4,
    hysteresis: 0.8,
    maxEffectiveThreshold: 0.9,
    /** Constante de temps de la référence du nez : une position tenue est absorbée, seul un mouvement compte. */
    headReferenceTauMs: 4_000,
    calibrationMs: 3_000,
    calibrationMinDetected: 0.8,
    inferenceFps: 15,
    inferenceFpsMainThread: 10,
  },
  soundboard: { ammoPerRound: 3, reloadMs: 8_000, auraCost: -50, playDelayMs: 150 },
  net: {
    maxPlayers: 2,
    wsFailuresBeforePolling: 2,
    pollIntervalMs: 500,
    pingIntervalMs: 20_000,
    reconnectGraceMs: 15_000,
    iceRestartDelayMs: 3_000,
    forceSignalPolling: false,
  },
  media: { width: 480, height: 640, fps: 24, maxBitrateKbps: 600 },
  room: { codeLength: 6, ttlSeconds: 7_200, createLimitPerHour: 10 },
};
