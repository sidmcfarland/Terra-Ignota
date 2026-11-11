import type { HostMetrics } from './election.ts';
import type { ZoneId } from './zones.ts';

export const PROTOCOL_VERSION = 4;

// ---- Client <-> signaling server (WebSocket, JSON) ----

/**
 * What a relayed WebRTC signal sets up: a client's link to its zone host, or a
 * border link between the hosts of two neighbouring zones.
 */
export type LinkKind = 'zone' | 'border';

export type ToSignal =
  | { t: 'join'; v: number; world: string; zone: ZoneId; peerId: string }
  | { t: 'signal'; to: string; link: LinkKind; data: SignalData }
  /** Heartbeat with what the directory needs to elect hosts. Sent every STATUS_INTERVAL_MS and on changes. */
  | { t: 'status'; m: HostMetrics }
  /** Round-trip probe; answered with a pong carrying the same n. */
  | { t: 'ping'; n: number }
  /** Answer to the directory's liveness probe. */
  | { t: 'alive'; n: number }
  /** A member reports that its zone's host has gone silent. */
  | { t: 'hostDown'; zone: ZoneId };

export interface NeighbourHost {
  zone: ZoneId;
  hostId: string;
}

export type FromSignal =
  /** Sent after join and whenever the zone's host or backups change. Backups are best first. */
  | { t: 'host'; zone: ZoneId; hostId: string; backups: string[] }
  /** Sent to a zone host: the hosts of the (up to 8) neighbouring zones. Resent when any of them changes. */
  | { t: 'neighbours'; zone: ZoneId; hosts: NeighbourHost[] }
  | { t: 'signal'; from: string; link: LinkKind; data: SignalData }
  /** Sent to a zone host when a member's socket closes. */
  | { t: 'left'; peerId: string }
  | { t: 'pong'; n: number }
  /** Liveness probe, answered from page script (unlike a WebSocket ping, which a hung page still answers). */
  | { t: 'probe'; n: number }
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
  /** Host to client round-trip probe, echoed back as pong. */
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'snap'; tick: number; p: Array<[string, number, number]> }
  /** Host to neighbouring host: the sender's players near the receiver's zone. */
  | { t: 'edge'; p: Array<[string, number, number]> }
  /** Host to its backups: the zone state a successor needs. Players packed as [id, x, y]. */
  | { t: 'state'; tick: number; p: Array<[string, number, number]> };
