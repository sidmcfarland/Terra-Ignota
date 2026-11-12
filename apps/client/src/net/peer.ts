import type { Reliable, SignalData, Unreliable } from '@terra/shared';
import { count, netStats } from './stats.ts';

export interface PeerHandlers {
  onOpen(): void;
  onClose(): void;
  onReliable(m: Reliable): void;
  onUnreliable(m: Unreliable): void;
}

/**
 * One WebRTC connection with two data channels:
 * `r` (reliable, ordered) and `u` (unordered, no retransmits).
 */
export class Peer {
  private pc: RTCPeerConnection;
  private r?: RTCDataChannel;
  private u?: RTCDataChannel;
  private pendingIce: RTCIceCandidateInit[] = [];
  private opened = false;
  private closed = false;
  private discoTimer?: ReturnType<typeof setTimeout>;

  readonly remoteId: string;
  private readonly sendSignal: (d: SignalData) => void;
  private readonly h: PeerHandlers;

  constructor(
    remoteId: string,
    initiator: boolean,
    iceServers: RTCIceServer[],
    sendSignal: (d: SignalData) => void,
    h: PeerHandlers,
  ) {
    this.remoteId = remoteId;
    this.sendSignal = sendSignal;
    this.h = h;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (e) => this.sendSignal({ kind: 'ice', candidate: e.candidate?.toJSON() ?? null });
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      clearTimeout(this.discoTimer);
      if (s === 'failed' || s === 'closed') this.close();
      else if (s === 'disconnected') this.discoTimer = setTimeout(() => this.close(), 4000);
    };
    if (initiator) {
      this.setup(this.pc.createDataChannel('r', { ordered: true }));
      this.setup(this.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
      void this.offer();
    } else {
      this.pc.ondatachannel = (e) => this.setup(e.channel);
    }
    // Give up if the connection never comes up.
    setTimeout(() => !this.opened && this.close(), 15_000);
  }

  private async offer() {
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.sendSignal({ kind: 'offer', sdp: this.pc.localDescription!.sdp });
    } catch (err) {
      console.warn('offer failed', err);
      this.close();
    }
  }

  async handleSignal(d: SignalData) {
    if (this.closed) return;
    try {
      if (d.kind === 'offer' || d.kind === 'answer') {
        await this.pc.setRemoteDescription({ type: d.kind, sdp: d.sdp });
        for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c);
        if (d.kind === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.sendSignal({ kind: 'answer', sdp: this.pc.localDescription!.sdp });
        }
      } else if (d.candidate) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(d.candidate);
        else this.pendingIce.push(d.candidate);
      }
    } catch (err) {
      console.warn('signal handling failed', err);
    }
  }

  private setup(ch: RTCDataChannel) {
    if (ch.label === 'r') this.r = ch;
    else if (ch.label === 'u') this.u = ch;
    else return ch.close();
    ch.onopen = () => {
      if (!this.opened && this.r?.readyState === 'open' && this.u?.readyState === 'open') {
        this.opened = true;
        this.h.onOpen();
      }
    };
    ch.onclose = () => this.close();
    ch.onmessage = (e) => {
      count(netStats.recv, ch.label, e.data.length);
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ch.label === 'r') this.h.onReliable(m);
      else this.h.onUnreliable(m);
    };
  }

  get isOpen() {
    return this.opened && !this.closed;
  }

  sendR(m: Reliable) {
    if (this.r?.readyState !== 'open') return;
    const data = JSON.stringify(m);
    if (this.send(this.r, data)) count(netStats.sent, `r:${m.t}`, data.length);
  }

  sendU(m: Unreliable) {
    // Drop rather than queue when congested; positions are superseded anyway.
    if (this.u?.readyState !== 'open' || this.u.bufferedAmount >= 64 * 1024) return;
    const data = JSON.stringify(m);
    if (this.send(this.u, data)) count(netStats.sent, `u:${m.t}`, data.length);
  }

  /** Send, treating a channel that closed under us as a dropped message rather than an exception. */
  private send(ch: RTCDataChannel, data: string): boolean {
    try {
      ch.send(data);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (!this.opened) netStats.connectFails++;
    clearTimeout(this.discoTimer);
    this.pc.close();
    this.h.onClose();
  }
}
