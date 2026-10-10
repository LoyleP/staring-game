/** Une mesure du visage à l'instant `t` (ms), indépendante de MediaPipe. */
export interface FaceFrame {
  t: number;
  face: boolean;
  smileL: number;
  smileR: number;
  jawOpen: number;
  /** Position du nez en pixels de l'image analysée. */
  noseX: number;
  noseY: number;
  /** Largeur du visage en pixels (distance entre les points 234 et 454). */
  faceWidth: number;
}

/** Référence neutre mesurée pendant la calibration. */
export interface Baseline {
  smile: number;
  jawOpen: number;
  noseX: number;
  noseY: number;
  faceWidth: number;
}

export type FaceEventType = 'smileLight' | 'smileFull' | 'laugh' | 'faceLost';

export interface FaceEvent {
  type: FaceEventType;
  t: number;
  /** smileFull déclenché alors qu'un sourire léger déjà pénalisé se poursuit. */
  upgrade?: boolean;
}

/** États continus : la pénalité par seconde est appliquée par scoring.ts. */
export interface FaceFlags {
  smiling: boolean;
  headMoving: boolean;
  faceLost: boolean;
}

export interface DetectorOutput {
  events: FaceEvent[];
  flags: FaceFlags;
}
