import type { ZoneId } from './zones.ts';

export const PROTOCOL_VERSION = 1;

// ---- Client <-> signaling server (WebSocket, JSON) ----

export type ToSignal =
  | { t: 'join'; v: number; world: string; zone: ZoneId; peerId: string }
  | { t: 'signal'; to: string; data: SignalData };

export type FromSignal =
  /** Sent after join and whenever the zone host changes. */
  | { t: 'host'; zone: ZoneId; hostId: string }
  | { t: 'signal'; from: string; data: SignalData }
  /** Sent to a zone host when a member's socket closes. */
  | { t: 'left'; peerId: string }
  | { t: 'error'; message: string };

export type SignalData =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null };

// ---- Peer <-> peer (WebRTC data channels, JSON) ----

export interface PlayerInfo {
  id: string;
  name: string;
  hue: number;
}

/** Reliable channel. */
export type Reliable =
  | { t: 'hello'; info: PlayerInfo; x: number; y: number }
  | { t: 'roster'; players: PlayerInfo[] }
  | { t: 'chat'; from: string; text: string };

/** Unreliable channel. Positions packed as [id, x, y]. */
export type Unreliable =
  | { t: 'pos'; seq: number; x: number; y: number }
  | { t: 'snap'; tick: number; p: Array<[string, number, number]> };
