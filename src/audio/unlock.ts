let ctx: AudioContext | null = null;

/** À appeler dans un geste utilisateur : crée l'AudioContext, le reprend, joue un silence de 50 ms. */
export async function unlockAudio(): Promise<AudioContext> {
  ctx ??= new AudioContext();
  // iOS : le son Web Audio est coupé par le bouton silencieux, sauf en mode "playback".
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  if (ctx.state !== 'running') await ctx.resume();
  const silent = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = silent;
  src.connect(ctx.destination);
  src.start();
  return ctx;
}

export function audioContext(): AudioContext | null {
  return ctx;
}

export function closeAudio(): void {
  void ctx?.close();
  ctx = null;
}
