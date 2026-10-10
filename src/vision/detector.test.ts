import { describe, expect, it } from 'vitest';
import { Calibrator } from './calibration';
import { FaceEventDetector, frameFromResult } from './detector';
import type { Baseline, DetectorOutput, FaceEvent, FaceFrame } from './types';

const DT = 1000 / 15;
const BASE: Baseline = { smile: 0, jawOpen: 0, noseX: 240, noseY: 320, faceWidth: 200 };

type Sample = Partial<Omit<FaceFrame, 't'>> & { smile?: number };

function frame(t: number, s: Sample = {}): FaceFrame {
  const smile = s.smile ?? 0;
  return {
    t,
    face: s.face ?? true,
    smileL: s.smileL ?? smile,
    smileR: s.smileR ?? smile,
    jawOpen: s.jawOpen ?? 0,
    noseX: s.noseX ?? BASE.noseX,
    noseY: s.noseY ?? BASE.noseY,
    faceWidth: s.faceWidth ?? BASE.faceWidth,
  };
}

/** Joue `durationMs` d'une même mesure à 15 images/s et collecte les événements. */
function run(
  det: FaceEventDetector,
  from: number,
  durationMs: number,
  s: Sample = {},
): { events: FaceEvent[]; last: DetectorOutput; end: number } {
  const events: FaceEvent[] = [];
  let last: DetectorOutput = { events: [], flags: { smiling: false, headMoving: false, faceLost: false } };
  let t = from;
  for (; t < from + durationMs; t += DT) {
    last = det.update(frame(t, s));
    events.push(...last.events);
  }
  return { events, last, end: t };
}

describe('FaceEventDetector', () => {
  it('ne déclenche rien pour un visage neutre stable pendant 60 s', () => {
    const det = new FaceEventDetector(BASE);
    const r = run(det, 0, 60_000, { smile: 0.05, jawOpen: 0.05 });
    expect(r.events).toEqual([]);
    expect(r.last.flags).toEqual({ smiling: false, headMoving: false, faceLost: false });
  });

  it('ignore un sourire plus bref que la durée minimale', () => {
    const det = new FaceEventDetector(BASE);
    const a = run(det, 0, 1000);
    const b = run(det, a.end, 130, { smile: 0.7 });
    const c = run(det, b.end, 2000);
    expect([...a.events, ...b.events, ...c.events]).toEqual([]);
  });

  it('pénalise un sourire léger tenu une seule fois', () => {
    const det = new FaceEventDetector(BASE);
    const a = run(det, 0, 1000);
    const b = run(det, a.end, 4000, { smile: 0.45 });
    expect(b.events.map((e) => e.type)).toEqual(['smileLight']);
    expect(b.last.flags.smiling).toBe(true);
  });

  it('un sourire franc tenu déclenche léger puis franc (upgrade)', () => {
    const det = new FaceEventDetector(BASE);
    const a = run(det, 0, 1000);
    const b = run(det, a.end, 3000, { smile: 0.75 });
    expect(b.events.map((e) => [e.type, e.upgrade ?? false])).toEqual([
      ['smileLight', false],
      ['smileFull', true],
    ]);
  });

  it('le cooldown empêche deux sourires rapprochés d’être comptés', () => {
    const det = new FaceEventDetector(BASE);
    let t = 0;
    const all: FaceEvent[] = [];
    for (let i = 0; i < 2; i++) {
      const smile = run(det, t, 600, { smile: 0.5 });
      const rest = run(det, smile.end, 300);
      all.push(...smile.events, ...rest.events);
      t = rest.end;
    }
    expect(all.filter((e) => e.type === 'smileLight')).toHaveLength(1);
  });

  it('détecte un rire (sourire + bouche ouverte)', () => {
    const det = new FaceEventDetector(BASE);
    const a = run(det, 0, 1000);
    const b = run(det, a.end, 1500, { smile: 0.7, jawOpen: 0.7 });
    expect(b.events.map((e) => e.type)).toContain('laugh');
  });

  it('ne pénalise pas une grimace bouche ouverte sans sourire', () => {
    const det = new FaceEventDetector(BASE);
    const r = run(det, 0, 5000, { smile: 0.05, jawOpen: 0.9 });
    expect(r.events).toEqual([]);
  });

  it('détecte le visage perdu après 1 s, une seule fois, et se réarme', () => {
    const det = new FaceEventDetector(BASE);
    const a = run(det, 0, 500);
    const lost = run(det, a.end, 3000, { face: false });
    expect(lost.events.map((e) => e.type)).toEqual(['faceLost']);
    expect(lost.last.flags.faceLost).toBe(true);
    const back = run(det, lost.end, 500);
    expect(back.last.flags.faceLost).toBe(false);
    const again = run(det, back.end, 2000, { face: false });
    expect(again.events).toHaveLength(1);
  });

  it('ne signale pas un visage perdu de moins d’une seconde', () => {
    const det = new FaceEventDetector(BASE);
    const r = run(det, 0, 800, { face: false });
    expect(r.events).toEqual([]);
  });

  it('active headMoving quand le nez dévie de plus de 8 % de la largeur du visage', () => {
    const det = new FaceEventDetector(BASE);
    const a = run(det, 0, 1000);
    const b = run(det, a.end, 1500, { noseX: BASE.noseX + 0.2 * BASE.faceWidth });
    expect(b.last.flags.headMoving).toBe(true);
    const c = run(det, b.end, 1500);
    expect(c.last.flags.headMoving).toBe(false);
  });

  it('neutralise un sourire au repos grâce à la calibration', () => {
    const restingSmile: Baseline = { ...BASE, smile: 0.3 };
    const det = new FaceEventDetector(restingSmile);
    expect(det.thresholds.smileLight).toBeCloseTo(0.65);
    expect(run(det, 0, 5000, { smile: 0.4 }).events).toEqual([]);
    const plain = new FaceEventDetector(BASE);
    expect(run(plain, 0, 5000, { smile: 0.4 }).events.map((e) => e.type)).toEqual(['smileLight']);
  });

  it('plafonne le seuil effectif à 0,9', () => {
    const det = new FaceEventDetector({ ...BASE, smile: 0.8, jawOpen: 0.8 });
    expect(det.thresholds.smileFull).toBe(0.9);
    expect(det.thresholds.laughJaw).toBe(0.9);
  });

  it('moyenne gauche et droite : une asymétrie ne suffit pas', () => {
    const det = new FaceEventDetector(BASE);
    const r = run(det, 0, 3000, { smileL: 0.6, smileR: 0 });
    expect(r.events).toEqual([]);
  });
});

describe('Calibrator', () => {
  it('moyenne les mesures neutres', () => {
    const c = new Calibrator();
    for (let i = 0; i < 45; i++) c.add(frame(i * DT, { smile: 0.1, jawOpen: 0.2 }));
    const b = c.finish();
    expect(b?.smile).toBeCloseTo(0.1);
    expect(b?.jawOpen).toBeCloseTo(0.2);
    expect(b?.faceWidth).toBe(200);
  });

  it('échoue sous 80 % de visages détectés ou sans image', () => {
    expect(new Calibrator().finish()).toBeNull();
    const c = new Calibrator();
    for (let i = 0; i < 10; i++) c.add(frame(i, { face: i < 7 }));
    expect(c.finish()).toBeNull();
    expect(c.frames).toBe(10);
  });
});

describe('frameFromResult', () => {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[1] = { x: 0.5, y: 0.6 };
  lm[234] = { x: 0.3, y: 0.5 };
  lm[454] = { x: 0.7, y: 0.5 };

  it('convertit landmarks et blendshapes', () => {
    const f = frameFromResult(
      {
        faceLandmarks: [lm],
        faceBlendshapes: [
          {
            categories: [
              { categoryName: 'mouthSmileLeft', score: 0.4 },
              { categoryName: 'mouthSmileRight', score: 0.2 },
              { categoryName: 'jawOpen', score: 0.1 },
            ],
          },
        ],
      },
      480,
      640,
      10,
    );
    expect(f).toMatchObject({ face: true, smileL: 0.4, smileR: 0.2, jawOpen: 0.1, noseX: 240, noseY: 384 });
    expect(f.faceWidth).toBeCloseTo(192);
  });

  it('signale l’absence de visage', () => {
    expect(frameFromResult({ faceLandmarks: [] }, 480, 640, 5).face).toBe(false);
  });
});
