import { SOUNDS } from './sounds';
import { audioContext } from './unlock';

const buffers = new Map<string, AudioBuffer>();

/** Charge et décode tous les sons (à lancer pendant la calibration ou le salon d'attente). */
export async function loadSounds(): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return;
  await Promise.all(
    SOUNDS.filter((s) => !buffers.has(s.id)).map(async (s) => {
      try {
        const res = await fetch(s.url);
        if (!res.ok) return;
        buffers.set(s.id, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // son indisponible : le bouton reste utilisable, sans effet sonore
      }
    }),
  );
}

/** Programme la lecture `delayMs` plus tard (instant converti par le réseau en phase 2). */
export function playSound(id: string, delayMs = 0): void {
  const ctx = audioContext();
  const buffer = buffers.get(id);
  if (!ctx || !buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(ctx.currentTime + delayMs / 1000);
}
