import { describe, expect, it } from 'vitest';
import { FakeOpponent } from './fakeOpponent';

function simulate(seed: number, durationMs: number) {
  const bot = new FakeOpponent(seed);
  const types: string[] = [];
  for (let t = 0; t < durationMs; t += 67) {
    const { out } = bot.step(t, 'play');
    types.push(...out.events.map((e) => e.type));
  }
  return types;
}

describe('FakeOpponent', () => {
  it('reste neutre hors phase de jeu', () => {
    const bot = new FakeOpponent(1);
    for (let t = 0; t < 10_000; t += 100) {
      const r = bot.step(t, 'countdown');
      expect(r.out.events).toEqual([]);
      expect(r.expression).toBe('neutral');
    }
  });

  it('est déterministe pour une graine donnée', () => {
    expect(simulate(42, 60_000)).toEqual(simulate(42, 60_000));
  });

  it('produit des événements au fil d’une manche', () => {
    const all = [3, 4, 5, 6, 7].flatMap((s) => simulate(s, 60_000));
    expect(all.length).toBeGreaterThan(5);
  });
});
