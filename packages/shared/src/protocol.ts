import type { ZoneId } from './zones.ts';

export const PROTOCOL_VERSION = 2;

// ---- Client <-> signaling server (WebSocket, JSON) ----

/**
 * What a relayed WebRTC signal sets up: a client's link to its zone host, or a
 * border link between the hosts of two neighbouring zones.
 */
export type LinkKind = 'zone' | 'border';

export type ToSignal =
  | { t: 'join'; v: number; world: string; zone: ZoneId; peerId: string }
  | { t: 'signal'; to: string; link: LinkKind; data: SignalData };

export interface NeighbourHost {
  zone: ZoneId;
  hostId: string;
}

export type FromSignal =
  /** Sent after join and whenever the zone host changes. */
  | { t: 'host'; zone: ZoneId; hostId: string }
  /** Sent to a zone host: the hosts of the (up to 8) neighbouring zones. Resent when any of them changes. */
  | { t: 'neighbours'; zone: ZoneId; hosts: NeighbourHost[] }
  | { t: 'signal'; from: string; link: LinkKind; data: SignalData }
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
  /** Host to neighbouring host: the players in the sender's zone. */
  | { t: 'border'; players: PlayerInfo[] }
  | { t: 'chat'; from: string; text: string };

/** Unreliable channel. Positions packed as [id, x, y]. */
export type Unreliable =
  | { t: 'pos'; seq: number; x: number; y: number }
  | { t: 'snap'; tick: number; p: Array<[string, number, number]> }
  /** Host to neighbouring host: the sender's players near the receiver's zone. */
  | { t: 'edge'; p: Array<[string, number, number]> };
