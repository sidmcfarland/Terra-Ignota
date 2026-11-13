# Terra Ignota — Plan

A co-op exploration MMO in an isometric 3D view. It runs as an installable web app (PWA): open a URL and you're in. Players' devices host the world. The only central piece is one ~$5/mo VPS that runs signaling, a TURN relay and an always-on seed peer.

How the game looks and sounds (theme, style, palette, mood, performance budgets and every art decision) is in [ART_DIRECTION.md](ART_DIRECTION.md).

## Core loop
The world is endless, generated from a seed, and starts out **unknown**. Explorers fog-reveal it together into a **shared atlas**. Players gather, build waystations and name places, and their discoveries persist for everyone.

## Stack
| Concern | Choice |
|---|---|
| Language | TypeScript everywhere (shared sim runs in browser + Node) |
| Client | Vite + Three.js + vite-plugin-pwa. Where it is hosted is decided at M7 (not GitHub Pages) |
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
apps/bots         headless bot swarm for load tests
infra/            docker-compose: signal + coturn + seed
```

## World & networking model
- **Worldgen**: deterministic, from the world seed: layered climate and landform maps with curves over them (see "Natural terrain"). Each chunk is 32×32 tiles, and terrain is never sent over the network.
- **Zones**: 8×8 chunks each. Every zone has one **host peer**, and players in that zone connect to it in a star (not a full mesh). Hosts of adjacent zones link to each other so players can see across borders.
- **Host election**: deterministic, based on a score (desktop, foreground tab, uptime, RTT), with ties broken by public key. Mobile, battery-powered and backgrounded tabs are excluded. The seed peer hosts any zone that has no eligible host.
- **Host migration**: the host streams snapshots to two backup peers. If the host drops, the next backup takes over within about 2s.
- **Sim**: the host ticks at 20 Hz. Players control their own movement and the host sanity-checks it (speed and collision). Co-op play allows lenient checks.
- **Interest**: the host sends each client only the players within that client's view radius (48–128 tiles, whatever its screen shows), including players relayed from neighbouring zones. Positions travel in a compact binary encoding (see M6).
- **Limits**: a host holds every link to message-rate and size budgets, and paces catch-up itself (see M6).
- **World edits**: signed ops in a per-chunk CRDT (last-writer-wins per tile, ordered by Lamport clock + public key). They're replicated to peers in the zone and to the seed.
- **Discovery**: the signaling server keeps soft-state `world/zone → host` entries via heartbeats. It never sees gameplay. *Later:* replace it with a DHT or gossip.
- **Join URL**: `https://<host>/#w=<worldId>` (an optional `&at=x,y` invites someone to a spot).

## Milestones
| # | Deliverable | Done when | Status |
|---|---|---|---|
| M0 | Scaffold: workspaces, Vite PWA, CI, Pages deploy | Installable empty app live at a URL | Built, except the deploy. The Pages workflow was removed on 2026-11-13: Pages for a private repo needs a paid GitHub plan. Hosting is decided at M7. Run locally for now |
| M1 | Single-player: worldgen, chunk streaming, render, movement, camera | Walk an endless seeded world at 60fps | Done (3D isometric, Three.js) |
| M2 | Networking core: signal server, WebRTC peers, one zone, star host | Two browsers see each other move | Done (e2e-tested) |
| M3 | Zones: partitioning, election, border handoff, host migration | Kill the host tab; play continues | Done (e2e-tested): zone handoff, neighbouring-host links, score-based election, backups with state streaming. A hung host is replaced in about 2s |
| M4 | Persistence: signed ops, CRDT, IndexedDB, seed peer | Edits survive everyone logging off | Done (e2e-tested): identity, signed tile ops, per-chunk CRDT, replication, IndexedDB, catch-up between peers, and the seed peer keeping edits on disk |
| M4c | Natural terrain: layered climate and landform maps, then rivers and lakes by region simulation | One seed shows plains, ranges, cliffs, oceans, lakes and rivers that run downhill, identical on every device | **Built** 2026-11-12, protocol 9. Step 1: plains, ranges, cliffs, an ocean and six climates from layered maps. Step 2: rivers, streams and lakes at their own levels from a drainage simulation; every channel leads downhill to a lake or the sea, and regions agree at their edges. The same world hash in Node, Chromium and Bun (JavaScriptCore); **a run in Firefox or Safari is still owed**, and no phone was measured. See "Natural terrain" |
| M5 | Gameplay: shared atlas/fog, gathering, building, naming, chat | Fun for a group session | |
| M6 | Scale: bot swarm, interest management, rate limits, validation | 300 bots across zones stay stable | Built (protocol 7, e2e-tested), but the done-when is **not shown yet**: the one dev machine runs 100 bots across 4 zones stably and is out of CPU at 300. The measurements say the limit is the machine, not the design (see M6 results). Needs one run on bigger or several machines |
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

## M6: scale (built 2026-11-12, protocol 7)
**Binary hot path.** The unreliable channel (position reports, snapshots, probes, the border stream and backup state) is encoded by a small hand-written codec, `packages/shared/src/codec.ts`. Integers are varints. Positions are fixed point at 1/64 tile, sent as offsets from one origin per message. A host gives each player a short number and announces who it is once (`meet`), so a nearby player costs about 5 bytes in a snapshot, where JSON with a 12-character id cost about 33. The reliable channel (edits, catch-up, announcements) stays JSON.

**Per-viewer interest.** Each tick the host sends each client only the players within that client's view radius. The client asks for the radius its screen shows (`pos.view`), and the host holds it to 48–128 tiles; a player already in view stays in view 8 tiles further out, so one at the edge doesn't flicker. A client forgets a player its host has stopped sending after 500ms. Players relayed from neighbouring zones go through the same per-viewer cut, and so does the host's own view. The stream between two neighbouring hosts is still per zone (everyone within 168 tiles of the other zone): the sender can't know the other zone's viewers without the same stream coming back.

**Limits and validation on hosts.**
- Every link a host accepts (clients, neighbouring hosts, seeds) has a budget per channel: messages per second, a burst allowance and a size cap (`packages/shared/src/limits.ts`). Messages over budget are dropped unread. A peer that keeps overrunning (200 drops in a burst, or more than 20 a second for long) is disconnected; it can reconnect.
- Catch-up is pulled by the host. A peer sends its digests once per link; the host asks for at most 4 chunks at a time, only chunks of its own zone, takes no more edits per chunk than the peer said it holds, and spends an edit budget (512/s, burst 4,096) as it asks. Edits it didn't ask for are refused. Before this, any client could send `edits` at any time, anywhere, at any rate, and only the signature was checked.
- Edits from a neighbouring host must be within 168 tiles of the zone and fit a budget. The seed refuses edits far from the zone of the host that sent them.
- A host only accepts positions within its zone's margin (+16 tiles), and holds a joining client's claimed position to that.
- Edits a replica already has, or that would lose, are dropped before the signature check.

**Bot swarm.** `npm run bots` (`apps/bots`) runs headless players: each is a real `Session` (the client's code, over node-datachannel) driven by a walker that uses the shared `step()`, crosses zone borders, paints tiles and hosts when elected. It can split over processes (`--procs`), kill bots on a timer (`--churn`), and prints a summary with a verdict. "Stable" in that verdict means: at least 98% of bots connected on average and 95% in the worst second, a median of at least 19 snapshots a second per client and at least 15 for the slowest 5%, at most 5% of host ticks late, and nothing logged as an error. With `--churn`, the worst-second test gives way to: 95% of reconnects after a host change within 3s.

### M6 results (measured 2026-11-12)
One machine ran everything: the signal server, every bot and both ends of every link. It is a 2008 Core i7-930 (4 cores, 8 threads), Windows 10, Node 22. Runs lasted 30–45s after the last bot joined. Unless noted: 25 bots per zone, 1 in 5 able to host, 1 in 4 walking across borders, view radius 64, one edit per bot every 50s, hosts are bots.

| Run | Outcome | One snapshot | Snapshots per client | Bot host tick | All traffic | CPU |
|---|---|---|---|---|---|---|
| Protocol 6 (before), 100 bots, 4 zones | Not stable: 5.8% of ticks late, median 18 snapshots/s | 1,673 B | 28.9 kB/s | 9.2ms mean, 43ms worst | 3.30 MB/s | 3.8 cores |
| Protocol 7, 100 bots, 4 zones | **Stable**: 99.9% connected, median 20 snapshots/s (slowest 5%: 16), 2.1% late, 32 border crossings handed off in 183ms (median) | 37 B | 0.7 kB/s | 5.5ms mean, 37ms worst | 159 kB/s | 2.75 cores |
| Protocol 7, 100 bots, 4 zones, a bot killed every 4s (hosts and clients in turn) | Recovered every time: 79 reconnects after a host change, median 432ms, slowest 5% 493ms; 0.6% late; no errors | 40 B | 0.8 kB/s | 4.5ms mean, 19ms worst | 181 kB/s | 2.7 cores |
| Protocol 7, 150 bots, 6 zones | Borderline: everyone connected and no failovers, but 8.2% of ticks late and the slowest 5% of clients got 12 snapshots/s | 34 B | 0.6 kB/s | 5.4ms mean, 47ms worst | 227 kB/s | 4.0 cores |
| Protocol 7, 300 bots, 12 zones | **Not stable**: 76% connected, 60% of ticks late, 940 host changes, 272 links failed to open | 35 B | — | 6.7ms mean, 84ms worst | — | 7.2 of 8 threads |

A real browser as the host (one headless Chromium tab hosting one zone, bots as its clients, same machine):

| Clients | Host tick | Late ticks | Snapshots per client | Host's snapshot upload |
|---|---|---|---|---|
| 40 | 0.83ms mean, 7.9ms worst | 0% | 20/s | 34 kB/s |
| 80 | 2.2ms mean, 5.2ms worst | 0% | 20/s | 138 kB/s |
| 120 | 4.3ms mean, 27ms worst | 0% | 20/s | 286 kB/s |

**Against the done-when.** "300 bots across zones stay stable" was not reached on this machine. The largest stable run was 100 bots across 4 zones.

**What limited it: the machine.** A bot costs about 27ms of CPU per second, so 300 need about 8 cores and this machine has 4. A profile of a bot host shows where it goes: node-datachannel's native `send` takes about 0.16ms per message and dominates the tick, the rest of the WebRTC stack runs on its own threads, and the session's tick logic and the codec together are about 2% of CPU. A Chromium tab doing the same hosting job ticks about 8 times faster (0.83ms against 6.5ms for 40 clients). At 300 the starved hosts ticked late, clients reported them silent, the directory dropped them, and whole zones reconnected at once, which starved the machine further.

**Why the design should hold at 300 (expected, not measured).** Zones don't share load: a host talks to its own clients and at most 8 neighbouring hosts, so 300 bots over 12 zones puts the same work on each host as 100 over 4, which ran stable. One browser tab hosted 120 clients, five times a zone's share of 300, without a late tick. A client's downstream is under 1 kB/s. What the 300-bot run adds that the 100-bot run doesn't is signal-server load, and the server took 300 joins and their heartbeats, though it wasn't profiled on its own.

**To finish the done-when:** run `npm run bots -- --bots 300 --zones 12 --procs 8` on a machine with about 8 recent cores, or split the swarm over machines: the same `--world` and `--signal` on each, plus `--stun` if they aren't on one LAN. Bots from different runs join the same zones.

**Findings (not built).**
- **A crowd in one spot is still quadratic.** Interest management cuts traffic when players are spread out. If 120 players stand within view of each other, the host uploads about 120 × 119 × 5 B × 20/s = 1.4 MB/s. That needs a cap on players per snapshot (nearest first) or a lower rate for distant ones.
- **A zone still can't outgrow its host.** A browser tab hosted 120 clients here, well past the advertised cap (4 per core, 48 at most), so the cap is conservative. Past what a host can really carry there is still no relief: no zone splitting, no relaying.
- **Failover reconnects a whole zone at once.** After a takeover every client opens a new WebRTC link to the successor, and handshakes are the most expensive thing a peer does. On a shared, overloaded machine this turned into a storm. Real peers don't share a CPU, but the burst is real. Pre-connecting clients to the first backup (the M3 follow-up) removes it. The directory could also wait before dropping a second host of the same zone.
- **Reach can't be enforced on catch-up.** The host now decides when and where catch-up edits arrive and how many, but it can't tell an edit made offline last week from one made out of reach a second ago, so a client that reconnects can still deliver edits anywhere in the zone, up to the catch-up budget. A new identity is free, so per-key budgets wouldn't hold either. This needs reputation, or giving up edits made offline.
- **A huge clock wins forever.** Last-writer-wins takes any op with a higher clock, and nothing bounds the clock. An op at the largest safe integer can't be overwritten by anyone. The fix is a clock tied to time (a hybrid logical clock that hosts check against their own).
- **The signal server's budget caps how fast one host can take joiners.** A browser host was measured sending 3 signalling messages per joining client; the end-of-candidates one is no longer sent, which leaves 2 (more with STUN candidates). The budget is 50/s with a burst of 200 (the burst is new). That covers a zone of about 60–100 reconnecting at once. Beyond that, candidates need batching.
- **A Node peer is a slow host.** For the seed to host zones (M7), node-datachannel's `send` cost applies: a bot host spent 5.5ms a tick on 24 clients on this machine.
- **Node timers on Windows fire in steps of about 16ms**, so a 50ms interval ran at 16 Hz. Sessions now book each tick against an ideal timeline, which also keeps the rate under load in browsers.

## Natural terrain (built 2026-11-12, protocol 9)
**Why.** Before M4c, `tileAt` cut one elevation noise and one moisture noise at fixed thresholds, the same everywhere. Every hill was the same kind of hill, all water was one kind of water, and the land read as a blob. Sid wants terrain that looks like the natural world: rivers and streams shaped by gravity, steep mountains and sheer cliffs, wide plains with little relief, and oceans that are distinct from lakes and ponds.

**When.** Before the M5 build starts. M5's first slice wipes existing worlds anyway, and M5 then freezes where landmarks and resources go (`landmarkAt`, `nodeAt`), which sit on top of the terrain. Changing terrain after that moves everything players have found.

**Step 1: layered maps.** Still a pure function of `(seed, x, y)`, at about today's cost.
- Separate large-scale maps: how far inland (continents against ocean), how eroded (flat against rugged), ridges and valleys, temperature, rainfall.
- Height comes from curves over those maps, so plains, foothills and ranges are different places. A steep step in a curve makes a cliff.
- Ridged and warped noise, so mountains form chains with spurs.
- Ocean is defined by the continent map, not by elevation, so inland water is a lake by definition.
- Biomes come from temperature, rainfall and altitude together. The snow line moves with climate.
- Done when: one seed shows plains, ranges, cliffs, an ocean and separate lakes within a few thousand tiles; and a fixed sample of the world hashes to the same value in Node, Chromium and one other browser engine.

**Step 2: rivers, by simulating each region.** (The plan. What was built differs in one way, the third point: see "Step 2 as built".)
- The world is cut into large squares. For each, a coarse heightmap is built from the seed, water is routed downhill, basins fill into lakes with outlets, and the result is cached.
- Rivers are carved into the terrain, so valleys follow them. Streams join into rivers and reach a lake or the sea.
- Where rivers cross from one region to the next is fixed from the seed of the shared edge, so neighbouring regions agree without knowing each other.
- The precompute runs in a worker on the client, and in the seed and bots too.
- Done when: every river tile has a downhill path to a lake or the sea; rivers line up across region edges; a region's precompute fits a budget measured on the dev machine and recorded here; and the same cross-engine hash check passes.

**Constraints.**
- **Every device must compute exactly the same world.** The host checks movement against the same tiles. The generator uses only arithmetic that is exact everywhere (add, subtract, multiply, divide, square root, integer hashes), never `sin`, `pow` or similar, which can differ between engines. The cross-engine hash check is part of the done-when for that reason.
- `packages/shared` stays isomorphic.
- It changes every existing world. Worlds are wiped when it lands.
- It won't be true geology. Step 1 gives "reads as natural". Step 2 gets close to "looks like a real map". Full erosion at tile detail across an endless world isn't practical.

**What it changes elsewhere.**
- **Renderer:** sheer cliffs need vertical faces in the chunk mesh. New water kinds (river, lake, sea) and new biomes need colours and ground cover. This answers two of the visual foundation's findings: "worldgen has one climate" and "sea and lake are the same tile".
- **Movement:** today any tile that isn't deep water, snow or a wall is walkable, however steep. Cliffs and rivers need rules in `step()`.
- **M5 design:** bridges and steps already exist to cross deep water and snow, so rivers and cliffs give them more to do. Landmark and resource placement should be built on the new terrain.
- **Chunk building in a worker** (a visual foundation finding) was expected to become necessary. Step 1 turned out no slower than the old generator, and step 2 left chunk generation where it was (see the measurements below). What step 2 added is a worker for the drainage regions. The visual foundation has since moved chunk meshes to a worker of their own (milestone 8; see docs/ART_DIRECTION.md, "Chunk meshes off the main thread").

**Decided (2026-11-12).**
1. **Cliffs block.** Gentle and moderate slopes are walkable. Sheer cliff faces block like walls until a player builds Steps (from the M5 design). No slope-based slowing.
2. **Streams wade, rivers block.** A stream is crossed slowly, like shallow water today. A river is deep and blocks until someone builds a Bridge or finds a ford. No current that carries the player; that could come later.
3. **New ground, the core set.** Water: river, stream and lake, separate from sea. Land: cliff, plus four climate biomes: desert, tundra, marsh and conifer forest. Each needs its own look in the visual work.
4. **Region size is measured, then picked.** The build tries sizes from about 1,000 to 4,000 tiles across and picks the largest whose first compute stays within a budget suited to a phone. The choice and the numbers get recorded here.

### Step 1 as built (2026-11-12, protocol 8)
(Written when step 1 landed. Step 2 has since changed three things said here: lakes now stand at their own level, not at sea level; streams and rivers are generated; and the hash values below were step 1's. The current ones are under "Step 2 as built".)
The generator is `packages/shared/src/terrain.ts` (the maps and the height) and `worldgen.ts` (tiles, rules, spawn, the hash). To look at a world: `#map=1&w=<world>` in the client paints it top-down at 1 to 64 tiles per pixel (click to recentre, "Walk here" opens the game there).

**The maps.** Each is noise at its own size; the sizes are the width of one feature, in tiles.
| Map | Size | What it decides |
|---|---|---|
| Continent | 2,200, warped | Ocean against land. Water is sea where this map says so and nowhere else |
| Erosion | 1,300 | Plains, hill country or a mountain range |
| Ridges | 260 and 115, warped; 130 | Mountain chains, their spurs, and rolling ground |
| Valleys | 520 | Broad cuts through high ground: the passes |
| Terraces | 300 | Escarpments and mesas |
| Basins | 190 | Hollows that hold lakes |
| Temperature, rainfall | 2,600 and 1,700 | Climate. The middle of a continent is drier than its coasts |
| Fine noise | 72 down to 9 | Rough coasts, ragged terrace edges, ribs and gullies on mountains |

**Height** is a sum of curves over those maps: a beach and a slow rise inland; rolling ground that grows into hills as erosion falls; in mountain country a chain along every line where the ridge map crosses zero, with spurs that stand tall near the chain and die away from it, and low valleys between chains; terraces as a step about a tile and a half wide; a sea cliff on rugged coasts. Summits are squeezed to about 28 tiles tall.

**Cliffs.** A tile is a cliff when its four corners differ by more than 1.2 tiles of height. That happens at terrace steps, on the upper flanks of chains and on rugged coasts. A terrace comes and goes along its length, and where its map changes slowly the step spreads into a ramp, so an escarpment is a run of cliff with ways up, not a closed ring.

**Water.** Sea is the continent map. Lakes are basins in low country, at least a few tiles inland, more of them where it rains. Lake water never touches sea water (unit-tested). In step 1 every lake's surface is at sea level.

**Biomes** come from temperature (which falls with altitude), rainfall and altitude: snow, bare rock, tundra, conifer forest, grass, broadleaf forest, meadow, desert, marsh (the wet fringe of a lake basin) and sand (sea beaches only). The snow line sits at elevation 0.75 in a temperate place, lower where it is cold (never below 0.35) and is absent where it is hot.

**Tiles and rules.** New ids, appended: `Lake` 10, `Stream` 11, `River` 12, `Cliff` 13, `Desert` 14, `Tundra` 15, `Marsh` 16, `Conifer` 17, `LakeShallows` 18. `TILE_COUNT` is 19, so M5's `Bridge` and `Steps` take 19 and 20. (Step 2 took protocol 9, so **M5's first slice takes protocol 10**.)
- Block: deep sea, deep lake (`Lake`), `River`, `Cliff`, snow, walls.
- Wade (half speed): shallow sea, `LakeShallows`, `Stream`.
- Everything else walks at full speed, marsh included.
- `Stream` and `River` have their rules and colours but nothing generates them until step 2.
- Rules depend on the tile only. `step()` no longer uses `Math.hypot`.

**Determinism.** Only exact arithmetic decides a tile or a rule. The old noise built its 16 gradients with `Math.cos` and `Math.sin`, and `findSpawn` used them too; the gradients are now written out as literals and the spawn search walks square rings. A unit test fails if `noise.ts`, `terrain.ts`, `worldgen.ts`, `rng.ts` or `movement.ts` call any `Math` function outside the exact set. `terrainHash(seed)` hashes 12 whole chunks, 2,048 scattered tiles and the exact bits of 512 elevations; `node scripts/terrain-hash.ts` prints it.

| Engine | Hash of world `golden` | How it was run |
|---|---|---|
| Node 22 (V8) | 4034505386 | unit test, pinned |
| Chromium (Playwright 1.63, V8) | 4034505386 | e2e test `terrain.spec.ts`, also against a new world each run |
| Bun 1.3.6 (JavaScriptCore, the engine in Safari) | 4034505386 | `bun scripts/terrain-hash.ts`, by hand; `terra` and `vista` matched too |
| Firefox (SpiderMonkey), Safari itself | **owed** | Playwright's Firefox and WebKit aren't installed on the dev machine, and weren't downloaded |

**Against the done-when.** One seed shows plains, ranges, cliffs, an ocean and separate lakes within a few thousand tiles: yes, and a unit test checks that all 15 generated tile kinds occur within 3,000 tiles of the spawn. The same hash in Node, Chromium and one other *browser* engine: Node and Chromium yes; the third engine is JavaScriptCore under Bun, not a browser, so a run in Firefox or Safari is still owed.

**Measured** (the dev machine: Core i7-930, Windows 10, Node 22; old and new run back to back, median of 7 runs of 400 chunks, three repeats):
| | Before | After |
|---|---|---|
| `generateChunk`, 32×32 tiles | 1.35–1.67 ms | 1.14–1.28 ms |
| The renderer's height grid for a chunk (1,024 × `elevationAt`) | 0.86–1.03 ms | 0.67–0.76 ms |
| `findSpawn` | not measured | 40 new worlds in 36 ms |
| Overview, 1,400 × 900 tiles at 1 per pixel, headless Chromium | — | 4.6–4.8 s (about 3.7 µs a tile, with its shading sample) |

So chunk generation is no slower than before, and step 1 does not need a worker. The slow maps are computed on a lattice every 4 tiles (29 noise calls a point, 81 points a chunk) and interpolated; each tile corner then costs 4 noise calls. The lattice is cached per 32-tile block, at most 512 blocks, about 3.3 MB. If the generator does move to a worker later (step 2's region precompute will need one): it has no DOM or Node dependency and its only state is that cache, so a worker can import it as it is; each thread keeps its own cache, and the main thread still needs tiles synchronously for `step()`, so it would keep its own copy too. No phone was measured.

**Tile mix** (8 seeds, a 40,000-tile square each, sampled every 400 tiles): the sea is 35% of the world. Of the land: grass 24%, conifer forest 17%, tundra 15%, broadleaf forest 10%, desert 9%, meadow 8%, rock 5%, lakes 5% (deep 2.8%, shallows 1.9%), snow 3%, marsh 3%, sand 1.5%, cliff 0.6%. 6% of the land blocks movement (snow, deep lake, cliff).

**Checked.** `npm run typecheck`, `npm test` (67 tests) and `npm run e2e` (15 tests, repeated 3 times) pass. A swarm of 30 bots over 2 zones ran stable on the new terrain: 17 zone crossings, no position corrected by a host.

**Guessed, for Sid to judge.** Every size and threshold above was tuned by eye on two seeds (`terra`, `vista`) and a tally over eight: how much is ocean, how big a range is, how tall a cliff must be, where each biome starts. They are constants at the top of `terrain.ts` and in `classify` in `worldgen.ts`; changing any of them changes every world and the golden hash.

**Findings (not built).**
- **All lakes are at sea level.** A pure function can't know a mountain lake's surface height without filling its basin, which is step 2. When step 2 fills basins, lakes will sit at their own levels and the renderer, which draws all water at height 0, has to draw each lake at its own.
- **Shared height and render height differ slightly.** Rules use `heightOf` (30·u·√u), which is exact. The renderer draws 30·u^1.6 (`heightFromElevation`). They agree at the top and differ by up to about 20% on low ground, so a cliff tile is always steep on screen but the 1.2-tile threshold isn't exactly what is drawn. The renderer could take `heightOf` from shared and they would match; that is two lines in files the visual work owns.
- **Cliffs are slopes, not walls, on screen.** The chunk mesh is a heightfield, so a cliff is one steep tile-wide face in bare-earth colour. It reads as a cliff, but true vertical faces are visual work.
- **Nothing checks that land is connected.** About 6% of land blocks (snow, cliffs, deep lakes). Chains have valleys between them and terraces have ramps, but a spot can still be ringed by cliffs. `findSpawn` only guarantees 6 clear tiles around the spawn. M5's Steps are the designed way through.
- **M5's design was written for the old tiles.** Steps should also be buildable on `Cliff`, and Bridges on `Lake` and `River`. Wood comes from forest tiles: conifer forest needs the same. Landmark types "come from the generated tile", so the new tiles need landmark types or a fallback. The M5 design still says protocol 6 → 7.
- **Marsh walks at full speed.** Wading through it would be natural; it wasn't one of the four decisions, so it is left out.
- **The overview is slow at coarse scales on this machine** (about 15 s for a full window at 16 tiles per pixel): every pixel is a lattice point of its own there. It paints progressively.
- **Every world starts mild.** See the decision log: the origin of every world is low, temperate land.

### Step 2 as built (2026-11-12, protocol 9)
The drainage simulation is `packages/shared/src/hydro.ts`; `landAt` there is the ground with its water, and `tileAt`, `generateChunk` and `elevationAt` use it.

**How it works.** The broad shape of the land (step 1's ground without its fine noise and without terraces) is sampled on a grid of nodes 32 tiles apart. On that grid:
1. **Hollows fill.** From every node with no lower neighbour the water rises, lowest ground first, until it finds lower ground beyond or the sea. The highest ground it covered is the lake's level; what it covered before that is under the lake. A hollow shallower than 0.03 fills without showing as a lake.
2. **Wide basins get an outlet or stay inland lakes.** A flood is only followed 5 nodes (160 tiles) from its lowest point. A basin wider than that gets a shallow lake at its low point; then, from its node nearest the sea, a way out is looked for towards the sea, up to 16 nodes long, lowering whatever is in the way. If one is found the river cuts a gorge through the rim. If not, the basin keeps its water.
3. **Water flows** from each node to its lowest neighbour, and across a lake to its outlet.
4. **Rain adds up** along the flow (1 a node, 2 where it rains more), counted 20 nodes upstream. 18 makes a stream, 90 a river, and any channel that has flowed 20 nodes (640 tiles) is a river.

Then, tile by tile: a channel runs in smooth curves between the nodes' river points; its water only ever falls, and the ground is cut down to it (a valley, or a gorge through a hill or an escarpment) or raised to it (a low levee). Ground below a lake's level is under that lake.

**Regions agree with no edge data. This is where the build left the plan.** The plan fixed river crossings from a seed on each shared edge. That makes region edges into walls except at the crossings, so water runs along them and lakes pile up against them. Instead every rule above is *local*: what a node ends up as depends only on the land within a fixed distance (floods 5 nodes, outlets 16, rain 20). A region is then only a unit of work and of caching: it computes a window 88 nodes (2,816 tiles) wider on every side than what it keeps, and what it keeps is exactly what any other window would have computed. Two regions hold bit-identical values for the nodes they share. The price is that margin: a region's cost is mostly margin, whatever its size.

**Tiles and rules.** The rules did not change: `River` blocks, `Stream` wades.
- A stream is 1.7 to 2.5 tiles wide, a river 3.4 to 6.
- **Fords:** one river span in ten is wadeable (`Stream` tiles) along its middle, about 20 tiles of river.
- **Lakes** are `Lake` where the water is deeper than 0.16 (the same depth as deep sea), `LakeShallows` down to 0.03, and `Marsh` where it barely covers the ground (in a dry climate that ground is left as it is).
- Where a stream ends on open ground with no lake, it ends in a small pond, dug 20 tiles across.
- Lakes keep off a strip along the coast, so lake water still never touches sea water. A hollow below sea level that no flood reached is still a sea-level lake, as in step 1.
- Under the sea `elevationAt` is the sea bed, as before. Under a lake or in a channel it is the **water's surface**; `landAt` gives the depth (`Ground.lake`) and the channel (`Ground.channel`).

**The worker.** A region takes about a quarter of a second, too long for the middle of a frame.
- **Client:** `RegionLoader` (`apps/client/src/regions.ts`) has a worker compute every region within 640 tiles of the player, once a second, and the region the game starts in before the first frame. Tiles are still read synchronously: a region that is not ready is computed on the spot (`getRegion`), so nothing is ever provisional and `step()` and host checks always see the real world. That stall should only happen after a teleport.
- **Chunk meshes:** the renderer starts the same worker script a second time to build chunk meshes (`render/chunk-data.ts`). `RegionLoader.onRegion` hands it each region as it is computed, so it does not compute them again; one that has not arrived is computed on the spot, in that worker.
- **Bots:** no worker. Each process computes the region its zones are in once, at start-up, before it measures.
- **Seed:** nothing. The seed never reads terrain.

**Region size: measured, then picked** (decision 4). One region, median and worst of 12 (4 worlds × 3 regions), Node 22 on the dev machine:
| Region | Window computed | Median | Worst | Per million tiles kept |
|---|---|---|---|---|
| 1,024 tiles | 219 × 219 nodes | 168–189 ms | 232 ms | 160–181 ms |
| 2,048 tiles | 251 × 251 nodes | 175–183 ms | 234 ms | 42–44 ms |
| **3,072 tiles** | 283 × 283 nodes | 224–225 ms | 261 ms | 24 ms |
| 4,096 tiles | 315 × 315 nodes | 285–294 ms | 321–525 ms | 17–18 ms |

The margin dominates, so a small region costs nearly as much as a large one. The budget I set is 250 ms for a region on the dev machine: the stall if one is ever computed on the spot, and the wait before the first frame. 3,072 tiles is the largest inside it. The budget is a judgment, and **no phone was measured**: the assumption is that a three-year-old mid-range phone is about as fast per core as this 2008 desktop. A region kept in memory is about 230 kB, and 16 are held.

**Chunk generation** did not slow down: 1.15–1.19 ms a chunk for tiles and 0.77–0.79 ms for the renderer's height grid, with the region ready (step 1: 1.17 and 0.71 ms in the same run).

**Against the done-when.**
- *Every river tile has a downhill path to a lake or the sea:* yes. On the node grid a test follows every channel of three worlds, across regions, to the sea or a lake, never rising. In the tiles a test checks every channel tile has a wet neighbour no higher than itself; a wider run of the same check passed on 18,632 channel tiles in six worlds.
- *Rivers line up across region edges:* yes, by construction, and tested: neighbouring regions agree bit for bit on every node they share, and a region computed in a much wider window (6 regions, 17 nodes wider) is identical.
- *A region's precompute fits a measured budget:* 224 ms median against 250 ms, on the dev machine only.
- *The same cross-engine hash:* `terrainHash` now covers the ground at 1,024 scattered points, the full drainage of three regions, and up to 24 chunks in each chosen where there is water. World `golden` hashes to 178363682 in Node 22 (pinned unit test), in Chromium (e2e, with a new world each run as well) and in Bun 1.3.6 / JavaScriptCore (by hand; `terra` and `vista` matched too). **Firefox or Safari is still owed**, as in step 1.

**Checked.** `npm run typecheck`, `npm test` (74 tests) and `npm run e2e` (15 tests, repeated 3 times: 45 of 45) pass. A swarm of 30 bots over 2 zones ran stable on the terrain with rivers: 20 zone crossings, no position corrected by a host.

**What the water looks like in numbers.** Four worlds, a 12,000-tile square each, sampled every 100 tiles: the sea is 33% of the world. Of the land: grass 21%, conifer forest 16%, tundra 16%, broadleaf forest 11%, desert 7.5%, meadow 7%, rock 5%, marsh 4%, lake shallows 3.9%, snow 3%, deep lake 2.9%, sand 1.6%, cliff 0.6%, stream 0.6%, river 0.5%. 7% of the land blocks movement (it was 6% before rivers). A region holds about 440 spans of stream and 215 of river (a span is about 40 tiles). Followed downstream, 57% of spans reach the sea, 23% end in an inland lake and 20% in a pond.

**Guessed, for Sid to judge.** How much rain makes a stream or a river, how wide they are, how often a river has a ford (one span in ten), how deep a hollow must be to show as a lake, and the 250 ms budget. Lakes and marsh may be more plentiful than wanted; the knobs are `LAKE_MIN` in `hydro.ts` and the basin `brim` in `terrain.ts`. All are constants; changing any changes every world and the golden hash.

**Findings (not built).**
- **Rivers and lakes are flat colour in the 3D view.** The renderer draws one water surface, at sea level. A lake above sea level, a river and a stream are drawn as ground at the water's height in their placeholder colour. Step 1's sea-level lakes had real water; they now stand at their own level and lost it. Drawing water at each lake's and river's own height is visual work: `landAt` gives the surface and the depth at any point.
- **Many rivers end in inland lakes, not the sea.** Noise terrain is full of closed basins. An outlet is cut only when one is found within 512 tiles towards the sea. Longer cuts would send more rivers to the sea and cost a wider margin.
- **A river stops growing after 640 tiles.** Rain is only counted that far upstream, so there is no great river fed by a whole continent, and a long river can narrow a little where far headwaters drop out of the count. It never drops back below a river.
- **A lake is at most about 350 tiles across.** A wider basin gets a small lake at its low point instead.
- **Lake shores are a little blocky**, and where two lakes of different levels meet the water steps down. The lake's outline comes from nodes 32 tiles apart.
- **Rivers ignore terraces when choosing their way**, then cut through them: a river on a plateau runs in a canyon. Otherwise every low place ringed by an escarpment was a lake.
- **Nothing checks a player isn't hemmed in by rivers.** Rivers start as streams, which wade, and one span in ten is a ford, so there is normally a way round. `findSpawn` still only guarantees 6 clear tiles.
- **A region computed on the spot stalls the game for about a quarter of a second.** The worker makes that rare, not impossible. A host that is far from a client it is checking (it never is, within one zone) would hit it.
- **The overview needs a region for every 3,072 tiles square it shows**: about 20 s for a full window at 16 tiles per pixel here, and beyond 120 regions it paints without rivers and filled lakes.
- **M5's design:** Bridges now have rivers and lakes to cross, and fords are a thing to find. Its landmark and resource rules still need the new tiles (see step 1's findings).

## Open questions (M4 and M5)
Live state belongs to the zone's host. Lasting edits live in per-chunk CRDTs, replicated to every peer that has seen the chunk and to the seed, and they converge without consensus. These parts aren't designed yet:
- **Catching up (answered in M4a):** when a client connects, it sends its host a digest per zone chunk (count, highest clock and a hash of its ops). The host sends the chunks where it differs and asks for the chunks where the client has edits, so both converge. A new host already holds its zone's edits: it was a client there.
- **Keeping the seed in sync (answered in M4b):** the signal server tells each seed every zone's host and every change. The seed dials each host over WebRTC (`seed` links), syncs with the same digests clients use, and gets every edit the host spreads after that.
- **Edits across zone borders (partly answered in M4a):** hosts pass edits to neighbouring hosts when the edit is within `BORDER_VIEW` of their zone. A player catches up on another zone's chunks only after moving into it.
- **Scarcity and inventory:** a CRDT can't enforce rules that span the world ("only one player gets this ore", unique place names, inventory counts). Options: each player owns their inventory as signed state, or the host or seed arbitrates for each chunk.

## Current limitations (what M2 left for later)
- **Players pop in at the edge of the screen when zoomed far out.** A host sends players within at most 128 tiles of a client. At the widest zoom on a large monitor the screen shows about 167 tiles, so players appear a little inside its corners. Across a zone border the same applies.
- **A crowd in one spot, and a zone bigger than its host can carry, are not handled.** See the M6 findings.
- **Limits protect hosts only.** Clients and the seed don't budget what a host sends them (the seed only refuses edits far from that host's zone). A flooding peer is disconnected, not banned: it can reconnect, and a new peer id or key is free.
- **Failover still reconnects clients (M3 follow-up).** The host streams its state (tick and validated positions) to two backups at 5 Hz, and the first eligible backup succeeds it. A hung host is found when a client sees 1s without snapshots and the directory's probe gets no reply within 750ms (e2e-tested at about 1.9s). After a takeover, clients still open a new WebRTC link to the successor. Pre-connecting clients to the first backup would cut that out.
- **Backups don't change once chosen.** A backup keeps its place while it's present and eligible, so a newcomer with a better score doesn't replace it. This stops near-equal scores from reshuffling the order on every heartbeat.
- **Election approximations.** A host's ping is its average round trip to its clients, while everyone else's is to the signal server, so the numbers aren't strictly comparable. If nobody in a zone can host (all opted out, mobile or backgrounded), the best of them hosts anyway. The track record is self-reported and kept per device in localStorage.
- **The seed stores edits but doesn't host (M7).** The design has it host zones that have no eligible host. Today it's only a replica, so a zone of phones is still hosted by a phone.
- **The seed only syncs when a link opens.** It catches up with a zone when it first links to that zone's host, then receives new edits live. An edit made while no seed was connected reaches the seed only when some host it links to holds that edit.
- **The seed's disk store is one append-only file per world** (`DATA_DIR/<world>.jsonl`). It's compacted on load when superseded lines dominate, and loaded whole per world.
- **Anyone can run a seed and receive every world's edits.** That's fine while edits are public co-op data. Restricting it would need seed credentials on the signal server.
- **Edit checks slow casual misuse but can't stop a determined griefer.** A host accepts a live edit only from its author, within 4 tiles of where it sees that player, and at most 10 a second. Catch-up is now pulled and paced by the host (M6): only chunks of its zone that it asked for, no more than the peer said it holds, within a budget. But catch-up edits can be older edits or another player's, so the host can't check reach on them: a client that reconnects can still deliver edits anywhere in the zone, at the catch-up budget's rate. Nothing bounds an edit's clock either. Real protection needs reputation (see Risks and the M6 findings).
- **A rejected edit stays in the painter's own copy.** Nothing tells the client the host refused it, so the two disagree on that tile until it's edited again. The B key only paints adjacent tiles, so normal play doesn't hit this. The host should send rejections back.
- **Each device loads all its edits for a world at startup.** That's fine at today's sizes. Loading per chunk can wait until worlds grow.
- **Identity is per device, not per player.** The Ed25519 key lives in IndexedDB, so clearing site data or switching devices makes a new identity. `peerId` is still a random id per tab, used only for connections.
- **Only the unreliable channel is binary.** Reliable messages (edits, catch-up, announcements) are JSON. An edit is about 210 bytes, mostly its base64 key and signature, and in the swarm edits were the largest share of reliable traffic.
- **The 300-bot target is unproven.** See the M6 results: stable at 100 bots on the dev machine, which runs out of CPU before 300.
- **Nothing is deployed.** The game runs from a local build or dev server. A build served over HTTPS has no signal server unless it was built with `VITE_SIGNAL_URL` or the link carries `#signal=wss://…`. To play from a phone before M7, serve a local build over Tailscale HTTPS (the README's "Deploy" section has the steps).

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
| Art style: a low-poly diorama on a parchment map; unexplored land is blank parchment that inks in | It builds on the existing renderer, stays small for a PWA and makes the game's name the look. Details in ART_DIRECTION.md. |
| The visual foundation (lighting, shaders, biomes, time of day, weather) is built before M5; bulk assets wait for the M5 mechanics | The foundation doesn't depend on mechanics. Props, icons and sounds do. |
| A lake has two tiles, deep (`Lake`, blocks) and shallow (`LakeShallows`, waded), like the sea | Sid's rule is that deep water blocks and shallows wade. One lake tile would make every lake either a wall or a puddle. Reusing the sea's shallows tile would leave lake and sea the same tile at the shore, which is what the visual work asked to end. |
| A cliff is a tile whose corners differ by more than 1.2 tiles of height, decided in shared code from an exact height (`heightOf`) | It blocks exactly the tiles that are drawn sheer. The renderer's own height curve uses `pow`, which engines may round differently, so rules can't use it. |
| Snow never lies below a floor (elevation 0.35), however cold the climate | Snow blocks. Without the floor a cold region is one impassable ice cap. Cold lowlands are tundra, which can be walked. |
| Every world is mild at its origin (land, low, temperate) | Gradient noise is zero at the origin, so every slow map is near its middle there. It is kept on purpose: a new player starts on open ground, with coasts and ranges a few hundred tiles out. |
| The slow maps are computed every 4 tiles and interpolated; shaping happens per sample | It keeps chunk generation at the old cost. Thresholds, ridges and terrace steps are applied after interpolating, so cliff lines and crests stay sharp. |
| Replace threshold-on-noise terrain with layered maps, then region-simulated rivers, before M5 | Sid wants terrain that looks natural. M5 wipes worlds at its first slice and then freezes landmark and resource placement, so before M5 is the cheapest time. |
| Cliffs block, streams wade, rivers block | They turn terrain into routes and obstacles, and give the M5 Steps and Bridges a purpose inland. Slope slowing and river currents were left out to keep `step()` and the host's checks simple. |
| New terrain adds river, stream, lake, cliff, desert, tundra, marsh and conifer forest | Enough that climates feel different, while staying a set the visuals can do well. Cohesion over variety. |
| Regions agree because every drainage rule is local, not because of seeds on their shared edges | Edge seeds turn region edges into walls with gates: water runs along them. With local rules a region is only a cache, and two regions compute bit-identical values where they overlap. It costs a wide margin around every region. |
| Drainage nodes are 32 tiles apart and sample the land without its fine noise or terraces | Water follows the broad shape of the land. Sampled finer, every rib on a mountainside was a pit; with terraces in, every low place ringed by an escarpment was a lake. The tiles then cut each channel through whatever fine ground is in its way. |
| A basin too wide to flood gets a small lake and an outlet cut towards the sea, or stays an inland lake | Following a flood further costs margin on every region. Filling such a basin part-way gave huge shallow sheets at an arbitrary level. |
| Regions are 3,072 tiles across | Measured: the fixed margin dominates, so size barely changes the cost. It is the largest that computes within 250 ms on the dev machine (decision 4). |
| Tiles are never provisional: a region that isn't ready is computed on the spot | `step()` and host checks must see the real world. A worker gets regions ready ahead of the player, so the stall should only follow a teleport. |
| One river span in ten is a ford | Sid's rule lets a river be crossed at a ford. Without any, a river from the mountains to the sea cuts the land in two until M5's bridges. |
| Under a lake or in a channel, `elevationAt` is the water's surface | The renderer has one water surface, at sea level. Flat ground in a water colour reads as a lake; a dry pit in a water colour does not. `landAt` has the depth for when water is drawn properly. |
| Rivers come from simulating each large region, not from carved noise lines | Sid asked for rivers shaped by gravity. Noise lines are cheaper but don't truly flow downhill. |
| No GitHub Pages deploy; hosting is decided at M7 | Pages for a private repo needs a paid GitHub plan, which Sid doesn't have, and the workflow failed on every push to `main`. It was removed on 2026-11-13. The client is a static build, so any static host or the M7 server can carry it. |
| Bots are real `Session`s over node-datachannel, not a protocol re-implementation | They load-test the code players run (host tick, election, failover, catch-up), the way the seed reuses `Peer`. The cost: a bot is as heavy as a real peer, which caps how many one machine can run. |
| A hand-written binary codec for the unreliable channel only; reliable messages stay JSON | Snapshots and position reports are almost all the traffic. A varint codec is about 250 lines and needs no dependency. Reliable messages are rare, and JSON keeps them easy to read and change. |
| Positions are fixed point at 1/64 tile | Half a hundredth of a tile of error, below what's visible and inside what the e2e tests check, in 2 bytes per axis for anyone within 128 tiles of the message's origin. |
| Hosts refer to players by a short number, announced once per viewer (`meet`) | Sending the 12-character peer id with every position would triple a snapshot. Numbers are per host and never reused, so a stale one can't point at the wrong player. |
| A client asks for its view radius; the host holds it to 48–128 tiles | The screen shows from about 30 to 170 tiles depending on zoom and size. One fixed radius would either send most of a zone to everyone or make players pop in on screen. |
| A client drops a player after 500ms without positions, with no "left your view" message | Nothing to keep in step between host and client, and a lost packet can't leave a ghost behind. |
| The stream between neighbouring hosts stays per zone (168 tiles); the per-viewer cut is made by the receiving host | The sender would need to know where the other zone's viewers are, which is the same stream in reverse. It's one stream per pair of neighbours, so it doesn't grow with clients. |
| Over-budget messages are dropped unread; a peer that keeps flooding is disconnected, not banned | Dropping keeps honest peers with a burst working. Only cutting the link stops a flood's bandwidth. A ban would need an identity that isn't free to replace. |
| Catch-up is pulled by the host, a few chunks at a time, for its own zone only | It ends unsolicited pushes of edits and bounds the cost of verifying them. It can't enforce reach: an old edit and a new one look alike (see the M6 findings). |
| A host refuses positions outside its zone's margin, and edits far from its zone | A host is the authority for its zone only. It keeps the reach check meaningful and stops one host spreading edits world-wide. |
| Sessions book each tick against an ideal 20 Hz timeline | Timers that fire late (Node on Windows, busy tabs) then cost jitter instead of tick rate. After a long stall the timeline restarts, so ticks aren't replayed in a burst. |
| The signal server lets a socket save up 200 messages | A new host relays an answer and candidates for every client of its zone at once after a takeover. A flat 50/s would have cut that off at about 15 clients. |
| The e2e ports are configurable, and `E2E_REUSE=0` refuses a running server | Several checkouts and sessions test on one machine; reusing another checkout's server tests the wrong code. |

## Risks
- **Backgrounded tabs throttle timers**, so a hidden tab hands off hosting immediately.
- **TURN bandwidth**: game packets are small and relayed players are ~15% of the total, which fits a $5 plan's traffic quota.
- **Malicious host**: tolerable in co-op. Mitigate with signed ops, backups cross-checking snapshots, and reputation.
- **Directory server is a single point of failure for joining**, but not for active play. Mitigate later with a DHT.

## Needs from you (before M7)
- A VPS (any $5 Linux box) and a domain or subdomain pointed at it.
