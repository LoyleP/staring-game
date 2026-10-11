import { gameConfig } from '../game/gameConfig';
import type { GameMessage, IceServerConfig, SignalMessage } from './protocol';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface PeerEvents {
  onRemoteStream: (stream: MediaStream) => void;
  onConnection: (state: ConnectionState) => void;
  onGameMessage: (message: GameMessage) => void;
  onChannelOpen: () => void;
}

interface Options {
  iceServers: IceServerConfig[];
  /** L'invité est "polite" : il cède en cas d'offres croisées. */
  polite: boolean;
  localStream: MediaStream;
  send: (message: SignalMessage) => void;
  events: PeerEvents;
}

/** RTCPeerConnection avec "perfect negotiation", DataChannel `game` et redémarrage ICE. */
export class PeerSession {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly o: Options) {
    this.pc = new RTCPeerConnection({ iceServers: o.iceServers });
    const { pc } = this;

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        const d = pc.localDescription;
        if (d && (d.type === 'offer' || d.type === 'answer')) o.send({ type: d.type, sdp: d.sdp });
      } catch (e) {
        console.warn('négociation', e);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) o.send({ type: 'ice-candidate', candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      o.events.onRemoteStream(stream);
    };
    pc.oniceconnectionstatechange = () => this.onIceState();
    pc.ondatachannel = ({ channel }) => this.attach(channel);

    // L'hôte crée le DataChannel avant les pistes pour qu'il soit dans la première offre.
    if (!o.polite) this.attach(pc.createDataChannel('game', { ordered: true }));
    for (const track of o.localStream.getTracks()) pc.addTrack(track, o.localStream);
  }

  /** Traite un message de signalisation, en série pour éviter les courses. */
  handle(message: SignalMessage): void {
    this.chain = this.chain.then(() => this.process(message)).catch((e) => console.warn('signal', e));
  }

  private async process(m: SignalMessage): Promise<void> {
    const { pc } = this;
    if (this.closed) return;
    if (m.type === 'offer' || m.type === 'answer') {
      const collision = m.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.o.polite && collision;
      if (this.ignoreOffer) return;
      await pc.setRemoteDescription({ type: m.type, sdp: m.sdp });
      if (m.type === 'offer') {
        await pc.setLocalDescription();
        const d = pc.localDescription;
        if (d && d.type === 'answer') this.o.send({ type: 'answer', sdp: d.sdp });
      }
    } else if (m.type === 'ice-candidate' && m.candidate) {
      try {
        await pc.addIceCandidate(m.candidate);
      } catch (e) {
        if (!this.ignoreOffer) throw e;
      }
    }
  }

  sendGame(message: GameMessage): boolean {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify(message));
    return true;
  }

  get channelOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  close(): void {
    this.closed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.channel?.close();
    this.pc.close();
  }

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => this.o.events.onChannelOpen();
    channel.onmessage = (e) => {
      try {
        this.o.events.onGameMessage(JSON.parse(String(e.data)) as GameMessage);
      } catch {
        // message illisible ignoré
      }
    };
  }

  private onIceState(): void {
    const state = this.pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.o.events.onConnection('connected');
      void this.capBitrate();
    } else if (state === 'disconnected') {
      this.o.events.onConnection('reconnecting');
      this.restartTimer ??= setTimeout(() => {
        this.restartTimer = null;
        if (this.pc.iceConnectionState !== 'connected') this.pc.restartIce();
      }, gameConfig.net.iceRestartDelayMs);
    } else if (state === 'failed') {
      this.o.events.onConnection('reconnecting');
      this.pc.restartIce();
    } else {
      this.o.events.onConnection('connecting');
    }
  }

  private async capBitrate(): Promise<void> {
    try {
      const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (!sender) return;
      const params = sender.getParameters();
      params.encodings ??= [{}];
      if (params.encodings[0]) params.encodings[0].maxBitrate = gameConfig.media.maxBitrateKbps * 1000;
      await sender.setParameters(params);
    } catch {
      // non supporté : le débit reste géré par le navigateur
    }
  }
}
