import { describe, expect, it } from 'vitest';
import { SoloRound } from './machine';
import { gameConfig } from './gameConfig';
import { applyEvent, createRoundState, decideByTime, roundPhase, tick } from './scoring';

const farming = { ...gameConfig, round: { ...gameConfig.round, farmingPerSecond: 10 } };
const calm = { smiling: false, headMoving: false, faceLost: false };

describe('roundPhase', () => {
  it('enchaîne compte à rebours, grâce, jeu, fin', () => {
    expect(roundPhase(0)).toBe('countdown');
    expect(roundPhase(2999)).toBe('countdown');
    expect(roundPhase(3000)).toBe('grace');
    expect(roundPhase(4999)).toBe('grace');
    expect(roundPhase(5000)).toBe('play');
    expect(roundPhase(62_999)).toBe('play');
    expect(roundPhase(63_000)).toBe('ended');
  });
});

describe('applyEvent', () => {
  const play = (type: Parameters<typeof applyEvent>[1]['type'], upgrade?: boolean) =>
    applyEvent(createRoundState(), { type, t: 0, upgrade }, 'play');

  it('applique les montants du tableau des règles', () => {
    expect(play('smileLight').state.aura).toBe(850);
    expect(play('smileFull').state.aura).toBe(600);
    expect(play('faceLost').state.aura).toBe(800);
  });

  it('facture seulement la différence pour un sourire franc après un léger', () => {
    expect(play('smileFull', true).delta).toBe(-250);
  });

  it('un rire met fin à la manche', () => {
    const r = play('laugh');
    expect(r.state.ended).toBe('crack');
    expect(r.state.aura).toBe(0);
  });

  it('ne pénalise pas pendant le compte à rebours ni la grâce', () => {
    for (const phase of ['countdown', 'grace'] as const) {
      const r = applyEvent(createRoundState(), { type: 'laugh', t: 0 }, phase);
      expect(r.state).toEqual(createRoundState());
      expect(r.delta).toBe(0);
    }
  });

  it('ignore les événements après la fin', () => {
    const ended = { aura: 0, ended: 'zero' as const };
    expect(applyEvent(ended, { type: 'smileLight', t: 0 }, 'play').state).toBe(ended);
  });
});

describe('tick', () => {
  it('ne bouge pas quand il ne se passe rien (farming à 0 par défaut)', () => {
    expect(tick(createRoundState(), 1000, 'play', calm).aura).toBe(1000);
  });

  it('farme +10/s quand neutre et immobile si le farming est activé', () => {
    expect(tick(createRoundState(), 1000, 'play', calm, farming).aura).toBeCloseTo(1010);
  });

  it('ne farme pas hors phase de jeu', () => {
    expect(tick(createRoundState(), 1000, 'grace', calm, farming).aura).toBe(1000);
  });

  it('ne farme pas en souriant et pénalise le mouvement de tête', () => {
    expect(tick(createRoundState(), 1000, 'play', { ...calm, smiling: true }, farming).aura).toBe(1000);
    expect(tick(createRoundState(), 1000, 'play', { ...calm, headMoving: true }).aura).toBeCloseTo(950);
  });

  it('pénalise le visage perdu de 100/s', () => {
    expect(tick(createRoundState(), 1000, 'play', { ...calm, faceLost: true }).aura).toBeCloseTo(900);
  });

  it('termine la manche à 0 d’aura sans passer sous 0', () => {
    const r = tick({ aura: 20, ended: null }, 1000, 'play', { ...calm, faceLost: true });
    expect(r).toEqual({ aura: 0, ended: 'zero' });
  });

  it('termine la manche au temps', () => {
    expect(tick(createRoundState(), 16, 'ended', calm).ended).toBe('time');
  });

  it('ne change plus rien une fois terminée', () => {
    const ended = { aura: 5, ended: 'crack' as const };
    expect(tick(ended, 1000, 'play', calm)).toBe(ended);
  });
});

describe('decideByTime', () => {
  it('désigne le plus haut score', () => {
    expect(decideByTime(1500, 1000)).toBe('a');
    expect(decideByTime(900, 1000)).toBe('b');
  });
  it('mort subite si l’écart est inférieur à 50', () => {
    expect(decideByTime(1000, 1049)).toBe('suddenDeath');
    expect(decideByTime(1000, 1050)).toBe('b');
  });
});

describe('SoloRound', () => {
  const out = (events: { type: 'smileLight' | 'laugh'; t: number }[] = [], flags = calm) => ({ events, flags });

  it('déroule une manche complète et farme pendant le jeu', () => {
    const round = new SoloRound(0, false, farming);
    expect(round.step(1000, out()).countdown).toBe(2);
    let snap = round.step(1000, out());
    for (let t = 1000; t <= 63_000; t += 100) snap = round.step(t, out());
    expect(snap.ended).toBe('time');
    expect(snap.aura).toBeGreaterThan(1500);
  });

  it('un rire en phase de jeu termine la manche et expose le delta', () => {
    const round = new SoloRound(0);
    round.step(6000, out());
    const snap = round.step(6100, out([{ type: 'laugh', t: 6100 }]));
    expect(snap.ended).toBe('crack');
    expect(snap.deltas).toEqual([gameConfig.penalties.laugh.aura]);
    expect(round.step(7000, out())).toBe(snap);
  });
});

describe('SoloRound avec adversaire', () => {
  const quiet = { events: [], flags: calm };

  it('l’adversaire qui craque perd, et on gagne', () => {
    const round = new SoloRound(0, true);
    round.step(6000, quiet, quiet);
    const snap = round.step(6100, quiet, { events: [{ type: 'laugh', t: 6100 }], flags: calm });
    expect(snap.winner).toBe('me');
    expect(snap.oppDeltas).toEqual([gameConfig.penalties.laugh.aura]);
    expect(snap.ended).toBe('crack');
  });

  it('au temps, le plus d’aura gagne ; égalité à moins de 50 : nul', () => {
    const hit = { events: [{ type: 'smileLight' as const, t: 0 }], flags: calm };
    const a = new SoloRound(0, true);
    a.step(6000, quiet, hit);
    expect(a.step(63_000, quiet, quiet).winner).toBe('me');
    const b = new SoloRound(0, true);
    b.step(6000, quiet, quiet);
    expect(b.step(63_000, quiet, quiet).winner).toBe('draw');
  });

  it('les deux craquent sur la même image : nul', () => {
    const laugh = { events: [{ type: 'laugh' as const, t: 6000 }], flags: calm };
    const r = new SoloRound(0, true);
    expect(r.step(6000, laugh, laugh).winner).toBe('draw');
  });
});
