import { SOUNDS } from './sounds';
import { audioContext, resumeAudio } from './unlock';

const buffers = new Map<string, AudioBuffer>();
let lastError: string | null = null;

/** Décode avec la forme à callbacks en repli : les vieux Safari n'ont pas la version promesse. */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    p?.then(resolve, reject);
  });
}

async function loadOne(id: string, url: string): Promise<void> {
  const ctx = audioContext();
  if (!ctx || buffers.has(id)) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    buffers.set(id, await decode(ctx, await res.arrayBuffer()));
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
}

/** Charge et décode tous les sons (à lancer pendant la calibration ou le salon d'attente). */
export async function loadSounds(): Promise<void> {
  await Promise.all(SOUNDS.map((s) => loadOne(s.id, s.url)));
}

/** État pour l'overlay de debug. */
export function audioStatus(): { state: string; loaded: number; total: number; error: string | null } {
  return { state: audioContext()?.state ?? 'none', loaded: buffers.size, total: SOUNDS.length, error: lastError };
}

/** Programme la lecture `delayMs` plus tard (instant converti par le réseau). Reprend le contexte s'il est suspendu. */
export function playSound(id: string, delayMs = 0): void {
  const ctx = audioContext();
  if (!ctx) return;
  const start = (buffer: AudioBuffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(ctx.currentTime + delayMs / 1000);
  };
  const run = () => {
    const buffer = buffers.get(id);
    if (buffer) return start(buffer);
    // Pas encore chargé (ou échec) : on retente une fois puis on joue.
    const sound = SOUNDS.find((s) => s.id === id);
    if (sound) void loadOne(id, sound.url).then(() => buffers.has(id) && start(buffers.get(id) as AudioBuffer));
  };
  if (ctx.state === 'running') run();
  else void resumeAudio().then(run);
}
