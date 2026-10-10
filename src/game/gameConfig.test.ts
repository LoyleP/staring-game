import { describe, expect, it } from 'vitest';
import { gameConfig } from './gameConfig';

describe('gameConfig', () => {
  it('suit les règles de départ', () => {
    expect(gameConfig.round.durationMs).toBe(60_000);
    expect(gameConfig.match.roundsToWin).toBe(2);
  });
});
