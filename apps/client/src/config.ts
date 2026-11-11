import { DEFAULT_WORLD } from '@terra/shared';

const ADJ = ['Wandering', 'Quiet', 'Bold', 'Curious', 'Lost', 'Swift', 'Gentle', 'Restless', 'Bright', 'Patient'];
const NOUN = ['Cartographer', 'Heron', 'Pilgrim', 'Fox', 'Lantern', 'Scout', 'Otter', 'Wayfarer', 'Moth', 'Seeker'];

export interface Config {
  world: string;
  signalUrl: string | null;
  iceServers: RTCIceServer[];
  /** Per-tab connection id (not a persistent identity). */
  peerId: string;
  name: string;
  hue: number;
}

function randomId(bytes = 9): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stored(key: string, make: () => string): string {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
    const n = make();
    localStorage.setItem(key, n);
    return n;
  } catch {
    return make();
  }
}

export function loadConfig(): Config {
  const params = new URLSearchParams(location.hash.slice(1));
  const world = (params.get('w') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || DEFAULT_WORLD;
  if (params.get('w') !== world) {
    params.set('w', world);
    history.replaceState(null, '', `#${params}`);
  }

  // Signaling: explicit #signal= override, then build-time config, then a
  // local dev server when served over plain http (localhost / LAN).
  const signalUrl =
    params.get('signal') ||
    import.meta.env.VITE_SIGNAL_URL ||
    (location.protocol === 'http:' ? `ws://${location.hostname}:8787` : null);

  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (import.meta.env.VITE_TURN_URL) {
    iceServers.push({
      urls: import.meta.env.VITE_TURN_URL,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }

  const name = stored('ti.name', () => {
    const r = crypto.getRandomValues(new Uint8Array(2));
    return `${ADJ[r[0] % ADJ.length]} ${NOUN[r[1] % NOUN.length]}`;
  });
  const hue = Number(stored('ti.hue', () => String(crypto.getRandomValues(new Uint16Array(1))[0] % 360)));

  return { world, signalUrl, iceServers, peerId: randomId(), name, hue };
}

export function inviteUrl(world: string, at?: { x: number; y: number }): string {
  const p = new URLSearchParams({ w: world });
  if (at) p.set('at', `${Math.round(at.x)},${Math.round(at.y)}`);
  return `${location.origin}${location.pathname}#${p}`;
}

export function inviteSpot(): { x: number; y: number } | null {
  const at = new URLSearchParams(location.hash.slice(1)).get('at');
  const m = at?.match(/^(-?\d+),(-?\d+)$/);
  return m ? { x: Number(m[1]) + 0.5, y: Number(m[2]) + 0.5 } : null;
}
