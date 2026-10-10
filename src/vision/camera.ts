import { gameConfig } from '../game/gameConfig';

export type CameraErrorKind = 'denied' | 'notfound' | 'other';

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** Caméra frontale portrait. À appeler depuis un geste utilisateur. */
export async function requestCamera(audio = false): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('other', 'Caméra indisponible (HTTPS requis ou navigateur non supporté).');
  }
  const { width, height, fps } = gameConfig.media;
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } },
      audio: audio && { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied', name);
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('notfound', name);
    throw new CameraError('other', String(e));
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Consigne de réactivation selon le navigateur. */
export function permissionHelp(ua = navigator.userAgent): string {
  if (/iPhone|iPad/.test(ua)) {
    return 'Sur iPhone : Réglages › Safari › Caméra, choisis « Autoriser », puis recharge la page.';
  }
  if (/Android/.test(ua)) {
    return 'Sur Android : touche le cadenas à gauche de l’adresse › Autorisations › Caméra › Autoriser, puis recharge la page.';
  }
  return 'Clique sur l’icône de cadenas dans la barre d’adresse, autorise la caméra, puis réessaie.';
}
