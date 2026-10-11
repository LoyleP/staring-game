let ctx: AudioContext | null = null;

/** À appeler dans un geste utilisateur : crée l'AudioContext, le reprend, joue un silence de 50 ms. */
/**
 * `withMic` : "playback" est incompatible avec la capture micro sur iOS (InvalidStateError),
 * il faut "play-and-record" dès qu'on demande le micro.
 */
export async function unlockAudio(withMic = false): Promise<AudioContext> {
  ctx ??= new AudioContext();
  // iOS : le son Web Audio est coupé par le bouton silencieux, sauf en mode "playback".
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = withMic ? 'play-and-record' : 'playback';
    } catch {
      // type non supporté : on garde le comportement par défaut
    }
  }
  if (ctx.state !== 'running') await ctx.resume();
  const silent = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = silent;
  src.connect(ctx.destination);
  src.start();
  return ctx;
}

/** iOS suspend ou "interrompt" le contexte (permission caméra, appel, verrouillage) : à rappeler dans un tap. */
export async function resumeAudio(): Promise<void> {
  if (ctx && ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // refusé hors geste utilisateur : sera retenté au prochain tap
    }
  }
}

export function audioContext(): AudioContext | null {
  return ctx;
}

export function closeAudio(): void {
  void ctx?.close();
  ctx = null;
}
