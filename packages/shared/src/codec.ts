/**
 * Binary encoding for the unreliable channel: positions, snapshots and probes,
 * the messages sent 20 times a second. Everything else stays JSON.
 *
 * Integers are LEB128 varints (zigzag for signed ones). Positions are fixed
 * point, 1/64 of a tile. A list of positions carries one origin tile and each
 * entry's offset from it, so a nearby player costs about 5 bytes.
 */
import type { PlayerPos, Unreliable } from './protocol.ts';

/** Position resolution: steps per tile. */
export const POS_SCALE = 64;
/** The most positions one message may carry; a longer list is refused when decoding. */
export const MAX_POSITIONS = 4096;
const MAX_ID = 64;

const T_POS = 1, T_PING = 2, T_PONG = 3, T_SNAP = 4, T_EDGE = 5, T_STATE = 6;

class Writer {
  private buf = new Uint8Array(new ArrayBuffer(1024));
  private view = new DataView(this.buf.buffer);
  private at = 0;

  reset() {
    this.at = 0;
  }

  private room(n: number) {
    if (this.at + n <= this.buf.length) return;
    const next = new Uint8Array(new ArrayBuffer(Math.max(this.buf.length * 2, this.at + n)));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) {
    this.room(1);
    this.buf[this.at++] = v;
  }

  /** Unsigned integer up to 2^53. Anything else (negative, fractional, not a number) is written as 0. */
  varuint(v: number) {
    if (!(v >= 0) || !Number.isSafeInteger(v)) v = 0;
    this.room(8);
    while (v >= 128) {
      this.buf[this.at++] = (v % 128) | 128;
      v = Math.floor(v / 128);
    }
    this.buf[this.at++] = v;
  }

  varint(v: number) {
    if (!Number.isSafeInteger(v) || Math.abs(v) > 2 ** 52) v = 0;
    this.varuint(v < 0 ? -2 * v - 1 : 2 * v);
  }

  f64(v: number) {
    this.room(8);
    this.view.setFloat64(this.at, v);
    this.at += 8;
  }

  /** A short ASCII string, such as a peer id. */
  str(s: string) {
    const n = Math.min(s.length, MAX_ID);
    this.u8(n);
    this.room(n);
    for (let i = 0; i < n; i++) this.buf[this.at++] = s.charCodeAt(i) & 127;
  }

  /** The message so far, as its own buffer. */
  bytes(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.at);
  }
}

class Reader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get done(): boolean {
    return this.at === this.buf.length;
  }

  u8(): number {
    if (this.at >= this.buf.length) throw new RangeError('truncated');
    return this.buf[this.at++];
  }

  varuint(): number {
    let v = 0, mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      v += (b & 127) * mul;
      if (b < 128) return v;
      mul *= 128;
    }
    throw new RangeError('varint too long');
  }

  varint(): number {
    const u = this.varuint();
    return u % 2 ? -(u + 1) / 2 : u / 2;
  }

  f64(): number {
    if (this.at + 8 > this.buf.length) throw new RangeError('truncated');
    const v = this.view.getFloat64(this.at);
    this.at += 8;
    return v;
  }

  str(): string {
    const n = this.u8();
    if (n > MAX_ID || this.at + n > this.buf.length) throw new RangeError('bad string');
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.at++]);
    return s;
  }
}

const fixed = (v: number) => Math.round(v * POS_SCALE);

/** Positions as offsets from the middle of their bounding box, which keeps the offsets short. */
function writePositions(w: Writer, p: PlayerPos[]) {
  w.varuint(p.length);
  if (!p.length) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [, x, y] of p) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const ox = Math.round((x0 + x1) / 2) || 0, oy = Math.round((y0 + y1) / 2) || 0;
  w.varint(ox);
  w.varint(oy);
  for (const [n, x, y] of p) {
    w.varuint(n);
    w.varint(fixed(x - ox));
    w.varint(fixed(y - oy));
  }
}

function readPositions(r: Reader): PlayerPos[] {
  const count = r.varuint();
  if (count > MAX_POSITIONS) throw new RangeError('too many positions');
  const p: PlayerPos[] = [];
  if (!count) return p;
  const ox = r.varint(), oy = r.varint();
  for (let i = 0; i < count; i++) p.push([r.varuint(), ox + r.varint() / POS_SCALE, oy + r.varint() / POS_SCALE]);
  return p;
}

const writer = new Writer();

/** Encode a message for the unreliable channel. */
export function encodeUnreliable(m: Unreliable): Uint8Array<ArrayBuffer> {
  const w = writer;
  w.reset();
  switch (m.t) {
    case 'pos':
      w.u8(T_POS);
      w.varuint(m.seq);
      w.varint(fixed(m.x));
      w.varint(fixed(m.y));
      w.varuint(Math.round(m.view));
      break;
    case 'ping':
    case 'pong':
      w.u8(m.t === 'ping' ? T_PING : T_PONG);
      w.f64(m.ts);
      break;
    case 'snap':
      w.u8(T_SNAP);
      w.varuint(m.tick);
      w.varuint(m.n);
      writePositions(w, m.p);
      break;
    case 'edge':
      w.u8(T_EDGE);
      writePositions(w, m.p);
      break;
    case 'state':
      w.u8(T_STATE);
      w.varuint(m.tick);
      w.varuint(m.p.length);
      for (const [id, x, y] of m.p) {
        w.str(id);
        w.varint(fixed(x));
        w.varint(fixed(y));
      }
      break;
  }
  return w.bytes();
}

/**
 * Decode a message from the unreliable channel, or null if it's malformed.
 * Every number in the result is finite: integers come from varints, positions
 * from integers over POS_SCALE, and probe timestamps are checked.
 */
export function decodeUnreliable(data: ArrayBuffer | Uint8Array): Unreliable | null {
  try {
    const r = new Reader(data instanceof Uint8Array ? data : new Uint8Array(data));
    const m = read(r);
    return m && r.done ? m : null;
  } catch {
    return null;
  }
}

function read(r: Reader): Unreliable | null {
  const type = r.u8();
  switch (type) {
    case T_POS:
      return { t: 'pos', seq: r.varuint(), x: r.varint() / POS_SCALE, y: r.varint() / POS_SCALE, view: r.varuint() };
    case T_PING:
    case T_PONG: {
      const ts = r.f64();
      return Number.isFinite(ts) ? { t: type === T_PING ? 'ping' : 'pong', ts } : null;
    }
    case T_SNAP:
      return { t: 'snap', tick: r.varuint(), n: r.varuint(), p: readPositions(r) };
    case T_EDGE:
      return { t: 'edge', p: readPositions(r) };
    case T_STATE: {
      const tick = r.varuint(), count = r.varuint();
      if (count > MAX_POSITIONS) return null;
      const p: Array<[string, number, number]> = [];
      for (let i = 0; i < count; i++) p.push([r.str(), r.varint() / POS_SCALE, r.varint() / POS_SCALE]);
      return { t: 'state', tick, p };
    }
    default:
      return null;
  }
}
