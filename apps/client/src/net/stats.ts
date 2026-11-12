/** Messages counted, their total size and the largest one, in bytes. */
export interface Counter {
  n: number;
  bytes: number;
  max: number;
}

/**
 * Traffic counters for every Peer in this JS context: one browser tab, or one
 * bot process. Read by the bot swarm's metrics and the debug panel.
 */
export const netStats = {
  /** Sent messages by channel and type, e.g. 'u:snap' or 'r:edits'. */
  sent: new Map<string, Counter>(),
  /** Received messages by channel ('r' or 'u'). */
  recv: new Map<string, Counter>(),
  /** Received messages dropped by a rate limit or size cap. */
  dropped: 0,
  /** Links that closed before they ever opened. */
  connectFails: 0,
};

export function count(map: Map<string, Counter>, key: string, bytes: number) {
  let c = map.get(key);
  if (!c) map.set(key, (c = { n: 0, bytes: 0, max: 0 }));
  c.n++;
  c.bytes += bytes;
  if (bytes > c.max) c.max = bytes;
}
