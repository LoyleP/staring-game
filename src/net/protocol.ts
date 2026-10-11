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

export type GameMessage =
  | { type: 'hello'; version: number; consentCapture: boolean }
  | { type: 'ping'; id: number; t: number }
  | { type: 'pong'; id: number; t: number; tRemote: number }
  | { type: 'ready'; ready: boolean };

export const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
