import { clientCap, type HostMetrics } from '@terra/shared';

const OPT_KEY = 'ti.host';
const RECORD_KEY = 'ti.hostRecord';
/** peerId -> last heartbeat (epoch ms) for each tab currently hosting on this device. */
const LIVE_KEY = 'ti.hostingTabs';
/** A hosting tab that hasn't beaten for this long stopped without a clean exit. */
const STALE_MS = 15_000;

interface HostRecord {
  hostedMs: number;
  uncleanExits: number;
}

/**
 * What this device brings to host election: whether the player allows it to
 * host, whether it's able to right now, and its hosting track record (kept
 * in localStorage across visits).
 */
export class HostingProfile {
  optIn: boolean;
  readonly mobile: boolean;
  battery = false;
  /** Called when something the directory should know changes right away. */
  onChange: () => void = () => {};

  private readonly peerId: string;
  private readonly started = performance.now();
  private record: HostRecord;
  private hostingSince: number | null = null;

  constructor(peerId: string) {
    this.peerId = peerId;
    this.mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
      (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);

    const param = new URLSearchParams(location.hash.slice(1)).get('host');
    const stored = read(OPT_KEY);
    this.optIn = param !== null ? param !== '0' : stored !== null ? stored === '1' : !this.mobile;

    this.record = { hostedMs: 0, uncleanExits: 0, ...parse<HostRecord>(read(RECORD_KEY)) };
    const live = parse<Record<string, number>>(read(LIVE_KEY)) ?? {};
    for (const [id, beat] of Object.entries(live)) {
      if (Date.now() - beat > STALE_MS) {
        this.record.uncleanExits++;
        delete live[id];
      }
    }
    write(LIVE_KEY, JSON.stringify(live));
    write(RECORD_KEY, JSON.stringify(this.record));

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<EventTarget & { charging: boolean }>;
    };
    nav.getBattery?.().then((b) => {
      const update = () => {
        this.battery = !b.charging;
        this.onChange();
      };
      b.addEventListener('chargingchange', update);
      update();
    }).catch(() => {});

    document.addEventListener('visibilitychange', () => this.onChange());
    addEventListener('pagehide', () => this.setHosting(false)); // A clean exit.
  }

  get visible(): boolean {
    return document.visibilityState === 'visible';
  }

  get hostedMs(): number {
    return this.record.hostedMs + (this.hostingSince === null ? 0 : performance.now() - this.hostingSince);
  }

  get uncleanExits(): number {
    return this.record.uncleanExits;
  }

  setOptIn(on: boolean) {
    this.optIn = on;
    write(OPT_KEY, on ? '1' : '0');
    this.onChange();
  }

  /** Track time spent hosting, and mark this tab as hosting so a crash can be noticed next visit. */
  setHosting(on: boolean) {
    const now = performance.now();
    if (this.hostingSince !== null) {
      this.record.hostedMs += now - this.hostingSince;
      this.hostingSince = on ? now : null;
    } else if (on) {
      this.hostingSince = now;
    }
    const live = parse<Record<string, number>>(read(LIVE_KEY)) ?? {};
    if (on) live[this.peerId] = Date.now();
    else delete live[this.peerId];
    write(LIVE_KEY, JSON.stringify(live));
    write(RECORD_KEY, JSON.stringify(this.record));
  }

  metrics(rttMs: number, lateTicks: number): HostMetrics {
    return {
      optIn: this.optIn,
      visible: this.visible,
      mobile: this.mobile,
      battery: this.battery,
      rttMs: Math.round(rttMs),
      uptimeMs: Math.round(performance.now() - this.started),
      hostedMs: Math.round(this.hostedMs),
      uncleanExits: this.record.uncleanExits,
      lateTicks: Math.round(lateTicks * 1000) / 1000,
      cap: clientCap(navigator.hardwareConcurrency, lateTicks),
    };
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: hosting still works, the track record just isn't kept.
  }
}

function parse<T>(s: string | null): T | null {
  try {
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
