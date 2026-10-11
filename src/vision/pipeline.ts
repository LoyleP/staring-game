import { gameConfig } from '../game/gameConfig';
import { Calibrator } from './calibration';
import { FaceEventDetector, type DetectorDebug } from './detector';
import { startFaceTracker, type FaceTracker } from './faceTracker';
import type { Baseline, DetectorOutput, FaceFrame } from './types';

export const CLOSER_MESSAGE = 'Rapproche-toi de la caméra';

/** Suivi du visage pour les duels : calibration puis détection d'événements, sur un flux déjà actif. */
export class VisionPipeline {
  private tracker: FaceTracker | null = null;
  private mode: 'idle' | 'calibrating' | 'watching' = 'idle';
  private calibrator = new Calibrator();
  private calibStart: number | null = null;
  private detector: FaceEventDetector | null = null;
  private onCalib: { progress: (p: number, message: string | null) => void; done: () => void } | null = null;
  private onWatch: ((out: DetectorOutput, frame: FaceFrame) => void) | null = null;
  baseline: Baseline | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    this.tracker ??= await startFaceTracker(this.video, (f) => this.onFrame(f));
  }

  stats(): { fps: number; mode: string; delegate: string } {
    return { fps: this.tracker?.fps() ?? 0, mode: this.tracker?.mode ?? '-', delegate: this.tracker?.delegate ?? '-' };
  }

  get debug(): DetectorDebug | null {
    return this.detector?.debug ?? null;
  }

  /** Calibre pendant 3 s ; recommence seul si le visage est trop loin ou perdu. */
  calibrate(cb: { progress: (p: number, message: string | null) => void; done: () => void }): void {
    this.onCalib = cb;
    this.resetCalibration();
    this.mode = 'calibrating';
  }

  /** Démarre la détection avec la référence calibrée ; `cb` reçoit chaque image analysée. */
  watch(cb: (out: DetectorOutput, frame: FaceFrame) => void): void {
    if (!this.baseline) return;
    this.detector = new FaceEventDetector(this.baseline);
    this.onWatch = cb;
    this.mode = 'watching';
  }

  idle(): void {
    this.mode = 'idle';
    this.onWatch = null;
  }

  stop(): void {
    this.idle();
    this.tracker?.stop();
    this.tracker = null;
  }

  private resetCalibration(): void {
    this.calibrator = new Calibrator();
    this.calibStart = null;
  }

  private onFrame(frame: FaceFrame): void {
    if (this.mode === 'watching') this.onWatch?.(this.detector?.update(frame) ?? { events: [], flags: { smiling: false, headMoving: false, faceLost: false } }, frame);
    else if (this.mode === 'calibrating') this.calibrate1(frame);
  }

  private calibrate1(frame: FaceFrame): void {
    const cb = this.onCalib;
    if (!cb) return;
    const ratio = frame.imageWidth ? frame.faceWidth / frame.imageWidth : 1;
    if (frame.face && ratio < gameConfig.detection.minFaceWidthRatio) {
      this.resetCalibration();
      cb.progress(0, CLOSER_MESSAGE);
      return;
    }
    this.calibStart ??= frame.t;
    this.calibrator.add(frame);
    const progress = Math.min(1, (frame.t - this.calibStart) / gameConfig.detection.calibrationMs);
    if (progress < 1) return cb.progress(progress, null);
    this.baseline = this.calibrator.finish();
    if (this.baseline) {
      this.mode = 'idle';
      cb.progress(1, null);
      cb.done();
    } else {
      this.resetCalibration();
      cb.progress(0, 'Visage non détecté. On recommence : place-toi dans l’ovale.');
    }
  }
}
