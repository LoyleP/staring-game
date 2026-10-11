import { loadSounds, playSound } from '../audio/soundboard';
import { closeAudio, resumeAudio, unlockAudio } from '../audio/unlock';
import { gameConfig } from './gameConfig';
import { ApiError, clearSession, enterRoom, fetchIceServers, leaveRoom, savedSession } from '../net/api';
import { PeerSession } from '../net/peer';
import { PROTOCOL_VERSION, type GameMessage, type SignalMessage } from '../net/protocol';
import { Signaling } from '../net/signaling';
import { CameraError, requestCamera, stopStream } from '../vision/camera';
import { VisionPipeline } from '../vision/pipeline';
import { Duel } from './duel';
import { clockOffsetSample, medianOffset } from './matchLogic';
import { useRoomStore } from './roomStore';

const PING_MS = 2000;

/** Salon à deux joueurs : jonction, caméra, connexion WebRTC et état "prêt". */
export class RoomSession {
  private token = '';
  private signaling: Signaling | null = null;
  private peer: PeerSession | null = null;
  private stream: MediaStream | null = null;
  private iceServers: Awaited<ReturnType<typeof fetchIceServers>> | null = null;
  private buffered: SignalMessage[] = [];
  private consent = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingId = 0;
  private disposed = false;
  private pipeline: VisionPipeline | null = null;
  private duel: Duel | null = null;
  /** Décalage d'horloge hôte − local (0 pour l'hôte). */
  private offset = 0;
  private offsetSamples: number[] = [];

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
      this.signaling = new Signaling(this.code, this.token, {
        onMessage: (m) => this.onSignal(m),
        onStatus: (s) => useRoomStore.getState().set({ signalingDegraded: s === 'degraded' }),
        onTransport: (t) => useRoomStore.getState().set({ signalingTransport: t }),
      });
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
      await unlockAudio(gameConfig.net.callAudio);
      void loadSounds();
      this.stream = await requestCamera(gameConfig.net.callAudio);
      this.localVideo.srcObject = this.stream;
      await this.localVideo.play().catch(() => undefined);
      const role = useRoomStore.getState().role ?? 'guest';
      this.duel = new Duel({
        side: role,
        send: (m) => this.peer?.sendGame(m) ?? false,
        sendCritical: (m) => this.sendCritical(m),
        toLocal: (t) => t - this.offset,
        toHost: (t) => t + this.offset,
        now: () => performance.now(),
        play: (id, delayMs) => playSound(id, delayMs),
      });
      this.duel.startWatchdog(() => {
        const st = useRoomStore.getState();
        return st.peerPresent && st.connection === 'connected';
      });
      useRoomStore.getState().set({ screen: 'calibrating', calibProgress: 0, calibMessage: null });
      void this.ensurePeer();
      this.pipeline = new VisionPipeline(this.localVideo);
      await this.pipeline.start();
      this.pipeline.calibrate({
        progress: (p, m) => useRoomStore.getState().set({ calibProgress: p, calibMessage: m }),
        done: () => useRoomStore.getState().set({ screen: 'lobby' }),
      });
    } catch (e) {
      this.pipeline?.stop();
      this.pipeline = null;
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
    void resumeAudio(); // tap : reprend le son suspendu par la permission caméra
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
    this.duel?.dispose();
    this.pipeline?.stop();
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
          this.remoteVideo.muted = !gameConfig.net.callAudio;
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
      // En partie, le chronomètre de forfait du duel prend le relais ; sinon on reste dans le salon.
      store.set({ peerPresent: false, meReady: false });
    } else if (m.type === 'relay') {
      this.onGame(m.message);
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
    // L'invité synchronise son horloge sur celle de l'hôte : 5 échanges rapprochés, puis la médiane.
    if (useRoomStore.getState().role === 'guest') {
      for (let i = 0; i < 5; i++) setTimeout(() => this.sendPing(), i * 150);
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, PING_MS);
  }

  private sendPing(): void {
    this.peer?.sendGame({ type: 'ping', id: ++this.pingId, t: performance.now() });
  }

  /** Message critique : DataChannel, sinon relais par la signalisation (WebSocket ou polling). */
  private sendCritical(m: GameMessage): void {
    if (!this.peer?.sendGame(m)) this.signaling?.send({ type: 'relay', message: m });
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
      case 'pong': {
        const received = performance.now();
        store.set({ rtt: Math.round(received - m.t) });
        if (store.role === 'guest') {
          this.offsetSamples = [...this.offsetSamples.slice(-8), clockOffsetSample(m.t, m.tRemote, received)];
          this.offset = medianOffset(this.offsetSamples);
        }
        break;
      }
      default:
        this.duel?.onMessage(m);
    }
  }

  private checkStart(): void {
    const s = useRoomStore.getState();
    if (!(s.meReady && s.peerReady && s.screen === 'lobby')) return;
    s.set({ screen: 'call' });
    const duel = this.duel;
    this.pipeline?.watch((out, frame) => duel?.onFrame(out, frame));
    if (s.role === 'host') duel?.startMatch();
  }

  fireSound(index: number): void {
    this.duel?.fireSound(index);
  }

  requestRematch(): void {
    this.duel?.requestRematch();
  }
}
