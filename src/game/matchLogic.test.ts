import { describe, expect, it } from 'vitest';
import type { MatchResult } from '../net/protocol';
import {
  addWin,
  clockOffsetSample,
  decideAtTime,
  decideCrack,
  decideSuddenDeath,
  matchWinner,
  medianOffset,
} from './matchLogic';

const result = (winner: MatchResult['winner']): MatchResult => ({ winner, reason: 'time', hostAura: 0, guestAura: 0 });

describe('décisions de manche', () => {
  it('au temps : le plus haut gagne, écart < 50 : mort subite', () => {
    expect(decideAtTime(1000, 600)).toBe('host');
    expect(decideAtTime(500, 600)).toBe('guest');
    expect(decideAtTime(1000, 1049)).toBe('suddenDeath');
  });

  it('mort subite : strict, égalité parfaite = nul', () => {
    expect(decideSuddenDeath(900, 899)).toBe('host');
    expect(decideSuddenDeath(899, 900)).toBe('guest');
    expect(decideSuddenDeath(900, 900)).toBe('draw');
  });

  it('un craquage fait gagner l’autre, deux craquages sont nuls', () => {
    expect(decideCrack(['host'])).toBe('guest');
    expect(decideCrack(['guest'])).toBe('host');
    expect(decideCrack(['host', 'guest'])).toBe('draw');
  });
});

describe('score de la partie', () => {
  it('compte les manches, ignore les nuls, premier à 2 gagne', () => {
    let wins = { host: 0, guest: 0 };
    wins = addWin(wins, result('draw'));
    expect(wins).toEqual({ host: 0, guest: 0 });
    wins = addWin(wins, result('guest'));
    expect(matchWinner(wins)).toBeNull();
    wins = addWin(wins, result('host'));
    wins = addWin(wins, result('guest'));
    expect(matchWinner(wins)).toBe('guest');
  });
});

describe('synchronisation d’horloge', () => {
  it('calcule le décalage hôte − local, quel que soit l’aller-retour symétrique', () => {
    // horloge hôte en avance de 5000 ms, aller-retour de 100 ms
    expect(clockOffsetSample(1000, 1050 + 5000, 1100)).toBeCloseTo(5000);
  });

  it('médiane robuste aux valeurs aberrantes', () => {
    expect(medianOffset([4990, 5000, 5010, 9000, 4995])).toBe(5000);
    expect(medianOffset([10, 20])).toBe(15);
    expect(medianOffset([])).toBe(0);
  });
});
