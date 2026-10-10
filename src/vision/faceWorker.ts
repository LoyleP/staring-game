/// <reference lib="webworker" />
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { frameFromResult } from './detector';
import { createLandmarker } from './landmarker';

export type WorkerIn =
  | { type: 'init'; origin: string }
  | { type: 'frame'; bitmap: ImageBitmap; t: number };

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'frame'; frame: ReturnType<typeof frameFromResult> };

let landmarker: FaceLandmarker | null = null;
const post = (m: WorkerOut) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      // Le worker n'essaie que le GPU : en cas d'échec, le thread principal prend le relais.
      landmarker = await createLandmarker(msg.origin, 'GPU');
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: String(err) });
    }
    return;
  }
  if (!landmarker) return;
  const { bitmap, t } = msg;
  try {
    const result = landmarker.detectForVideo(bitmap, t);
    post({ type: 'frame', frame: frameFromResult(result, bitmap.width, bitmap.height, t) });
  } catch (err) {
    post({ type: 'error', message: String(err) });
  } finally {
    bitmap.close();
  }
};
