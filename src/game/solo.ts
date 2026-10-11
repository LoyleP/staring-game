import { canFire, createBoard, fire, reloadProgress, type BoardState } from '../audio/board';
import { RandomSoundScheduler } from '../audio/randomSounds';
import { loadSounds, playSound } from '../audio/soundboard';
import { SOUNDS } from '../audio/sounds';
import { closeAudio, unlockAudio } from '../audio/unlock';
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
  private board: BoardState | null = null;
  private randomSounds = new RandomSoundScheduler();
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
      // Dans le geste du tap : débloque l'audio avant tout await long.
      await unlockAudio();
      this.stream = await requestCamera();
      this.video.srcObject = this.stream;
      await this.video.play();
      this.tracker = await startFaceTracker(this.video, (f) => this.onFrame(f));
      void loadSounds();
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
    this.board = createBoard(SOUNDS.map((x) => x.id));
    this.randomSounds.reset();
    this.mode = 'running';
    useSoloStore.getState().set({ screen: 'running', snap: null, floaters: [], hand: this.hand(), reload: 1 });
  }

  /** Tap sur un bouton de la soundboard. */
  fireSound(index: number): void {
    const store = useSoloStore.getState();
    const board = this.board;
    if (!board || !this.round || this.mode !== 'running' || store.snap?.phase !== 'play') return;
    const now = performance.now();
    if (canFire(board, index, now) !== 'ok') return;
    const id = board.hand[index] as string;
    this.board = fire(board, index, now);
    playSound(id);
    const delta = this.round.spendAura('me', gameConfig.soundboard.auraCost, now);
    if (delta !== 0) store.set({ floaters: [...store.floaters, { id: now, side: 'me', delta }] });
    this.bot?.provoke(now);
    store.set({ hand: this.hand(), reload: 0 });
  }

  private hand() {
    const board = this.board;
    if (!board) return [];
    return board.hand.map((id, i) => ({
      sound: SOUNDS.find((x) => x.id === id) ?? { id, label: id, url: '' },
      used: board.used[i] ?? false,
    }));
  }

  dispose(): void {
    this.release();
    closeAudio();
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
    const store0 = useSoloStore.getState();
    const ratio = frame.imageWidth ? frame.faceWidth / frame.imageWidth : 1;
    if (frame.face && ratio < gameConfig.detection.minFaceWidthRatio) {
      // Trop loin : on ne compte pas la calibration tant que le visage ne remplit pas l'ovale.
      this.calibrator = new Calibrator();
      this.calibStart = null;
      store0.set({ calibProgress: 0, message: 'Rapproche-toi de la caméra' });
      return;
    }
    if (store0.message === 'Rapproche-toi de la caméra') store0.set({ message: null });
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
    if (bot?.sound) {
      const pick = SOUNDS[Math.floor(Math.random() * SOUNDS.length)];
      if (pick) playSound(pick.id);
      const cost = this.round.spendAura('opp', gameConfig.soundboard.auraCost, frame.t);
      if (cost !== 0) useSoloStore.getState().set({ floaters: [...useSoloStore.getState().floaters, { id: performance.now() + 0.5, side: 'opp', delta: cost }] });
    }
    const snap = this.round.step(frame.t, out, bot?.out);
    if (snap.phase === 'play' && this.randomSounds.due(frame.t)) {
      const id = this.randomSounds.pick(SOUNDS.map((x) => x.id));
      if (id) playSound(id);
    }
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
      reload: this.board ? reloadProgress(this.board, performance.now()) : 1,
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
