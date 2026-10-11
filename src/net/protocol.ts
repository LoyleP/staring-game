/** Types partagés entre le client et api/ (signalisation et DataChannel). */

export type Role = 'host' | 'guest';
export type RoomStatus = 'waiting' | 'playing' | 'finished';

/** Messages relayés par le serveur de signalisation. */
export type SignalMessage =
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit | null }
  /** Message de jeu critique relayé par la signalisation quand le DataChannel est indisponible. */
  | { type: 'relay'; message: GameMessage };

export interface RoomJoinResponse {
  code: string;
  role: Role;
  token: string;
  /** true si l'autre joueur est déjà dans le salon. */
  peerPresent: boolean;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Messages du DataChannel `game`. */
export const PROTOCOL_VERSION = 1;

export type MatchSide = 'host' | 'guest';
export type RoundEndReason = 'crack' | 'zero' | 'time' | 'forfeit';

export interface MatchResult {
  winner: MatchSide | 'draw';
  reason: RoundEndReason;
  hostAura: number;
  guestAura: number;
}

export type GameMessage =
  | { type: 'hello'; version: number; consentCapture: boolean }
  /** `t` : horloge de l'émetteur. Le pong ajoute `tRemote` (horloge du répondeur) pour calculer le décalage. */
  | { type: 'ping'; id: number; t: number }
  | { type: 'pong'; id: number; t: number; tRemote: number }
  | { type: 'ready'; ready: boolean }
  /** Hôte → invité : début de la manche, `startAt` dans l'horloge de l'hôte. */
  | { type: 'roundStart'; round: number; startAt: number }
  /** Pénalité ponctuelle sur le visage de l'émetteur. */
  | { type: 'penalty'; kind: string; amount: number; t: number }
  /** Aura courante de l'émetteur, toutes les 500 ms : corrige la dérive. */
  | { type: 'aura'; aura: number; t: number }
  | { type: 'sound'; id: string; playAt: number }
  /** Le joueur craque (rire) ou tombe à 0 : fin de manche immédiate. */
  | { type: 'crack'; reason: 'crack' | 'zero'; t: number }
  /** Hôte → invité : mort subite (égalité à moins de la marge), `endAt` dans l'horloge de l'hôte. */
  | { type: 'suddenDeath'; endAt: number }
  | { type: 'roundEnd'; round: number; result: MatchResult; wins: Record<MatchSide, number> }
  | {
      type: 'matchEnd';
      winner: MatchSide;
      forfeit: boolean;
      wins: Record<MatchSide, number>;
      rounds: MatchResult[];
    }
  | { type: 'rematch' };

export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
