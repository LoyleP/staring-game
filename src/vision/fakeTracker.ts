import { e2eWindow } from '../testing/e2e';
import type { FaceTracker } from './faceTracker';
import type { FaceFrame } from './types';

const W = 480;
const H = 640;

/** Suivi facial simulé pour les tests : émet 15 images/s à partir de `window.__auraFace`. */
export function startFakeTracker(onFrame: (f: FaceFrame) => void): FaceTracker {
  const w = e2eWindow();
  w.__auraFace ??= { face: true, smile: 0.05, jaw: 0.05, noseDx: 0 };
  const faceWidth = W * 0.5;
  const timer = setInterval(() => {
    const s = w.__auraFace ?? { face: true, smile: 0, jaw: 0, noseDx: 0 };
    onFrame({
      t: performance.now(),
      face: s.face,
      smileL: s.smile,
      smileR: s.smile,
      jawOpen: s.jaw,
      noseX: W / 2 + s.noseDx * faceWidth,
      noseY: H / 2,
      faceWidth,
      imageWidth: W,
    });
  }, 1000 / 15);
  return { mode: 'e2e', delegate: 'none', fps: () => 15, stop: () => clearInterval(timer) };
}
