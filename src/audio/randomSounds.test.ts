import { describe, expect, it } from 'vitest';
import { gameConfig } from '../game/gameConfig';
import { RandomSoundScheduler } from './randomSounds';

const cfg = (over: Partial<typeof gameConfig.randomSounds> = {}) => ({
  ...gameConfig,
  randomSounds: { ...gameConfig.randomSounds, ...over },
});

describe('RandomSoundScheduler', () => {
  it('attend le premier délai puis espacer les sons', () => {
    const s = new RandomSoundScheduler(cfg(), () => 0); // rand = 0 → délais minimaux
    expect(s.due(0)).toBe(false); // programme le premier à 5000
    expect(s.due(4999)).toBe(false);
    expect(s.due(5000)).toBe(true);
    expect(s.due(5001)).toBe(false);
    expect(s.due(5000 + 6999)).toBe(false);
    expect(s.due(5000 + 7000)).toBe(true);
  });

  it('respecte les bornes maximales', () => {
    const s = new RandomSoundScheduler(cfg(), () => 0.999);
    s.due(0);
    expect(s.due(11_990)).toBe(false);
    expect(s.due(12_001)).toBe(true);
  });

  it('ne joue rien si désactivé', () => {
    const s = new RandomSoundScheduler(cfg({ enabled: false }));
    for (let t = 0; t < 100_000; t += 1000) expect(s.due(t)).toBe(false);
  });

  it('reset repart d’un premier délai', () => {
    const s = new RandomSoundScheduler(cfg(), () => 0);
    s.due(0);
    s.due(5000);
    s.reset();
    expect(s.due(6000)).toBe(false);
    expect(s.due(11_000)).toBe(true);
  });

  it('choisit dans le catalogue, null si vide', () => {
    const s = new RandomSoundScheduler(cfg(), () => 0.5);
    expect(s.pick(['a', 'b', 'c', 'd'])).toBe('c');
    expect(s.pick([])).toBeNull();
  });
});
