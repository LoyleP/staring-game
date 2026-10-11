import { create } from 'zustand';
import type { ConnectionState } from '../net/peer';
import type { Role } from '../net/protocol';
import type { SignalingTransport } from '../net/signaling';

export type RoomScreen = 'joining' | 'error' | 'prepare' | 'loading' | 'denied' | 'calibrating' | 'lobby' | 'call';

interface RoomStore {
  screen: RoomScreen;
  error: string | null;
  code: string;
  role: Role | null;
  peerPresent: boolean;
  connection: ConnectionState | 'idle';
  calibProgress: number;
  calibMessage: string | null;
  signalingDegraded: boolean;
  signalingTransport: SignalingTransport | null;
  remoteVideo: boolean;
  meReady: boolean;
  peerReady: boolean;
  peerConsent: boolean;
  /** Aller-retour DataChannel en ms. */
  rtt: number | null;
  set: (patch: Partial<Omit<RoomStore, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const initial = {
  screen: 'joining' as RoomScreen,
  error: null,
  code: '',
  role: null,
  peerPresent: false,
  connection: 'idle' as const,
  calibProgress: 0,
  calibMessage: null,
  signalingDegraded: false,
  signalingTransport: null,
  remoteVideo: false,
  meReady: false,
  peerReady: false,
  peerConsent: false,
  rtt: null,
};

export const useRoomStore = create<RoomStore>()((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set(initial),
}));
