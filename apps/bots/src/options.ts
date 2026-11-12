export interface Options {
  /** Bots in the whole swarm. */
  bots: number;
  /** Zones to spread them over (0: one per 25 bots). */
  zones: number;
  world: string;
  signal: string;
  /** Seconds to run after the last bot has started (0: until Ctrl-C). */
  duration: number;
  /** Bots started per second. */
  ramp: number;
  /** Fraction of bots that are available to host. */
  hosts: number;
  /** Fraction of bots that walk back and forth across zone borders. */
  roam: number;
  /** Tile edits per bot per second. */
  edits: number;
  /** Every this many seconds a bot quits without warning and a new one joins (0: never). Hosts and clients take turns. */
  churn: number;
  /** Node processes to split the bots over. */
  procs: number;
  /** Seconds between progress lines. */
  report: number;
  /** Seconds after the last bot starts before the measured window begins. */
  settle: number;
  /** Client cap each bot advertises for election (0: from this machine's cores, as a browser would). */
  cap: number;
  /** How far each bot sees other players, in tiles (a browser asks for what its screen shows: about 67 at 1080p and default zoom). */
  view: number;
  /** STUN server URL for bots (empty: local candidates only, for one machine or a LAN). */
  stun: string;
  /** Write the final summary to this file as JSON. */
  json: string;
  /** Internal: which worker process this is (-1: the parent). */
  worker: number;
}

const DEFAULTS: Options = {
  bots: 30,
  zones: 0,
  world: '',
  signal: process.env.SIGNAL_URL ?? 'ws://localhost:8787',
  duration: 30,
  ramp: 10,
  hosts: 0.2,
  roam: 0.25,
  edits: 0.02,
  churn: 0,
  procs: 1,
  report: 5,
  settle: 10,
  cap: 0,
  view: 64,
  stun: '',
  json: '',
  worker: -1,
};

export const USAGE = `Usage: npm run bots -- [options]
  --bots N       bots in the swarm (default ${DEFAULTS.bots})
  --zones N      zones to spread them over (default: one per 25 bots)
  --world ID     world to join (default: a new one, swarm-<time>)
  --signal URL   signal server (default $SIGNAL_URL or ws://localhost:8787)
  --duration S   seconds to run after the last bot starts; 0 = until Ctrl-C (default ${DEFAULTS.duration})
  --ramp N       bots started per second (default ${DEFAULTS.ramp})
  --hosts F      fraction of bots available to host (default ${DEFAULTS.hosts})
  --roam F       fraction of bots that cross zone borders (default ${DEFAULTS.roam})
  --edits R      tile edits per bot per second (default ${DEFAULTS.edits})
  --churn S      every S seconds a bot quits abruptly and a new one joins; 0 = never (default 0)
  --procs N      Node processes to split the bots over (default 1)
  --report S     seconds between progress lines (default ${DEFAULTS.report})
  --settle S     seconds after the last bot starts before measuring (default ${DEFAULTS.settle})
  --cap N        client cap each bot advertises; 0 = from CPU cores (default 0)
  --view N       how far each bot sees other players, in tiles (default ${DEFAULTS.view})
  --stun URL     STUN server for the bots (default: none, local candidates only)
  --json FILE    also write the summary as JSON`;

export function parseOptions(argv: string[]): Options {
  const o: Options = { ...DEFAULTS };
  const opts = o as unknown as Record<string, string | number>;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!m || !(m[1] in DEFAULTS)) throw new Error(`unknown option ${arg}\n${USAGE}`);
    const value = m[2] ?? argv[++i];
    if (value === undefined) throw new Error(`option ${arg} needs a value`);
    if (typeof opts[m[1]] === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < -1) throw new Error(`option --${m[1]} needs a number, got ${value}`);
      opts[m[1]] = n;
    } else {
      opts[m[1]] = value;
    }
  }
  if (!o.world) o.world = `swarm-${Date.now().toString(36)}`;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(o.world)) throw new Error(`bad world id ${o.world}`);
  o.bots = Math.max(1, Math.floor(o.bots));
  o.procs = Math.max(1, Math.min(Math.floor(o.procs), o.bots));
  if (!o.zones) o.zones = Math.ceil(o.bots / 25);
  o.ramp = Math.max(0.1, o.ramp);
  return o;
}

/** The options as command-line arguments, for starting a worker process. */
export function toArgs(o: Options): string[] {
  return Object.entries(o).filter(([, v]) => v !== '').map(([k, v]) => `--${k}=${v}`);
}
