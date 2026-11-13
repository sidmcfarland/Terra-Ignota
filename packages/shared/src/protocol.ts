import type { Op } from './edits.ts';
import type { HostMetrics } from './election.ts';
import type { ZoneId } from './zones.ts';

export const PROTOCOL_VERSION = 10;

// ---- Client <-> signaling server (WebSocket, JSON) ----

/**
 * What a relayed WebRTC signal sets up: a client's link to its zone host, a
 * border link between the hosts of two neighbouring zones, or a seed peer's
 * link to a zone host.
 */
export type LinkKind = 'zone' | 'border' | 'seed';

/** A zone and its current host, in some world. */
export interface ZoneHost {
  world: string;
  zone: ZoneId;
  hostId: string;
}

export type ToSignal =
  | { t: 'join'; v: number; world: string; zone: ZoneId; peerId: string }
  /** Register as a seed peer: an always-on replica that joins every zone host. */
  | { t: 'seed'; v: number; peerId: string }
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
  /** To a seed after it registers: every zone that has a host. */
  | { t: 'zones'; hosts: ZoneHost[] }
  /** To seeds: a zone's host changed, or the zone emptied (hostId null). */
  | { t: 'zoneHost'; world: string; zone: ZoneId; hostId: string | null }
  /** Liveness probe, answered from page script (unlike a WebSocket ping, which a hung page still answers). */
  | { t: 'probe'; n: number }
  | { t: 'error'; message: string };

export type SignalData =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null };

// ---- Peer <-> peer (WebRTC data channels) ----

export interface PlayerInfo {
  id: string;
  name: string;
  hue: number;
}

/**
 * A player as a host announces it: its info plus the short number that stands
 * for it in that host's snapshots. Numbers belong to one host and are never reused.
 */
export interface PlayerEntry extends PlayerInfo {
  n: number;
}

/** A player's position: the announcing host's number for the player, then x and y in tiles. */
export type PlayerPos = [n: number, x: number, y: number];

/** Reliable channel (JSON). */
export type Reliable =
  /** Client to host on connect. pub is the device's Ed25519 public key, the author of its edits. */
  | { t: 'hello'; info: PlayerInfo; x: number; y: number; pub: string }
  /** Client to host: a new op by this client, in any layer. */
  | { t: 'edit'; op: Op }
  /**
   * Host to client: the host refused the client's live op with this signature, so the client takes it back.
   * `why` says which check failed: 'author', 'rate', 'reach', 'clock', 'sig', or 'lost' (it lost the merge to
   * what the host holds). `cur` is what the host holds at that op's key, if anything, for the client to merge.
   */
  | { t: 'reject'; sig: string; why: string; cur?: Op }
  /** Any direction (including between neighbouring hosts, and between a host and a seed): ops to merge. */
  | { t: 'edits'; ops: Op[] }
  /**
   * A client or a seed to a host on connect: a digest for each bucket it holds ops in (see BucketId in
   * edits.ts): the zone's chunks, the zones of the atlas, and a client's own player-scope ops.
   */
  | { t: 'sync'; d: Record<string, string> }
  /**
   * Host to a syncing peer: buckets where the peer may have ops the host lacks; send them.
   * The host asks a few buckets at a time, and only accepts catch-up ops for buckets it asked for.
   */
  | { t: 'syncWant'; keys: string[] }
  /** Host to client: players about to appear in its snapshots. Sent once per player, as each first comes into the client's view. */
  | { t: 'meet'; players: PlayerEntry[] }
  /** Host to neighbouring host: the players in the sender's zone. */
  | { t: 'border'; players: PlayerEntry[] }
  | { t: 'chat'; from: string; text: string };

/** Unreliable channel (binary: see codec.ts). */
export type Unreliable =
  /** Client to host: where the client is, and how far (in tiles) it wants to see other players. */
  | { t: 'pos'; seq: number; x: number; y: number; view: number }
  /** Host to client round-trip probe, echoed back as pong. */
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  /** Host to client: the host's tick, how many players its zone holds, and the players within the client's view. */
  | { t: 'snap'; tick: number; n: number; p: PlayerPos[] }
  /** Host to neighbouring host: the sender's players near the receiver's zone. */
  | { t: 'edge'; p: PlayerPos[] }
  /** Host to its backups: the zone state a successor needs. Players packed as [peer id, x, y]. */
  | { t: 'state'; tick: number; p: Array<[string, number, number]> };
