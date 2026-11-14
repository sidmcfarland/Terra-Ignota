# Terra Ignota — Plan

A co-op exploration MMO in an isometric 3D view. It runs as an installable web app (PWA): open a URL and you're in. Players' devices host the world. The only central piece is one ~$5/mo VPS that runs signaling, a TURN relay and an always-on seed peer.

How the game looks and sounds (theme, style, palette, mood, performance budgets and every art decision) is in [ART_DIRECTION.md](ART_DIRECTION.md).

## Core loop
The world is endless, generated from a seed, and starts out **unknown**. Explorers fog-reveal it together into a **shared atlas**. Players gather, build waystations and name places, and their discoveries persist for everyone.

The M5 design ([M5_DESIGN.md](M5_DESIGN.md), decided with Sid on 2026-11-12) fills this in:
- **Landmarks** placed by the seed (natural wonders, and wordless ruins and wrecks) are found, credited to their first finder and named. Each find hints at the next.
- **Gathering depletes for everyone and regrows.** A felled tree is a stump for every player until its time is up.
- **Building opens the world:** bridges cross deep water, steps cross snow and cliffs, trails are faster. **Waystations**, pooled by several players, are named places, spawn points and fast-travel stops.
- **Tending and relics.** A piece is safe while its owner keeps visiting. Left 30 days it weathers and anyone may dismantle it; left 60 it becomes a permanent relic that later explorers find.

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
- **World edits**: signed ops in layers (M5 slice 1). Each layer has a key, a merge rule and a scope:
  - **Merge rule:** *last wins* (Lamport clock, then public key, then signature) or *first wins* (the earliest signed date). Either way replicas converge without consensus, whatever order ops arrive in. A layer may **expire**: its ops are dropped everywhere once they are older than the layer's lifetime.
  - **Scope:** *zone* ops replicate to peers in the zone, to neighbouring hosts when near the border, and to the seed, by per-chunk digests. *World* ops (the atlas layers) go everywhere: every device holds them, hosts pass them to all neighbouring hosts, and the seed passes them to every host it is linked to. *Player* ops are held by their author's device, its current host and the seed only.
  - Painting tiles is the `tile` layer. Every later mechanic (charting, finds, names, harvests, builds) is another layer, not another message.
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
| M5 | Gameplay: shared atlas/fog, landmarks, gathering, building, tending and relics, naming, talk. Design: [M5_DESIGN.md](M5_DESIGN.md) | 3–5 people on a fresh world, at least one on a phone, play 45 minutes with no instructions and: chart 150+ squares, find and name 2+ landmarks, finish 1 waystation or bridge, and at least half ask to play again. Decay is checked apart, with the debug clock: jump a world 30 and 60 days and see pieces weather, get dismantled, become relics and get found | **Designed** 2026-11-12 (every decision confirmed by Sid). Built in 11 slices: slice 1 (layered ops, protocol 10) is built, with no visible change yet. See "M5: gameplay" |
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

## M5: gameplay (designed 2026-11-12)
The design is [M5_DESIGN.md](M5_DESIGN.md). Sid answered every question in it (its section 14) and confirmed the nine details it set without asking (section 15); the answers are also rows in "Decisions" below. It was written before M6 and M4c landed, so its protocol and tile numbers were corrected on 2026-11-13: slice 1 takes protocol 10, and `Bridge` and `Steps` take tile ids 19 and 20.

**One engine change carries everything:** lasting edits become layered ops (see "World & networking model"). Every mechanic is then a layer, with no consensus and no trusted server.

**How strong the protection is.** Nobody can forge another player's op. Ownership, decay, naming rights and inventory are checked by honest live hosts, the way reach and rate are today. That stops ordinary players and casual misuse. A modified client that feeds ops through catch-up, or a dishonest host, can get round them. Co-op accepted that bargain; hardening it is future work.

**Build order.** Each slice is playable and testable on its own; the done-when for each is in M5_DESIGN.md, section 11. Slices 1 to 4 are the first playable: explore, chart, point, discover, name.

| # | Slice | Status |
|---|---|---|
| 1 | Layered ops: the generic op, both merge rules, signed dates, expiry, three scopes, seed relay, `reject`, debug clock. No visible change | **Built** 2026-11-13, protocol 10, e2e-tested. See "Slice 1 as built" |
| 2 | Charting and the atlas | |
| 3 | Pointing: pings, emotes, quick phrases | |
| 4 | Landmarks: discovery, credit, naming, rumours | |
| 5 | Gathering, regrowth and the purse | |
| 6 | Building: bridges, steps, trails, signposts, cairns | |
| 7 | Waystations and Lookouts | |
| 8 | Tending and decay | |
| 9 | Relics and caches | |
| 10 | The arc: journal, session card, titles, text chat, mute | |
| 11 | Group playtest and decay check | |

### Slice 1 as built (2026-11-13, protocol 10)
Layered ops: the engine every later slice builds on. **Nothing a player sees has changed:** painting tiles (the B key) works as before, on the new format. Two things differ at the edges, both by design: an edit the host refuses now disappears from the painter's screen instead of staying there, and a device whose clock is wrong by more than a couple of minutes can no longer paint (see the findings). Worlds from protocol 9 are wiped: the signal server refuses older clients, browsers drop their stored edits (IndexedDB version 2 keeps the identity only), and the seed skips old lines in its files.

**The op.** `Op` in `packages/shared/src/edits.ts` is `{ l, x, y, v, clock, at, author, sig }`: a layer, a tile or a map square, a value (null removes), the Lamport clock, the author's clock in unix seconds, the author's key and the signature. It is signed over `ti-op:1|world|l|x|y|v|clock|at|author`, with `v` written as JSON whose record keys are in order, so every peer signs and hashes the same text. An op is JSON on the reliable channel, about 240 bytes for a painted tile (it was about 210).

**Layers** are rows of `LAYERS`: a key (a tile, a map square, or the author alone; some keep an entry per author), a merge rule, a scope, an optional lifetime, and a rule for its values. All twelve layers of the design are in the table with their key, merge rule and scope. A layer is **open** once it has a value rule; a closed layer's ops are refused by everyone. Open now:

| Layer | Key | Merge | Scope | Value | Used by |
|---|---|---|---|---|---|
| `tile` | tile | last wins | zone | Path, Wall or null | Painting (B key) |
| `take` | tile | last wins, expires after 2 hours | zone | `1` | Nothing yet (slice 5) |
| `chart` | map square | first wins | world | `1` | Nothing yet (slice 2) |
| `purse` | author | last wins | player | `{got, used}`, each a count of the five materials | Nothing yet (slice 5) |

`sign`, `found`, `name`, `way`, `give`, `cache`, `tend` and `who` are closed until their slices.

**Merging** (`opWins`) is a total order per key, so replicas agree whatever order ops arrive in.
- *Last wins:* the higher clock, then author, then signature, as before.
- *First wins:* the earlier `at`, then the lower author, then the lower signature.
- *Expiry:* an op older than its layer's lifetime is refused on arrival, invisible to every reader from that second, left out of digests, and swept from memory and storage (every 30 seconds in a session, every 10 minutes on the seed, which also rewrites a file that is mostly dead lines). Nothing is sent when an op expires.

**Scopes** decide where an op is kept and how it travels. Ops are filed in buckets, and catch-up compares one digest per bucket: `c:cx,cy` (a chunk's zone-scope ops), `z:zx,zy` (a zone's world-scope ops, its atlas) and `p:author` (a player's own ops).
- *Zone:* as before. Clients, the seed and neighbouring hosts within 168 tiles.
- *World:* a peer that connects lists its atlas digests with its chunk digests (`sync`), and the host pulls and pushes whole zones of it through the same paced catch-up. A host passes every new world-scope op to all its clients, all its seeds and all eight neighbouring hosts; the seed passes it to every other host it is linked to in that world. So two zones far apart converge through the seed, and without a seed through neighbours and travelling players.
- *Player:* a client lists its own bucket when it syncs, and the host exchanges it with that client only. The host passes a player's ops to the seeds and back to that player, never to another client or a neighbouring host. When a player joins, and when a seed links, the host asks the seed for the players it has; whichever copy is newer wins. A device only stores its own.

**The live host's checks, and `reject`.** A host accepts a client's live op only from its author, within the rate limit (10 a second), within reach (4 tiles for a tile; the map square the player stands in or one next to it; anywhere for an op with no place), and dated within 2 minutes of the host's clock. A refused op is answered with `reject`: its signature, which check failed, and what the host holds at that key. The client takes its op back, puts back what it had displaced, and merges what the host sent. This closes the old "a rejected edit stays in the painter's copy" limitation. Ops that arrive by catch-up can't be checked for reach or date, as before.

**Every peer's checks:** shape and value (`isWellFormed`), the signature, not expired, and not dated more than 5 minutes ahead of its own clock.

**The debug clock.** `#now=+45d` (also `-2h`, `+90m`, `+30s`) shifts the clock a browser dates and expires ops by; `NOW=+45d` does the same for the seed. A shifted browser's ops are refused by peers that aren't shifted with it, so a decay test gives every browser and the seed the same shift. The debug panel shows the shift.

**Budgets** (`limits.ts`), checked because ops got bigger and world-scope ops travel further:
- An `edits` message carries at most 100 ops (it was 200): at most about 50,000 characters against a 64,000 cap, since a value may be up to 256.
- A `sync` lists at most 1,024 atlas zones, the nearest first: about 30,000 characters.
- Catch-up answers stay inside a client's message budget because the host only asks for what its op budget holds: 41 messages at once, then 5 a second.
- A host takes unasked world-scope ops from a neighbouring host or a seed within the same op budget as catch-up (512 a second, burst 4,096). Their senders gather them for 250 ms, so a link carries about 4 `edits` messages a second however fast the world is charted, against a budget of 40.

**Where it departed from the design, and why.**
1. **In a layer that expires, the later `at` wins before the clock.** The design says `take` is last-wins by clock. With that rule a replica that held a high-clock harvest, let it expire, and then received a lower-clock but later harvest would keep the later one, while a replica that received them the other way round had already discarded it: the two disagree until the later one expires too. With the later date first, the op that stands is always the one that will expire last, so dropping an expired op can never bring back one it had beaten, and the any-order unit tests pass (they fail with clock first). Nothing uses `take` until slice 5, the wire format and the signature don't depend on it, and a harvest lives 2 hours, so this is cheap to change if Sid prefers the design's rule.
2. **Three layers are open with no mechanic behind them** (`take`, `chart`, `purse`), with the design's values. The design didn't say which layers slice 1 opens. They are open so that expiry, first-wins, world scope and player scope are each carried end to end by real ops and tested in browsers, not only in unit tests. A player with the console can write them; the host checks that belong to them come with slices 2 and 5. `take` lasts a flat 2 hours until slice 5 sets regrow times per source.
3. **`reject` is also sent when a live op simply loses the merge** (`why: 'lost'`), with what the host holds. It costs nothing and brings a client that had missed an op back in step.
4. **Reach for a map-square op** is the square the player is in or one next to it. That is the design's slice 2 rule for `chart`, used for every square-keyed layer.
5. **Hosts take a player's own ops only for players they host,** and ask the seed for them by player. The design only says who holds a purse. The seed answers any host for any player: a purse is signed, not secret.
6. **World-scope relays are batched** (250 ms) between hosts and from the seed, to fit M6's link budgets. The design didn't mention it.
7. **M6's distance rules now apply to zone-scope ops only.** A host and the seed still refuse zone-scope ops far from the sending host's zone. World-scope ops are taken from anywhere, which is the design's decision 3; the price is that one host can spread atlas ops world-wide, held only by the op budget.
8. **Message names stayed** `edit`, `edits`, `sync` and `syncWant`. `sync` now maps bucket ids to digests and `syncWant` carries `keys`. `reject` is the one new message.
9. **The seed can report a world** (`/health?world=<id>`, layer by layer, read from disk) and prints the port it really listens on. The restart test needs both.

**Against the done-when.**
- *`npm run typecheck` and `npm test` pass, with unit tests for both merge rules and expiry, in any order:* yes. 145 unit tests (119 before). The new ones merge every ordering of a set of ops for last-wins and first-wins, and for expiry every ordering, split at every point by time passing, swept or not.
- *The existing e2e suite passes on the new format:* yes. The 15 tests from before pass with only their accessors changed (the op store's method names, and the bucket id in one forged `sync`). `npm run e2e` was 19 tests at that point (20 with the spawn test added on 2026-11-14, below). It was run in full three times: 18 of 19, then 19 of 19 twice. The one failure was a check in a new test (the purse one) that raced the seed handing the purse back; the check was rewritten so it can't race, and the full suite passed both times after.
- *Two browsers in different zones converge on a world-scope op, and the seed keeps it across a restart:* yes, e2e. Two hosts three zones apart, with no link between them, converge on a charted square through the seeds, and agree on one winner when both sign for the same square at once. A seed started by the test holds both on disk, is stopped, and after a restart on the same directory reports both before any host exists; a newcomer in a fresh browser then gets them.
- Also e2e-tested: a refused edit is taken back and what it replaced stands again, in memory and in storage; a `take` expires on a browser whose clock is shifted 3 hours and is refused when offered again, and that browser's own edits are refused by its host; a purse reaches the host and the seed, never another client, and comes back from the seed to a device that lost it.

**Also checked, by hand** (one-off scripts, not in the suite):
- *Relay with no seed running.* Three hosts in a row of zones (A, B, C; A and C not neighbours): a charted square crossed one border link in 88 ms and two in 134 to 260 ms. A tile painted near a border reached the neighbour; one painted deep inside a zone did not; a purse never left its host. The suite can't show this, because its seed is always running and would deliver the op anyway.
- *The renderer.* With drawing on and chunks built in the worker, three edits made in one browser rebuilt the chunk in the other: the mesh was replaced two frames after the edit landed, as before this slice, and a painted path and wall show in screenshots.
- *Bots.* 24 bots over 2 zones for 25 s on protocol 10: stable, 254 edits made and 5,043 merged, no errors, nothing dropped by limits. An edit measured 229 bytes sent to a host and 241 passed on.

**Not verified.** The M6 measurements (100 bots and more) were not repeated on protocol 10. Nothing was run with more than a handful of atlas ops: the relay batching and the budgets above are reasoned, not measured under load. Nothing was checked on a phone or in a second browser engine. Two devices with clocks really set apart were not tried; the debug clock stands in for that.

**A join that failed after the merge (2026-11-14): players spawning on a zone border.** One e2e run on the merged tree failed in a test's setup: the second browser to join a new world was still a host 20 seconds later. It was not two hosts in one zone, and slice 1 did not cause it.
- **The cause.** A world's spawn can lie exactly on a zone border. `findSpawn` tries points every 16 tiles outward from the centre of zone 0,0, and a zone's edges are 128 tiles from its centre, so every point it tries 128 tiles out, and some on each ring beyond, is on a border. Each player is then set down up to 2 tiles from the spawn, and the client took its starting zone from where it landed. Two players on opposite sides of the line started in two zones, each hosting its own. They would still have seen each other across the border, and edits near it cross; but a test that expects the second to be the first's client fails, and so would any first meeting at such a spawn.
- **How often.** Of 300 worlds named as the tests name theirs, 1 spawned on a border (at 32.5, 0.5). In that world the two joiners split in 6 of 12 pairs on slice 1, and in 6 of 10 on the commit before it (`06a6d10`, protocol 9). A second such world turned up by chance on that older commit, in a run of 40 new worlds under load (1 of 40 failed, the same way). So, very roughly (one world in a sample of 300), one two-player test in 600 fails: a few per cent of full suite runs.
- **Joining itself is unchanged by slice 1.** With three cores kept busy, 40 pairs on new worlds: the second browser was a client 148 ms after its page was ready on slice 1 (40 of 40), 147 ms on the commit before (39 of 40, the one failure being the border world above).
- **The fix** is one line in `apps/client/src/main.ts`: a player starts in the zone of the spawn spot, not of the place they were set down around it. A zone already holds its players up to a chunk outside it. The world above then joined correctly in 12 of 12 pairs. A new e2e test sends two browsers to a spot on a border and pushes them to opposite sides; it failed 3 of 3 without the fix and passes with it.
- **Checked after the fix:** typecheck and the 145 unit tests pass. The full e2e suite with every test run twice (20 tests, so 40) passed 40 of 40, two times running, on ports 8817/8818/4193. Those runs can't show the fix on their own, since a border world is rare; the new test and the 12 pairs above do.
- **Not shown:** that the failed run was one of these worlds. Its world name was not kept, so this rests on the same symptom, the right frequency, and the failure reproducing on demand.
- **Left alone:** `findSpawn` still picks spawns on zone borders. Moving its search off the 16-tile lattice would move the spawn of existing worlds, and with the fix above the border no longer matters to who hosts whom.

**Findings (not built).**
- **A zone's atlas catches up 4,096 ops per link at most.** The host takes no more for one bucket than its op budget ever holds, and a peer sends a bucket whole. `chart` can't reach that (64 squares a zone). Layers with an entry per author (`tend`, `give`) could, and then the rest never arrives. They need the bucket split or paged before slices 7 and 8.
- **A peer lists 1,024 atlas zones when it syncs,** the nearest first, so the message fits. Beyond that a host pushes what the peer didn't list, needed or not. This is the same limit as "every device holds the whole atlas".
- **A device whose clock is more than 2 minutes out can't make live edits.** Each is refused (`why: 'clock'`) and taken back. That is the design's rule. Nothing tells the player yet; the UI slices should. A *host* whose clock runs more than 5 minutes fast keeps its own edits, but its clients and the seed refuse them as dated ahead, and they are not offered again until the next catch-up. Before this slice no edit depended on any clock.
- **Two hosts that link up don't compare atlases.** Only new ops cross a border link. With no seed, an atlas op made before a neighbouring zone had a host reaches it only with a player who walks there.
- **`take` regrow times per source need a way for the seed to know them.** The seed never reads terrain, and a lifetime is per layer today. If slice 5 puts the source in the op's value (wood, stone, pigment, copper, crystal), every peer can tell its lifetime from the op alone.
- **A player with no signalling server sweeps expired ops only at the next load.** They are hidden from every reader the moment they expire; only the storage lags.
- **"A huge clock wins forever" still holds for last-wins layers** (an M6 finding). Dates are now bounded (5 minutes ahead), clocks are not.
- **The M5 design's rules for the M4c tiles are still open** (step 1's findings): Steps on `Cliff`, Bridges on `Lake` and `River`, wood from conifer forest, landmark types for the new tiles. They belong to slices 4 to 6.

## Open questions (M4 and M5)
Live state belongs to the zone's host. Lasting edits live in per-chunk CRDTs, replicated to every peer that has seen the chunk and to the seed, and they converge without consensus. These parts aren't designed yet:
- **Catching up (answered in M4a):** when a client connects, it sends its host a digest per zone chunk (count, highest clock and a hash of its ops). The host sends the chunks where it differs and asks for the chunks where the client has edits, so both converge. A new host already holds its zone's edits: it was a client there.
- **Keeping the seed in sync (answered in M4b):** the signal server tells each seed every zone's host and every change. The seed dials each host over WebRTC (`seed` links), syncs with the same digests clients use, and gets every edit the host spreads after that.
- **Edits across zone borders (partly answered in M4a):** hosts pass edits to neighbouring hosts when the edit is within `BORDER_VIEW` of their zone. A player catches up on another zone's chunks only after moving into it.
- **Scarcity and inventory (answered by the M5 design):** a CRDT can't enforce rules that span the world ("only one player gets this ore", unique place names, inventory counts), so the design doesn't ask it to.
  - *Scarcity* is shared depletion: a harvest is a signed `take` op that everyone merges and that expires when the source regrows. Two players harvesting at the same moment both get the yield.
  - *Inventory* is a signed purse per player: running totals of everything gathered and spent, checked step by step by the live host.
  - *Group builds* are pooled: each player's deposits are their own running-total record, and every peer derives completion from the sum.
  - What the host checks, a modified client can get round between hosts. That is the bargain co-op already accepted (M5_DESIGN.md, section 1).

## Current limitations (what M2 left for later)
- **Players pop in at the edge of the screen when zoomed far out.** A host sends players within at most 128 tiles of a client. At the widest zoom on a large monitor the screen shows about 167 tiles, so players appear a little inside its corners. Across a zone border the same applies.
- **A crowd in one spot, and a zone bigger than its host can carry, are not handled.** See the M6 findings.
- **Limits protect hosts only.** Clients and the seed don't budget what a host sends them (the seed only refuses zone-scope edits far from that host's zone). A flooding peer is disconnected, not banned: it can reconnect, and a new peer id or key is free.
- **Failover still reconnects clients (M3 follow-up).** The host streams its state (tick and validated positions) to two backups at 5 Hz, and the first eligible backup succeeds it. A hung host is found when a client sees 1s without snapshots and the directory's probe gets no reply within 750ms (e2e-tested at about 1.9s). After a takeover, clients still open a new WebRTC link to the successor. Pre-connecting clients to the first backup would cut that out.
- **Backups don't change once chosen.** A backup keeps its place while it's present and eligible, so a newcomer with a better score doesn't replace it. This stops near-equal scores from reshuffling the order on every heartbeat.
- **Election approximations.** A host's ping is its average round trip to its clients, while everyone else's is to the signal server, so the numbers aren't strictly comparable. If nobody in a zone can host (all opted out, mobile or backgrounded), the best of them hosts anyway. The track record is self-reported and kept per device in localStorage.
- **The seed stores edits but doesn't host (M7).** The design has it host zones that have no eligible host. Today it's only a replica, so a zone of phones is still hosted by a phone.
- **The seed only syncs when a link opens.** It catches up with a zone (and exchanges the atlas) when it first links to that zone's host, then receives new edits live and passes world-scope ones on. An edit made while no seed was connected reaches the seed only when some host it links to holds that edit.
- **The seed's disk store is one append-only file per world** (`DATA_DIR/<world>.jsonl`). It's compacted on load when superseded lines dominate, and loaded whole per world.
- **Anyone can run a seed and receive every world's edits.** That's fine while edits are public co-op data. Restricting it would need seed credentials on the signal server.
- **Edit checks slow casual misuse but can't stop a determined griefer.** A host accepts a live edit only from its author, within 4 tiles of where it sees that player, at most 10 a second, and dated within 2 minutes of its own clock; it tells the client when it refuses one (`reject`). Catch-up is now pulled and paced by the host (M6): only chunks of its zone that it asked for, no more than the peer said it holds, within a budget. But catch-up edits can be older edits or another player's, so the host can't check reach on them: a client that reconnects can still deliver edits anywhere in the zone, at the catch-up budget's rate. Nothing bounds an edit's clock either. Real protection needs reputation (see Risks and the M6 findings).
- **Every device holds the whole world's atlas layers.** World-scope ops go to every peer and are loaded whole. That is fine for hundreds of zones (a fully charted zone is about 14 kB); a big world needs per-zone summaries. M6 did not address it.
- **A device whose clock is wrong can't edit.** A live op dated more than 2 minutes from its host's clock is refused and taken back, and nothing tells the player why yet.
- **Catch-up for a zone's atlas is capped** at 4,096 ops per link, and a peer lists at most 1,024 atlas zones when it syncs. See the findings under "Slice 1 as built".
- **Each device loads all its edits for a world at startup.** That's fine at today's sizes. Loading per chunk can wait until worlds grow.
- **Identity is per device, not per player.** The Ed25519 key lives in IndexedDB, so clearing site data or switching devices makes a new identity. `peerId` is still a random id per tab, used only for connections.
- **Only the unreliable channel is binary.** Reliable messages (edits, catch-up, announcements) are JSON. An edit is about 240 bytes, mostly its base64 key and signature, and in the swarm edits were the largest share of reliable traffic.
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
| A player starts in the zone of the spot players arrive at, not of where they were set down around it | The spawn search can still land on a zone border (its 16-tile steps reach one 128 tiles out). Players arriving together must start in one zone, with one host. A zone holds players up to a chunk outside it, so the 2 tiles of scatter don't matter. |
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
| M5: fog lifts for everyone, by 32×32 map square | A constant drip of small rewards and a map the group visibly made together. Fine 8×8 cells cost three times the data; personal fog would make the world look different to each player. |
| M5: charting and discovery are credited to whoever was first, by the author's signed date | "Who got there first" is the reward. Lamport clocks say nothing about which of two unsynced players was really first, so first-wins needs a wall clock. |
| M5: atlas data travels world-wide, through hosts and the seed | The atlas is one shared map. The cost is that every device holds it (see "Current limitations"). |
| M5: seed-placed landmarks, about 1.6 a zone | Charting alone has no peaks, and naming needs something worth naming. |
| M5: landmarks are natural wonders and also ruins and wrecks, wordless | Sid's choice over natural wonders only. Player-made relics are the ruins with real stories. |
| M5: rumours hint at the next landmark | There is always a next place to go, without an always-on compass. |
| M5: materials come from terrain tiles (wood, stone, pigment) and from rare seed-placed nodes | The land itself is the resource, and a vein is a place worth marking. |
| M5: two rare materials: copper for the waystation's lantern, crystal for the Lookout's lens | Each gives one big build a reason to travel. |
| M5: everything gathered depletes for everyone and regrows | The land shows where people have been, and thinned woods push gatherers further out. |
| M5: inventory is a signed ledger, kept as running totals per player | A full event log grows by about 250 bytes per harvest for ever; a local satchel can't be checked at all. |
| M5: the build list and costs as designed (M5_DESIGN.md, section 6) | Deep water, snow and cliffs are the world's real walls; bridges and steps change where everyone can go. |
| M5: trails and bridges are walked 25% faster | A route is worth building and worth keeping. |
| M5: only its builder may change a piece | Nobody can wreck what you built. |
| M5: a piece weathers after 30 untended days (anyone may dismantle it) and is a permanent relic after 60 | Sid's design: nothing abandoned clutters the map for ever unexamined, and what survives becomes the world's history. |
| M5: tending is the owner walking into the piece's map square | It is play, not a chore: making the rounds. |
| M5: everything degrades when weathered | Decay must be visible and matter, but never strand anyone: bridges and steps stay crossable. |
| M5: relics are finds, rank up with age, and caches mature | It gives abandonment a value, and a builder a legacy. |
| M5: waystations and Lookouts are pooled by several players | The session's group project. Per-player deposit records never conflict. |
| M5: fast travel from station to station, plus a return to the last one | Stations move the start line outward without making distance meaningless. |
| M5: the discoverer or founder names a place | Naming is the reward for finding or founding. |
| M5: names and signs are free text, with a per-player mute | Word lists would be safer and much duller. Relic text is permanent (see the design's weak spots). |
| M5: talk is pointing first (pings, emotes, quick phrases), text chat last | It works on a phone and across languages. |
| M5: friends in other zones show as a headcount per zone | The signal directory already knows who is where. Exact positions would need the seed to relay gameplay. |
| M5: existing test worlds are wiped at slice 1 | Decay needs a signed date on every piece; keeping old edits would need a permanent special case. |
| M5: journal, session card, zone stamps and titles are in M5 | They are the session's arc: what you did today and what you have built. |
| M5: the capsule becomes a code-built explorer figure | See ART_DIRECTION.md. |
| M5: sounds are synthesised in code; fonts are IM Fell English and Alegreya Sans | See ART_DIRECTION.md. |
| M5: the done-when is a group playtest with numbers, plus a debug-clock decay check | "Fun" needs something that can be counted, and 60 days can't be waited for. |
| In a layer that expires, the later signed date wins before the clock | The op that stands is then always the one that will expire last, so dropping an expired op can never bring back one it had beaten, and replicas agree whatever order ops and expiry come in. The design had the clock first. |
| A layer is closed until its slice gives it a value rule; `take`, `chart` and `purse` are open from slice 1 with no mechanic behind them | A closed layer is refused by everyone, so half-built mechanics can't leave ops in a world. The three open ones carry expiry, first-wins, world scope and player scope through real browsers and the seed before any gameplay depends on them. |
| Ops are filed in buckets (a chunk, a zone's atlas, a player) and every scope catches up through the same digests | One paced, host-pulled catch-up (M6's) serves all three scopes. A new layer needs no new message and no new wiring. |
| A refused live op is answered with what the host holds at that key | The client can then put itself right in one step, whether its op broke a rule or only lost the merge. |
| World-scope ops are gathered for 250 ms before a host or a seed passes them on to another host | They fan out to every host in the world. Sent one by one they would overrun the receiving host's message budget as soon as a world is being charted by a crowd. |
| A host takes a player's own ops only for players it hosts, and asks the seed for them by player | It keeps purses off every device that has no use for them without the seed having to know who is where. |
| M5: ownership and decay are checked by the live host, not inside the merge rule | The same strength as every other check. A merge-level rule would be stronger against modified clients and make the store much more complex. |

## Risks
- **Backgrounded tabs throttle timers**, so a hidden tab hands off hosting immediately.
- **TURN bandwidth**: game packets are small and relayed players are ~15% of the total, which fits a $5 plan's traffic quota.
- **Malicious host**: tolerable in co-op. Mitigate with signed ops, backups cross-checking snapshots, and reputation.
- **Directory server is a single point of failure for joining**, but not for active play. Mitigate later with a DHT.

## Needs from you (before M7)
- A VPS (any $5 Linux box) and a domain or subdomain pointed at it.
