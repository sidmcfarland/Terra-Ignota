# Terra Ignota — Plan

A co-op exploration MMO in an isometric 3D view. It runs as an installable web app (PWA): open a URL and you're in. Players' devices host the world. The only central piece is one ~$5/mo VPS that runs signaling, a TURN relay and an always-on seed peer.

## Core loop
The world is endless, generated from a seed, and starts out **unknown**. Explorers fog-reveal it together into a **shared atlas**. Players gather, build waystations and name places, and their discoveries persist for everyone.

## Stack
| Concern | Choice |
|---|---|
| Language | TypeScript everywhere (shared sim runs in browser + Node) |
| Client | Vite + Three.js + vite-plugin-pwa, hosted on GitHub Pages |
| P2P transport | WebRTC data channels (unreliable for movement, reliable for ops) |
| Signaling + zone directory | Small Node WebSocket server (VPS) |
| NAT traversal | Public STUN + coturn TURN (VPS) |
| Seed peer | Headless Node peer (`node-datachannel`), anyone can run one |
| Storage | IndexedDB (browser), disk (seed) |
| Identity | Ed25519 keypair per device (WebCrypto), no accounts |
| Tests | Vitest (unit), Playwright (multi-browser e2e), Node bot swarm (load) |

## Repo layout (npm workspaces)
```
packages/shared   protocol, worldgen, sim, CRDT, crypto (isomorphic)
apps/client       PWA
apps/signal       signaling + zone directory server
apps/seed         headless always-on peer
infra/            docker-compose: signal + coturn + seed
```

## World & networking model
- **Worldgen**: deterministic noise from the world seed. Each chunk is 32×32 tiles, and terrain is never sent over the network.
- **Zones**: 8×8 chunks each. Every zone has one **host peer**, and players in that zone connect to it in a star (not a full mesh). Hosts of adjacent zones link to each other so players can see across borders.
- **Host election**: deterministic, based on a score (desktop, foreground tab, uptime, RTT), with ties broken by public key. Mobile, battery-powered and backgrounded tabs are excluded. The seed peer hosts any zone that has no eligible host.
- **Host migration**: the host streams snapshots to two backup peers. If the host drops, the next backup takes over within about 2s.
- **Sim**: the host ticks at 20 Hz. Players control their own movement and the host sanity-checks it (speed and collision). Co-op play allows lenient checks.
- **World edits**: signed ops in a per-chunk CRDT (last-writer-wins per tile, ordered by Lamport clock + public key). They're replicated to peers in the zone and to the seed.
- **Discovery**: the signaling server keeps soft-state `world/zone → host` entries via heartbeats. It never sees gameplay. *Later:* replace it with a DHT or gossip.
- **Join URL**: `https://<pages>/Terra-Ignota/#w=<worldId>` (an optional `&at=x,y` invites someone to a spot).

## Milestones
| # | Deliverable | Done when | Status |
|---|---|---|---|
| M0 | Scaffold: workspaces, Vite PWA, CI, Pages deploy | Installable empty app live at a URL | Built. Deploy deferred to M7: the repo is private and the free plan has no Pages for private repos. Run locally for now |
| M1 | Single-player: worldgen, chunk streaming, render, movement, camera | Walk an endless seeded world at 60fps | Done (3D isometric, Three.js) |
| M2 | Networking core: signal server, WebRTC peers, one zone, star host | Two browsers see each other move | Done (e2e-tested) |
| M3 | Zones: partitioning, election, border handoff, host migration | Kill the host tab; play continues | In progress: zone handoff done (e2e-tested). Next: link neighbouring hosts |
| M4 | Persistence: signed ops, CRDT, IndexedDB, seed peer | Edits survive everyone logging off | |
| M5 | Gameplay: shared atlas/fog, gathering, building, naming, chat | Fun for a group session | |
| M6 | Scale: bot swarm, interest management, rate limits, validation | 300 bots across zones stay stable | |
| M7 | Infra: docker-compose on VPS, TLS, TURN creds (time-limited HMAC) | Strict-NAT player can join | |

## M3 design (agreed 2026-11-11)
**Host election.** The signal server picks each zone's host from scores that peers send in their heartbeats. It still sees no gameplay.
- **Opt-in:** "Available to host" is on by default for desktops and off for mobile. A toggle in the settings menu stores the choice in localStorage, and `#host=0` turns it off for tests.
- **Hard limits:** a peer can't host unless it has opted in, its tab is in the foreground, it isn't mobile, and it isn't on battery where the browser can tell (only Chromium's Battery API reports this).
- **Score:** average ping to the zone's clients, reported by backups and clients (before a peer has hosted, its ping to the signal server stands in); its track record as a host, kept per device (unclean exits, how often the 20 Hz tick ran late, total time hosted; self-reported, which is acceptable for co-op); and uptime in the current session.
- **No flip-flopping:** the current host gets a bonus. A challenger must score at least 20% higher for 30s in a row before hosting moves. It moves immediately only on a crash, an opt-out or a backgrounded tab.
- **Capacity:** each candidate advertises a client cap, estimated from its CPU core count and how long its ticks take, starting around 30. A peer whose cap the zone's player count already exceeds is ranked lower.
- **Backups:** the next two candidates by score become the backups.
- **One host per zone.** A single authority keeps the simulation and the M4 edit merging simple. A zone that outgrows its host's cap is an M6 problem, solved by splitting the zone or relaying.

**Movement checks.** Lenient: up to about 25% over max speed, averaged over roughly 0.5s, and never through walls. A failing move silently snaps the player back to the last valid position. No kicks.

**Zone borders.** A player switches zones only after going 1 chunk (32 tiles) past the border, and switches back only after going 1 chunk back. Linked neighbouring hosts keep players across the border visible.

**e2e coverage.** A hard crash (host page closed with no goodbye; a backup takes over within about 2s) and a backgrounded host tab (immediate handoff).

## Open questions (M4 and M5)
Live state belongs to the zone's host. Lasting edits live in per-chunk CRDTs, replicated to every peer that has seen the chunk and to the seed, and they converge without consensus. These parts aren't designed yet:
- **Catching up:** how a new host or a returning player gets a chunk's edits (from the seed, from peers' IndexedDB, or both).
- **Keeping the seed in sync:** how the seed stays current across many zones, and how replicas spot and fill gaps in what they hold (for example, comparing per-chunk version vectors).
- **Edits across zone borders:** an edit that spans two zones, or one made by a player in a neighbouring zone's view.
- **Scarcity and inventory:** a CRDT can't enforce rules that span the world ("only one player gets this ore", unique place names, inventory counts). Options: each player owns their inventory as signed state, or the host or seed arbitrates for each chunk.

## Current limitations (what M2 left for later)
- **Zones can't see each other yet (M3).** Players switch zone sessions 1 chunk past a border (`nextZone` in shared), but neighbouring hosts aren't linked, so players on the other side of a border are invisible.
- **Host election is a placeholder (M3).** The signaling server picks the earliest member of a zone as host. Score-based election, backup peers and handing off when a tab is backgrounded aren't built yet. When the host leaves, the next member takes over in about 1.2s, and that is e2e-tested.
- **No identity keys yet (M4).** `peerId` is a random id per tab, used only for connections. Name and colour are kept in localStorage. The Ed25519 identity and signed ops come in M4.
- **The protocol is JSON (M6).** Snapshots send every player in the zone. Switch to a binary encoding and interest management in M6.
- **The deployed site is solo-only until M7.** Multiplayer on Pages needs the `SIGNAL_URL` repository variable, or `#signal=wss://…` in the link.

## Decisions
| Decision | Why |
|---|---|
| Co-op exploration, not competitive | The host of a zone can always cheat. Co-op play makes that tolerable. |
| PWA first, no app stores | The link is the install. Browsers can only connect peer-to-peer over WebRTC. |
| Target hundreds of concurrent players | This sets the zone and star-topology design. A full mesh breaks down at about 20–30 peers. |
| A ~$5/mo VPS is acceptable | Signaling, TURN for the ~10–20% of players behind strict NATs, and a seed peer. Zero infrastructure would lock those players out. |
| Terrain is generated, never sent | Only edits travel the network, which is what makes P2P viable. |
| Signaling server is soft-state only | It never sees gameplay and can be swapped for a DHT later. |
| 3D isometric (Three.js) instead of 2D Pixi | The developer switched after M2. The top-down chunk painter remains as `render/atlas.ts` for the M5 atlas. |
| Spawn searched from the centre of zone 0,0 | Spawning at the origin put players either side of a zone border. |
| Signal server elects hosts from peer-reported scores | Simplest extension of what exists. Peers computing it themselves would still need the server's member list. |
| Hosting is opt-out on desktop, opt-in on mobile | Hundreds of players need a deep pool of hosts, and phones make poor ones. |
| One host per zone, with a 20% / 30s threshold before switching | Keeps one authority per zone and stops hosts flip-flopping. |
| Lenient movement checks with a silent snap-back | Co-op makes cheating low-stakes, and strict per-tick checks would rubber-band honest players on bad connections. |
| 1-chunk margin at zone borders | Stops a player standing on the line from being handed between hosts over and over. |
| Pages deploy waits until M7 | Pages isn't available for private repos on the free plan, so the game runs locally until then. |

## Risks
- **Backgrounded tabs throttle timers**, so a hidden tab hands off hosting immediately.
- **TURN bandwidth**: game packets are small and relayed players are ~15% of the total, which fits a $5 plan's traffic quota.
- **Malicious host**: tolerable in co-op. Mitigate with signed ops, backups cross-checking snapshots, and reputation.
- **Directory server is a single point of failure for joining**, but not for active play. Mitigate later with a DHT.

## Needs from you (before M7)
- A VPS (any $5 Linux box) and a domain or subdomain pointed at it.
