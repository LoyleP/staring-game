import { describe, expect, it } from 'vitest';
import { ammoLeft, canFire, createBoard, fire, pickHand, reloadProgress } from './board';

const ids = Array.from({ length: 20 }, (_, i) => `s${i}`);
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length] ?? 0;
};

describe('soundboard', () => {
  it('tire une main de 3 sons distincts', () => {
    const hand = pickHand(ids, 3);
    expect(hand).toHaveLength(3);
    expect(new Set(hand).size).toBe(3);
  });

  it('gère un catalogue plus petit que la main', () => {
    expect(pickHand(['a', 'b'], 3)).toHaveLength(2);
  });

  it('démarre avec 3 munitions et prêt à tirer', () => {
    const b = createBoard(ids, undefined, seq(0.1, 0.5, 0.9));
    expect(ammoLeft(b)).toBe(3);
    expect(canFire(b, 0, 0)).toBe('ok');
  });

  it('applique recharge de 8 s après un tir, pour tous les boutons', () => {
    let b = createBoard(ids);
    b = fire(b, 0, 1000);
    expect(ammoLeft(b)).toBe(2);
    expect(canFire(b, 1, 2000)).toBe('reload');
    expect(reloadProgress(b, 5000)).toBeCloseTo(0.5);
    expect(canFire(b, 1, 9000)).toBe('ok');
  });

  it('une carte utilisée ne peut plus servir', () => {
    let b = createBoard(ids);
    b = fire(b, 0, 0);
    expect(canFire(b, 0, 20_000)).toBe('used');
  });

  it('refuse un index invalide et s’épuise après 3 tirs', () => {
    let b = createBoard(ids);
    expect(canFire(b, 5, 0)).toBe('invalid');
    b = fire(fire(fire(b, 0, 0), 1, 10_000), 2, 20_000);
    expect(ammoLeft(b)).toBe(0);
  });
});
