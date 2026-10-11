import { Calibrator } from '../vision/calibration';
import { CameraError, requestCamera, stopStream } from '../vision/camera';
import { FaceEventDetector } from '../vision/detector';
import { startFaceTracker, type FaceTracker } from '../vision/faceTracker';
import type { Baseline, FaceFrame } from '../vision/types';
import { FakeOpponent } from './fakeOpponent';
import { gameConfig } from './gameConfig';
import { SoloRound } from './machine';
import { roundPhase } from './scoring';
import { useSoloStore } from './store';

const FLOATER_MS = 1200;

/** Mode bac à sable : caméra, calibration puis une manche contre le chronomètre. */
export class SoloSession {
  private stream: MediaStream | null = null;
  private tracker: FaceTracker | null = null;
  private baseline: Baseline | null = null;
  private calibrator: Calibrator | null = null;
  private calibStart: number | null = null;
  private detector: FaceEventDetector | null = null;
  private round: SoloRound | null = null;
  private roundStart = 0;
  private bot: FakeOpponent | null = null;
  private floaterId = 0;
  private recent: string[] = [];
  private mode: 'idle' | 'calibrating' | 'running' = 'idle';

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly debugEnabled: boolean,
  ) {}

  /** À appeler depuis un tap : demande la caméra puis charge le détecteur. */
  async activate(): Promise<void> {
    const store = useSoloStore.getState();
    store.set({ screen: 'loading', message: null });
    try {
      this.stream = await requestCamera();
      this.video.srcObject = this.stream;
      await this.video.play();
      this.tracker = await startFaceTracker(this.video, (f) => this.onFrame(f));
      this.startCalibration();
    } catch (e) {
      this.release();
      if (e instanceof CameraError && e.kind === 'denied') {
        store.set({ screen: 'denied' });
      } else {
        store.set({ screen: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  startCalibration(): void {
    this.calibrator = new Calibrator();
    this.calibStart = null;
    this.mode = 'calibrating';
    useSoloStore.getState().set({ screen: 'calibrating', calibProgress: 0, message: null });
  }

  startRound(): void {
    if (!this.baseline) return;
    this.detector = new FaceEventDetector(this.baseline);
    this.round = null; // l'horloge démarre à la première image analysée
    this.bot = new FakeOpponent();
    this.mode = 'running';
    useSoloStore.getState().set({ screen: 'running', snap: null, floaters: [] });
  }

  dispose(): void {
    this.release();
    useSoloStore.getState().reset();
  }

  private release(): void {
    this.mode = 'idle';
    this.tracker?.stop();
    this.tracker = null;
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
  }

  private onFrame(frame: FaceFrame): void {
    if (this.mode === 'calibrating') this.calibrate(frame);
    else if (this.mode === 'running') this.play(frame);
  }

  private calibrate(frame: FaceFrame): void {
    this.calibStart ??= frame.t;
    this.calibrator?.add(frame);
    const progress = Math.min(1, (frame.t - this.calibStart) / gameConfig.detection.calibrationMs);
    const store = useSoloStore.getState();
    if (progress < 1) {
      store.set({ calibProgress: progress });
      return;
    }
    this.baseline = this.calibrator?.finish() ?? null;
    if (this.baseline) {
      this.mode = 'idle';
      store.set({ screen: 'ready', calibProgress: 1 });
    } else {
      this.startCalibration();
      useSoloStore.getState().set({ message: 'Visage non détecté. On recommence : place-toi dans l’ovale.' });
    }
  }

  private play(frame: FaceFrame): void {
    if (!this.detector) return;
    if (!this.round) {
      this.roundStart = frame.t;
      this.round = new SoloRound(frame.t, this.bot !== null);
    }
    const out = this.detector.update(frame);
    const bot = this.bot?.step(frame.t, roundPhase(frame.t - this.roundStart));
    const snap = this.round.step(frame.t, out, bot?.out);
    const store = useSoloStore.getState();

    for (const e of out.events) this.recent = [`${(snap.elapsedMs / 1000).toFixed(1)}s ${e.type}`, ...this.recent].slice(0, 6);
    const now = performance.now();
    const floaters = store.floaters.filter((f) => now - f.id < FLOATER_MS);
    const add = (side: 'me' | 'opp', delta: number) =>
      floaters.push({ id: now + this.floaterId++ / 1000, side, delta });
    snap.deltas.forEach((d) => add('me', d));
    snap.oppDeltas.forEach((d) => add('opp', d));

    store.set({
      snap,
      floaters,
      oppExpression: bot?.expression ?? 'neutral',
      debug: this.debugEnabled
        ? {
            ...this.detector.debug,
            fps: this.tracker?.fps() ?? 0,
            mode: this.tracker?.mode ?? '-',
            delegate: this.tracker?.delegate ?? '-',
            recent: this.recent,
          }
        : null,
    });
    if (snap.ended) {
      this.mode = 'idle';
      store.set({ screen: 'ended' });
    }
  }
}
