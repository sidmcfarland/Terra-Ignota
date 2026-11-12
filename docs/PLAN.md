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
| M3 | Zones: partitioning, election, border handoff, host migration | Kill the host tab; play continues | Done (e2e-tested): zone handoff, neighbouring-host links, score-based election, backups with state streaming. A hung host is replaced in about 2s |
| M4 | Persistence: signed ops, CRDT, IndexedDB, seed peer | Edits survive everyone logging off | Done (e2e-tested): identity, signed tile ops, per-chunk CRDT, replication, IndexedDB, catch-up between peers, and the seed peer keeping edits on disk |
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
- **Catching up (answered in M4a):** when a client connects, it sends its host a digest per zone chunk (count, highest clock and a hash of its ops). The host sends the chunks where it differs and asks for the chunks where the client has edits, so both converge. A new host already holds its zone's edits: it was a client there.
- **Keeping the seed in sync (answered in M4b):** the signal server tells each seed every zone's host and every change. The seed dials each host over WebRTC (`seed` links), syncs with the same digests clients use, and gets every edit the host spreads after that.
- **Edits across zone borders (partly answered in M4a):** hosts pass edits to neighbouring hosts when the edit is within `BORDER_VIEW` of their zone. A player catches up on another zone's chunks only after moving into it.
- **Scarcity and inventory:** a CRDT can't enforce rules that span the world ("only one player gets this ore", unique place names, inventory counts). Options: each player owns their inventory as signed state, or the host or seed arbitrates for each chunk.

## Current limitations (what M2 left for later)
- **Seeing across borders is per zone, not per player (M6).** Neighbouring hosts link up (`net/border.ts`) and share players within `BORDER_VIEW` (3 chunks) of each other's zone. Range is measured to the other zone, so everyone in a zone sees a player standing near it, however far away they are. Per-viewer interest management comes in M6.
- **Failover still reconnects clients (M3 follow-up).** The host streams its state (tick and validated positions) to two backups at 5 Hz, and the first eligible backup succeeds it. A hung host is found when a client sees 1s without snapshots and the directory's probe gets no reply within 750ms (e2e-tested at about 1.9s). After a takeover, clients still open a new WebRTC link to the successor. Pre-connecting clients to the first backup would cut that out.
- **Backups don't change once chosen.** A backup keeps its place while it's present and eligible, so a newcomer with a better score doesn't replace it. This stops near-equal scores from reshuffling the order on every heartbeat.
- **Election approximations.** A host's ping is its average round trip to its clients, while everyone else's is to the signal server, so the numbers aren't strictly comparable. If nobody in a zone can host (all opted out, mobile or backgrounded), the best of them hosts anyway. The track record is self-reported and kept per device in localStorage.
- **The seed stores edits but doesn't host (M7).** The design has it host zones that have no eligible host. Today it's only a replica, so a zone of phones is still hosted by a phone.
- **The seed only syncs when a link opens.** It catches up with a zone when it first links to that zone's host, then receives new edits live. An edit made while no seed was connected reaches the seed only when some host it links to holds that edit.
- **The seed's disk store is one append-only file per world** (`DATA_DIR/<world>.jsonl`). It's compacted on load when superseded lines dominate, and loaded whole per world.
- **Anyone can run a seed and receive every world's edits.** That's fine while edits are public co-op data. Restricting it would need seed credentials on the signal server.
- **Edit checks slow casual misuse but can't stop a determined griefer.** A host accepts a live edit only from its author, within 4 tiles of where it sees that player, and at most 10 a second. Ops arriving through catch-up are checked only for a valid signature, because they can be older edits or another player's edits being passed along. Real protection needs reputation (see Risks).
- **A rejected edit stays in the painter's own copy.** Nothing tells the client the host refused it, so the two disagree on that tile until it's edited again. The B key only paints adjacent tiles, so normal play doesn't hit this. The host should send rejections back.
- **Each device loads all its edits for a world at startup.** That's fine at today's sizes. Loading per chunk can wait until worlds grow.
- **Identity is per device, not per player.** The Ed25519 key lives in IndexedDB, so clearing site data or switching devices makes a new identity. `peerId` is still a random id per tab, used only for connections.
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
| First editable thing is painting tiles (path, wall, back to generated) | It matches the per-tile last-writer-wins CRDT exactly and changes walkability, so it also exercises movement and the host's checks. Path and Wall are new tile types worldgen never makes, so no existing world changed. |
| The seed is a WebRTC peer (node-datachannel), not a relay through the signal server | The signal server stays out of gameplay. The seed reuses the client's `Peer` class through node-datachannel's WebRTC polyfill. |
| Edit ties break on clock, then author key, then signature | One device can run several tabs with the same key, so author alone isn't a total order. |
| The directory confirms a silent host with a probe answered from page script | One client's report could be wrong (its own link may be the problem), and a hung page still answers WebSocket pings from the browser's network layer. |
| Hosts of neighbouring zones (incl. diagonals) share one direct link, listed by the signal server | Players see across borders while clients still connect only to their own host. The server already knows every zone's host, so it sends each host its neighbours. The lower peer id dials, so each pair has one link. |
| Pages deploy waits until M7 | Pages isn't available for private repos on the free plan, so the game runs locally until then. |

## Risks
- **Backgrounded tabs throttle timers**, so a hidden tab hands off hosting immediately.
- **TURN bandwidth**: game packets are small and relayed players are ~15% of the total, which fits a $5 plan's traffic quota.
- **Malicious host**: tolerable in co-op. Mitigate with signed ops, backups cross-checking snapshots, and reputation.
- **Directory server is a single point of failure for joining**, but not for active play. Mitigate later with a DHT.

## Needs from you (before M7)
- A VPS (any $5 Linux box) and a domain or subdomain pointed at it.
