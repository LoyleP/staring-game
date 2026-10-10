import { gameConfig } from '../game/gameConfig';
import { frameFromResult } from './detector';
import type { WorkerIn, WorkerOut } from './faceWorker';
import type { FaceFrame } from './types';

export interface FaceTracker {
  mode: 'worker' | 'main';
  delegate: string;
  /** Analyses par seconde mesurées sur la dernière seconde. */
  fps: () => number;
  stop: () => void;
}

/** Lance l'analyse du flux : worker GPU si possible, sinon thread principal (GPU puis CPU). */
export async function startFaceTracker(
  video: HTMLVideoElement,
  onFrame: (frame: FaceFrame) => void,
  options: { forceMain?: boolean } = {},
): Promise<FaceTracker> {
  const origin = location.origin;
  const worker = options.forceMain ? null : await tryWorker(origin);
  const stamps: number[] = [];
  const emit = (f: FaceFrame) => {
    const now = performance.now();
    stamps.push(now);
    while (stamps.length && now - (stamps[0] ?? now) > 1000) stamps.shift();
    onFrame(f);
  };
  const fps = () => stamps.length;

  if (worker) {
    let busy = false;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      busy = false;
      if (e.data.type === 'frame') emit(e.data.frame);
    };
    const timer = setInterval(async () => {
      if (busy || video.readyState < 2 || video.videoWidth === 0) return;
      busy = true;
      try {
        const bitmap = await createImageBitmap(video);
        worker.postMessage({ type: 'frame', bitmap, t: performance.now() } satisfies WorkerIn, [bitmap]);
      } catch {
        busy = false;
      }
    }, 1000 / gameConfig.detection.inferenceFps);
    return {
      mode: 'worker',
      delegate: 'GPU',
      fps,
      stop: () => {
        clearInterval(timer);
        worker.terminate();
      },
    };
  }

  let delegate: 'GPU' | 'CPU' = 'GPU';
  const { createLandmarker } = await import('./landmarker');
  let landmarker;
  try {
    landmarker = await createLandmarker(origin, 'GPU');
  } catch {
    delegate = 'CPU';
    landmarker = await createLandmarker(origin, 'CPU');
  }
  let lastVideoTime = -1;
  const timer = setInterval(() => {
    if (video.readyState < 2 || video.videoWidth === 0 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const t = performance.now();
    const result = landmarker.detectForVideo(video, t);
    emit(frameFromResult(result, video.videoWidth, video.videoHeight, t));
  }, 1000 / gameConfig.detection.inferenceFpsMainThread);
  return {
    mode: 'main',
    delegate,
    fps,
    stop: () => {
      clearInterval(timer);
      landmarker.close();
    },
  };
}

function tryWorker(origin: string): Promise<Worker | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./faceWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const fail = () => {
      worker.terminate();
      resolve(null);
    };
    worker.onerror = fail;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => (e.data.type === 'ready' ? resolve(worker) : fail());
    worker.postMessage({ type: 'init', origin } satisfies WorkerIn);
  });
}
