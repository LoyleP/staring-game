import { closeAudio, unlockAudio } from '../audio/unlock';
import { ApiError, clearSession, enterRoom, fetchIceServers, leaveRoom, savedSession } from '../net/api';
import { PeerSession } from '../net/peer';
import { PROTOCOL_VERSION, type GameMessage, type SignalMessage } from '../net/protocol';
import { PollSignaling } from '../net/signaling';
import { CameraError, requestCamera, stopStream } from '../vision/camera';
import { useRoomStore } from './roomStore';

const PING_MS = 2000;

/** Salon à deux joueurs : jonction, caméra, connexion WebRTC et état "prêt". */
export class RoomSession {
  private token = '';
  private signaling: PollSignaling | null = null;
  private peer: PeerSession | null = null;
  private stream: MediaStream | null = null;
  private iceServers: Awaited<ReturnType<typeof fetchIceServers>> | null = null;
  private buffered: SignalMessage[] = [];
  private consent = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingId = 0;
  private disposed = false;

  constructor(
    private readonly code: string,
    private readonly localVideo: HTMLVideoElement,
    private readonly remoteVideo: HTMLVideoElement,
  ) {}

  async init(): Promise<void> {
    const store = useRoomStore.getState();
    store.set({ code: this.code, screen: 'joining', error: null });
    try {
      const room = await enterRoom(this.code);
      if (this.disposed) return;
      this.token = room.token;
      useRoomStore.getState().set({ role: room.role, peerPresent: room.peerPresent, screen: 'prepare' });
      this.signaling = new PollSignaling(
        this.code,
        this.token,
        (m) => this.onSignal(m),
        (s) => useRoomStore.getState().set({ signalingDegraded: s === 'degraded' }),
      );
      this.signaling.start();
      void fetchIceServers().then((s) => (this.iceServers = s));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      const message =
        status === 404 ? 'Ce duel n’existe pas ou a expiré.' : status === 409 ? 'Ce duel est déjà complet.' : 'Impossible de rejoindre le duel.';
      useRoomStore.getState().set({ screen: 'error', error: message });
    }
  }

  /** À appeler depuis un tap : débloque l'audio puis demande caméra et micro. */
  async activate(consentCapture: boolean): Promise<void> {
    this.consent = consentCapture;
    const store = useRoomStore.getState();
    store.set({ screen: 'loading' });
    try {
      await unlockAudio(true);
      this.stream = await requestCamera(true);
      this.localVideo.srcObject = this.stream;
      await this.localVideo.play().catch(() => undefined);
      useRoomStore.getState().set({ screen: 'lobby' });
      await this.ensurePeer();
    } catch (e) {
      stopStream(this.stream);
      this.stream = null;
      useRoomStore.getState().set(
        e instanceof CameraError && e.kind === 'denied'
          ? { screen: 'denied' }
          : { screen: 'error', error: e instanceof Error ? e.message : String(e) },
      );
    }
  }

  setReady(ready: boolean): void {
    useRoomStore.getState().set({ meReady: ready });
    this.peer?.sendGame({ type: 'ready', ready });
    this.checkStart();
  }

  /** Quitter : coupe tout et prévient l'autre joueur. */
  leave(): void {
    leaveRoom(this.code, this.token);
    clearSession(this.code);
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.signaling?.stop();
    this.closePeer();
    stopStream(this.stream);
    this.stream = null;
    this.localVideo.srcObject = null;
    this.remoteVideo.srcObject = null;
    closeAudio();
    useRoomStore.getState().reset();
  }

  private async ensurePeer(): Promise<void> {
    const { peerPresent } = useRoomStore.getState();
    if (this.peer || !this.stream || !peerPresent || this.disposed) return;
    this.iceServers ??= await fetchIceServers();
    if (this.peer || this.disposed) return;
    const role = savedSession(this.code)?.role ?? useRoomStore.getState().role;
    this.peer = new PeerSession({
      iceServers: this.iceServers,
      polite: role === 'guest',
      localStream: this.stream,
      send: (m) => this.signaling?.send(m),
      events: {
        onRemoteStream: (s) => {
          this.remoteVideo.srcObject = s;
          void this.remoteVideo.play().catch(() => undefined);
          useRoomStore.getState().set({ remoteVideo: true });
        },
        onConnection: (connection) => useRoomStore.getState().set({ connection }),
        onGameMessage: (m) => this.onGame(m),
        onChannelOpen: () => this.onChannelOpen(),
      },
    });
    useRoomStore.getState().set({ connection: 'connecting' });
    // Rejoue les messages reçus avant la création de la connexion.
    for (const m of this.buffered.splice(0)) this.peer.handle(m);
  }

  private closePeer(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.peer?.close();
    this.peer = null;
    this.remoteVideo.srcObject = null;
    useRoomStore.getState().set({
      connection: 'idle',
      remoteVideo: false,
      peerReady: false,
      peerConsent: false,
      rtt: null,
    });
  }

  private onSignal(m: SignalMessage): void {
    const store = useRoomStore.getState();
    if (m.type === 'peer-joined') {
      // Un nouvel arrivant (ou un rechargement) : on repart d'une connexion propre.
      this.buffered = [];
      if (this.peer) this.closePeer();
      store.set({ peerPresent: true, meReady: false });
      void this.ensurePeer();
    } else if (m.type === 'peer-left') {
      this.buffered = [];
      this.closePeer();
      store.set({ peerPresent: false, meReady: false, screen: store.screen === 'call' ? 'lobby' : store.screen });
    } else if (this.peer) {
      this.peer.handle(m);
    } else {
      this.buffered.push(m);
    }
  }

  private onChannelOpen(): void {
    const peer = this.peer;
    if (!peer) return;
    peer.sendGame({ type: 'hello', version: PROTOCOL_VERSION, consentCapture: this.consent });
    if (useRoomStore.getState().meReady) peer.sendGame({ type: 'ready', ready: true });
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.peer?.sendGame({ type: 'ping', id: ++this.pingId, t: performance.now() });
    }, PING_MS);
  }

  private onGame(m: GameMessage): void {
    const store = useRoomStore.getState();
    switch (m.type) {
      case 'hello':
        store.set({ peerConsent: m.consentCapture });
        break;
      case 'ready':
        store.set({ peerReady: m.ready });
        this.checkStart();
        break;
      case 'ping':
        this.peer?.sendGame({ type: 'pong', id: m.id, t: m.t, tRemote: performance.now() });
        break;
      case 'pong':
        store.set({ rtt: Math.round(performance.now() - m.t) });
        break;
    }
  }

  private checkStart(): void {
    const s = useRoomStore.getState();
    if (s.meReady && s.peerReady && s.screen === 'lobby') s.set({ screen: 'call' });
  }
}
