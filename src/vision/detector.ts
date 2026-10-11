import { gameConfig } from '../game/gameConfig';
import type { Baseline, DetectorOutput, FaceEvent, FaceFlags, FaceFrame } from './types';

type Config = typeof gameConfig;

/** Structure minimale du résultat MediaPipe, pour rester testable sans la bibliothèque. */
export interface LandmarkerResultLike {
  faceLandmarks: { x: number; y: number }[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
}

const NOSE = 1;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;

export function frameFromResult(
  result: LandmarkerResultLike,
  width: number,
  height: number,
  t: number,
): FaceFrame {
  const lm = result.faceLandmarks[0];
  const nose = lm?.[NOSE];
  const left = lm?.[FACE_LEFT];
  const right = lm?.[FACE_RIGHT];
  if (!lm || !nose || !left || !right) {
    return { t, face: false, smileL: 0, smileR: 0, jawOpen: 0, noseX: 0, noseY: 0, faceWidth: 1 };
  }
  const score = (name: string) =>
    result.faceBlendshapes?.[0]?.categories.find((c) => c.categoryName === name)?.score ?? 0;
  return {
    t,
    face: true,
    smileL: score('mouthSmileLeft'),
    smileR: score('mouthSmileRight'),
    jawOpen: score('jawOpen'),
    noseX: nose.x * width,
    noseY: nose.y * height,
    faceWidth: Math.max(1, Math.hypot((right.x - left.x) * width, (right.y - left.y) * height)),
  };
}

/** Seuil maintenu pendant `minMs`, avec hystérésis : se termine sous `hysteresis` × seuil. */
class Hold {
  private since: number | null = null;
  active = false;

  /** Renvoie true à l'instant où l'événement se déclenche. */
  update(t: number, above: boolean, released: boolean, minMs: number): boolean {
    if (this.active) {
      if (released) this.reset();
      return false;
    }
    if (!above) {
      this.since = null;
      return false;
    }
    this.since ??= t;
    if (t - this.since >= minMs) {
      this.active = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.since = null;
    this.active = false;
  }
}

export interface DetectorDebug {
  smile: number;
  jawOpen: number;
  headOffset: number;
  thresholds: { smileLight: number; smileFull: number; laughSmile: number; laughJaw: number };
}

export class FaceEventDetector {
  private smile = 0;
  private jaw = 0;
  private offset = 0;
  private hasSmoothed = false;
  private ref: { x: number; y: number };
  private lastT: number | null = null;
  private light = new Hold();
  private full = new Hold();
  private laugh = new Hold();
  private head = new Hold();
  private lostSince: number | null = null;
  private lost = false;
  private lastFired: Partial<Record<FaceEvent['type'], number>> = {};
  readonly thresholds: DebugThresholds;

  constructor(
    private readonly baseline: Baseline,
    private readonly cfg: Config = gameConfig,
  ) {
    this.ref = { x: baseline.noseX, y: baseline.noseY };
    const cap = cfg.detection.maxEffectiveThreshold;
    const eff = (th: number, base: number) => Math.min(base + th, cap);
    const p = cfg.penalties;
    this.thresholds = {
      smileLight: eff(p.smileLight.threshold, baseline.smile),
      smileFull: eff(p.smileFull.threshold, baseline.smile),
      laughSmile: eff(p.laugh.smile, baseline.smile),
      laughJaw: eff(p.laugh.jawOpen, baseline.jawOpen),
    };
  }

  get debug(): DetectorDebug {
    return {
      smile: this.smile,
      jawOpen: this.jaw,
      headOffset: this.offset,
      thresholds: this.thresholds,
    };
  }

  update(frame: FaceFrame): DetectorOutput {
    const { t } = frame;
    const { smoothing: a, hysteresis: h } = this.cfg.detection;
    const p = this.cfg.penalties;
    const events: FaceEvent[] = [];

    if (!frame.face) {
      this.light.reset();
      this.full.reset();
      this.laugh.reset();
      this.head.reset();
      this.hasSmoothed = false;
      this.lastT = null;
      this.lostSince ??= t;
      if (!this.lost && t - this.lostSince >= p.faceLost.minMs) {
        this.lost = true;
        events.push({ type: 'faceLost', t });
      }
      return { events, flags: this.flags() };
    }
    this.lostSince = null;
    this.lost = false;

    const smile = (frame.smileL + frame.smileR) / 2;
    // Référence du nez qui suit lentement la position réelle : on pénalise le mouvement, pas la pose.
    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    const offset =
      Math.hypot(frame.noseX - this.ref.x, frame.noseY - this.ref.y) / this.baseline.faceWidth;
    const k = 1 - Math.exp(-dt / this.cfg.detection.headReferenceTauMs);
    this.ref.x += k * (frame.noseX - this.ref.x);
    this.ref.y += k * (frame.noseY - this.ref.y);
    if (this.hasSmoothed) {
      this.smile += a * (smile - this.smile);
      this.jaw += a * (frame.jawOpen - this.jaw);
      this.offset += a * (offset - this.offset);
    } else {
      [this.smile, this.jaw, this.offset] = [smile, frame.jawOpen, offset];
      this.hasSmoothed = true;
    }

    const th = this.thresholds;
    const fire = (type: FaceEvent['type'], cooldownMs: number, extra?: Partial<FaceEvent>) => {
      const last = this.lastFired[type];
      if (last !== undefined && t - last < cooldownMs) return;
      this.lastFired[type] = t;
      events.push({ type, t, ...extra });
    };

    if (this.light.update(t, this.smile > th.smileLight, this.smile < th.smileLight * h, p.smileLight.minMs)) {
      fire('smileLight', p.smileLight.cooldownMs);
    }
    if (this.full.update(t, this.smile > th.smileFull, this.smile < th.smileFull * h, p.smileFull.minMs)) {
      fire('smileFull', p.smileFull.cooldownMs, { upgrade: this.light.active });
    }
    const laughOn = this.smile > th.laughSmile && this.jaw > th.laughJaw;
    const laughOff = this.smile < th.laughSmile * h || this.jaw < th.laughJaw * h;
    if (this.laugh.update(t, laughOn, laughOff, p.laugh.minMs)) {
      events.push({ type: 'laugh', t });
    }
    this.head.update(t, this.offset > p.headMove.nosePct, this.offset < p.headMove.nosePct * h, p.headMove.minMs);

    return { events, flags: this.flags() };
  }

  private flags(): FaceFlags {
    return { smiling: this.light.active, headMoving: this.head.active, faceLost: this.lost };
  }
}

type DebugThresholds = DetectorDebug['thresholds'];
