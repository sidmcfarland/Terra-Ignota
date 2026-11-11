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
| # | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold: workspaces, Vite PWA, CI, Pages deploy | Installable empty app live at a URL |
| M1 | Single-player: worldgen, chunk streaming, render, movement, camera | Walk an endless seeded world at 60fps |
| M2 | Networking core: signal server, WebRTC peers, one zone, star host | Two browsers see each other move |
| M3 | Zones: partitioning, election, border handoff, host migration | Kill the host tab; play continues |
| M4 | Persistence: signed ops, CRDT, IndexedDB, seed peer | Edits survive everyone logging off |
| M5 | Gameplay: shared atlas/fog, gathering, building, naming, chat | Fun for a group session |
| M6 | Scale: bot swarm, interest management, rate limits, validation | 300 bots across zones stay stable |
| M7 | Infra: docker-compose on VPS, TLS, TURN creds (time-limited HMAC) | Strict-NAT player can join |

## Risks
- **Backgrounded tabs throttle timers**, so a hidden tab hands off hosting immediately.
- **TURN bandwidth**: game packets are small and relayed players are ~15% of the total, which fits a $5 plan's traffic quota.
- **Malicious host**: tolerable in co-op. Mitigate with signed ops, backups cross-checking snapshots, and reputation.
- **Directory server is a single point of failure for joining**, but not for active play. Mitigate later with a DHT.

## Needs from you (before M7)
- A VPS (any $5 Linux box) and a domain or subdomain pointed at it.
