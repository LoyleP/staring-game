import { gameConfig } from '../game/gameConfig';
import type { Baseline, FaceFrame } from './types';

/** Moyenne des mesures neutres ; échoue si le visage manque sur trop d'images. */
export class Calibrator {
  private total = 0;
  private detected = 0;
  private sum = { smile: 0, jawOpen: 0, noseX: 0, noseY: 0, faceWidth: 0 };

  add(frame: FaceFrame): void {
    this.total += 1;
    if (!frame.face) return;
    this.detected += 1;
    this.sum.smile += (frame.smileL + frame.smileR) / 2;
    this.sum.jawOpen += frame.jawOpen;
    this.sum.noseX += frame.noseX;
    this.sum.noseY += frame.noseY;
    this.sum.faceWidth += frame.faceWidth;
  }

  get frames(): number {
    return this.total;
  }

  finish(minDetected = gameConfig.detection.calibrationMinDetected): Baseline | null {
    if (this.total === 0 || this.detected / this.total < minDetected) return null;
    const n = this.detected;
    return {
      smile: this.sum.smile / n,
      jawOpen: this.sum.jawOpen / n,
      noseX: this.sum.noseX / n,
      noseY: this.sum.noseY / n,
      faceWidth: this.sum.faceWidth / n,
    };
  }
}
