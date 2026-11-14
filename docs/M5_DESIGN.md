# Terra Ignota — M5 gameplay design

**Status: decided with Sid on 2026-11-12.** Every answer is recorded in [section 14](#14-decisions). A few details were set without asking; they are listed in [section 15](#15-defaults-set-without-asking), and Sid confirmed them too. Architecture is in [PLAN.md](PLAN.md); the look is in [ART_DIRECTION.md](ART_DIRECTION.md). Numbers (radii, costs, times) are starting values to tune in play.

**Numbers corrected on 2026-11-13.** This design was written before M6 and M4c landed. M6 took protocol 7, M4c took protocols 8 and 9 and tile ids 10 to 18, so slice 1 moves `PROTOCOL_VERSION` from 9 to 10, and `Bridge` and `Steps` take tile ids 19 and 20. Nothing decided in sections 14 and 15 changed.

## 0. The loop in one screen

- **Walk into blank parchment.** Each 32×32 map square you enter inks in for everyone and goes on the shared atlas with your name and the date.
- **Find landmarks.** Natural wonders and old ruins, placed by the seed. The first explorer to reach one is credited and names it. Each find hints at the next.
- **Gather.** Wood, stone and pigment from the land; copper and crystal from rare veins. What you take is gone for everyone until it regrows.
- **Build to go further.** Bridges cross deep water, steps cross snow, trails are faster to walk. Signposts leave words.
- **Found waystations and Lookouts together.** Several players pour materials into one site.
- **Tend what you built, or let it go.** Nobody can destroy your pieces while you keep visiting them. Left 30 days they weather and anyone may dismantle them. Left 60 days they become relics: permanent ruins with a story, found by later explorers. Buried caches grow in value the longer they lie.
- **Talk by pointing.** Pings, emotes, quick phrases; text chat last.

A session's arc: travel to the frontier, chart, find and name something, finish one group build, tend what's yours on the way home, look at how the atlas grew.

## 1. One engine change everything else uses: layered ops

Today there is one kind of lasting edit: `TileOp`, last-writer-wins per tile. M5 generalises it once. Every mechanic below is then "a new layer", with no consensus and no trusted server.

```ts
interface Op {
  l: Layer;               // which layer
  x: number; y: number;   // tile, or chunk coordinates for 'chart' and 'tend'
  v: Value | null;        // layer-specific value; null removes
  clock: number;          // Lamport clock, as today
  at: number;             // author's wall clock, unix seconds (new)
  author: string; sig: string;
}
```

| Layer | Key | Value | Merge | Scope | Used for |
|---|---|---|---|---|---|
| `tile` | x, y | `Tile` or null | Last wins | Zone | Trail, Wall, Bridge, Steps |
| `sign` | x, y | `{k:'post'\|'cairn', text?}` | Last wins | Zone | Signposts, cairns |
| `take` | x, y | `1` | Last wins; **expires** | Zone | A tile or node was harvested, and when |
| `chart` | chunk x, y | `1` | **First wins** | World | A map square was charted, and by whom |
| `found` | x, y | `1` | **First wins** | World | A landmark or relic was discovered; a relic cache was dug up |
| `name` | x, y | text ≤ 32 | Last wins | World | Name of the landmark, waystation or Lookout at that tile |
| `way` | x, y | `{k:'station'\|'lookout', n}` | Last wins | World | A waystation or Lookout, or its building site |
| `give` | x, y, **author** | `{n, w, s, p, c, x}` running totals | Last wins per author | World | One player's contribution to a `way` |
| `cache` | x, y | `{text, w, s, p, c, x}` | Last wins | World | A buried cache: a note and materials |
| `tend` | chunk x, y, **author** | `{since}` | Last wins per author | World | The author visited this square (keeps their pieces there) |
| `who` | **author** | `{name, hue}` | Last wins per author | World | Display name for an author key |
| `purse` | **author** | `{got:{…}, used:{…}}` | Last wins per author | Player | A player's signed material totals |

- **Last wins** is today's rule (`opWins`: clock, then author, then signature).
- **First wins** keeps the op with the lowest `at`, ties broken by author then signature. It is still a CRDT (a minimum over a total order). It needs a wall clock because Lamport clocks say nothing about which of two unsynced players was really first.
- **Expires:** a `take` older than its regrow time is dropped everywhere and left out of digests, so harvesting never grows storage. *(As built in slice 1: in a layer that expires, the later `at` wins before the clock is compared, so that expiry and merging give the same result in any order. PLAN.md, "Slice 1 as built", lists this and the other places the build left this section.)*
- **Zone scope** syncs as today: per-chunk digests for the zone you are in.
- **World scope** ("atlas layers") syncs everywhere: `sync` gains a digest per zone of that zone's atlas ops; hosts pass new atlas ops to all neighbouring hosts; the seed passes them to every host it is linked to in that world. Without a seed, atlas data still travels with players and across linked hosts. `who` ops are kept with zone 0,0's.
- **Player scope:** held by the author's device, their current host and the seed. Not spread to other players.
- **Checks every peer makes at merge** (pure, so replicas agree): shape, signature, `at` not more than 5 minutes in the future, and rules that follow from the seed alone (a Bridge only on generated water; a `take` only on a harvestable tile or node; a landmark `found` only where the seed puts one).
- **Checks only the live host makes:** author is the sender, within reach, within a rate limit, `at` within 2 minutes of the host's clock, ownership and decay state (section 7), naming rights, and that the player's `purse` moves by the right amount.
- **A refused op is sent back** (`reject`), so the client undoes it. This closes the "rejected edit stays in the painter's copy" limitation in PLAN.md.
- **Existing test worlds are wiped.** One op format, signed as `ti-op:1|world|l|x|y|v|clock|at|author`.
- **Seed:** stores every layer in the same append-only file, drops expired `take`s when it compacts, relays atlas layers, keeps each player's latest `purse`.
- **`PROTOCOL_VERSION` 9 → 10.**
- **Debug clock:** a `#now=+45d` hash parameter shifts a device's clock, so decay and regrowth can be tested without waiting.

**How strong the protection is, for every mechanic.** Nobody can forge another player's op. A host can drop or delay ops (they still spread later through the author, the seed or the next host). Ownership, decay, naming rights and inventory are enforced by honest live hosts, the same way reach and rate are today: that stops ordinary players and casual misuse. A modified client that feeds ops through the catch-up path, or a dishonest host, can get round them: back-date `at` to take a first-finder credit, overwrite someone's piece, mint an "old" cache, inflate a purse. PLAN.md accepted that bargain for co-op. Hardening it (ownership inside the merge rule, reputation) is future work.

## 2. Shared atlas and fog of war

**What the player does.** Walks. A soft disc of land (about 10 tiles) is always inked around each explorer. Stepping into an uncharted square inks the whole square in, for everyone, for good, with a quill-scratch sound. The atlas (a full-screen parchment map, M key or the compass-rose button) shows every charted square, names, waystations, landmarks, relics and other explorers.

**Why it's fun.** A constant drip of small rewards (a square every ~5 seconds of walking), a map the group visibly made together, and "who got there first" credit.

**Decided:** shared reveal by map square; first-charter credit by signed date; atlas data travels world-wide; a headcount per zone for far-off friends. *Not chosen:* fine 8×8 cells (3× the data, a second merge rule); personal fog with a shared map screen (the world would look different to each player).

- **Fog is presentation only.** Terrain is a pure function of the seed, so any client can compute unexplored land.
- **Other explorers are always visible**, even over blank parchment.
- **A fresh world is one link away** (`#w=`), so a group that wants a blank map starts its own.

**Architecture**
- Live (host): nothing new. The sight disc is client-only.
- Lasting: `chart` ops. A client signs one when it has stood 2 tiles inside a square its replica shows as uncharted. A completed Lookout charts the 5×5 squares around it (section 6).
- Merge: first wins. Two players entering together both sign; one is credited everywhere.
- Host limits: a live `chart` only for the square the player is in or next to (or in range of a Lookout they just completed), 2 a second.
- Seed: stores and relays. About 220 bytes a square, so 25 fully charted zones is about 350 KB.
- **Known limit (M6):** every device holds the whole world's atlas layers. Fine for hundreds of zones; a big world needs per-zone summaries.
- Friends in other zones: the signal directory already knows who is in which zone. It sends each member a headcount per zone (`pop`), shown as a badge. Exact positions only for your zone and its neighbours, as today.

**Worldgen:** none.

**Rendering:** the visual foundation built "the known world as a circle" with an ink-in edge. M5 feeds that shader a mask (charted squares near the camera, plus the sight discs) instead of one circle. `render/atlas.ts` is restyled as ink-and-wash, drawn at 1 texel per tile.

## 3. Landmarks and discovery

Not in PLAN.md's M5 list. Added because charting alone has no peaks, and naming needs something worth naming.

**What the player does.** Spots something unusual, walks up to it (within 3 tiles), gets a stinger and a cartouche: "You found the Quiet Arch". They may rename it. It goes on everyone's atlas with their name and the date. Later visitors add it to their own journal.

**Decided:** seed-placed landmarks, about 1.6 a zone; natural wonders **and** ruins and wrecks; rumours as hints. *Not chosen:* no landmarks; an always-on compass; no hints.

| Biome | Natural (2 in 3) | Ancient (1 in 3) |
|---|---|---|
| Forest | Elder Tree | Overgrown Gate |
| Rock | Stone Arch; Ice Spire at the snow line | Ruined Tower |
| Meadow | Hot Spring | — |
| Sand | Whale Bones | Shipwreck |
| Grass | Great Boulder | Standing Stones |
| Shallow water | Sea Stack | — |

- **Ruins are wordless in M5:** no inscriptions or lore text. Player-made relics (section 7) are the world's ruins with real stories.
- **Default names** are generated like zone names ("The Quiet Arch").
- **Rumours.** Every discovered landmark, kept waystation and kept Lookout reveals a "?" on the atlas for each undiscovered landmark, relic waystation, relic Lookout and relic cache within 1.5 zones (the square it is in, not the exact spot). Computed on the client. There is always a next place to go.

**Architecture**
- Live (host): nothing.
- Lasting: `found` (first wins), `name` (last wins), both world scope.
- Every peer rejects a landmark `found` or `name` where the seed has no landmark.
- Seed: stores both.

**Worldgen — FLAGGED.** Adds `landmarkAt(seed, cellX, cellY)` in `packages/shared`: the world is cut into 128-tile cells; a hash gives each cell a 40% chance of one landmark at a jittered spot; the type comes from the generated tile there; cells whose spot is deep water or snow have none.
- It **does not touch `tileAt` or `elevationAt`.** No terrain or walkability changes. Landmarks don't block movement.
- It **adds landmarks to every world.**
- **Once shipped it is frozen.** Changing its constants moves every landmark and orphans every `found` and `name`. Tune it before slice 4 ships.

## 4. Gathering and resources

**What the player does.** Faces a source and holds the action button for 1.5 seconds: the tree comes down, chips fly, the satchel fills. That source is then empty **for everyone** until it regrows.

| Material | From | Yield | Regrows in | Looks like, while empty |
|---|---|---|---|---|
| **Wood** | Forest tile | 1 | 2 hours | A stump, then a sapling |
| **Stone** | Rock tile | 1 | 2 hours | A pale quarried scar |
| **Pigment** | Meadow tile | 1 | 1 hour | A picked patch, no flowers |
| **Copper** | Copper vein (seed-placed, about 1 a zone, in rock) | 3 | 24 hours | A dull, emptied seam |
| **Crystal** | Crystal cluster (seed-placed, about 1 per 2 zones, in forest clearings) | 2 | 24 hours | Broken stubs |

**Why it's fun.** The land shows where people have been: thinned woods near a busy waystation push gatherers further out. A copper vein is a place worth marking, and one vein-day is one waystation's lantern.

**Decided:** common materials from terrain tiles plus two rare ones from seed-placed nodes; everything depletes for everyone and regrows. *Not chosen:* tiles only; nodes only; nothing contested (private cooldowns).

**Architecture**
- Live (host): an `act` relay so others see and hear you gathering.
- Lasting, briefly: a `take` op per harvest (zone scope). A source is empty while `now − at` is less than its regrow time. Regrowth is derived from the date; no op fires. Expired `take`s are dropped, so storage stays bounded.
- Merge: last wins per tile. Two players harvesting the same source at the same moment both get the yield; one `take` survives. Harmless.
- Host limits: within reach, source not empty in the host's replica, 1 a second, and the player's `purse` rises by exactly the yield.
- Every peer checks a `take` sits on a generated forest, rock or meadow tile with no player tile on it, or on a node.
- Nodes show on the atlas once their square is charted (derived from the seed and `chart`).
- Seed: stores live `take`s, drops expired ones.
- **Rendering:** a harvest must toggle an instance (tree ↔ stump), not rebuild the chunk mesh. Visible chunks re-check regrowth about once a minute.

**Worldgen — FLAGGED.** Adds `nodeAt(seed, cellX, cellY)`, a second overlay with the same rules as `landmarkAt`: terrain untouched, appears in every world, frozen once shipped. A cell has a 25% chance of a copper vein on its nearest rock tile and a 12% chance of a crystal cluster on a grass tile inside forest.

## 5. Inventory: the signed purse

**What the player does.** Carries a satchel: up to 30 each of wood, stone and pigment, 10 each of copper and crystal, shown as a strip on the HUD.

**Decided:** a signed ledger kept as running totals. *Not chosen:* a local unverified satchel; a full per-event log (about 250 bytes per harvest forever); host-held counts. No giving or trading in M5: players pool at building sites.

- **The `purse`** is one signed record per player per world: total ever gathered and total ever spent, per material. What you carry is the difference.
- **Every change travels with its cause.** A harvest sends the `take` and the new purse together; a build sends the piece and the new purse. The host checks the totals moved by exactly the yield or the cost, and never below zero. Salvage and cache finds credit the purse the same way.
- **On connect** the client shows the host its purse. If the seed holds a newer one, the newer wins, so an old purse can't be replayed to spend twice.
- **Also gives:** lifetime totals for the journal and titles.

**Architecture**
- Lasting: `purse`, player scope (device, current host, seed).
- Merge: last wins per author.
- Cheating: see section 1. An honest host stops a wrong step; nothing stops a modified client inflating its own totals between hosts.
- **Limits:** the purse lives with the device's key, so clearing site data loses it. Two tabs on one device race each other; only one should play a world at a time.
- Seed: stores the latest purse per player and world.

## 6. Building, waystations and Lookouts

**What the player does.** Opens the build sheet, picks a piece, sees a ghost on the tile in front, confirms. One context button does gather / read / deposit / tend / dig / travel depending on what is in front of the player; one build button opens the sheet. Both are thumb-sized.

| Piece | Layer | Cost | Where | What it does |
|---|---|---|---|---|
| **Trail** | `tile` | Free | Land | Walk 25% faster. A "blaze trail" toggle lays it under you as you walk. |
| **Wall** | `tile` | 1 stone | Land | Blocks movement. |
| **Bridge** (new tile, id 19) | `tile` | 2 wood | Generated water or deep water | Walkable, at trail speed. Opens far shores and islands. |
| **Steps** (new tile, id 20) | `tile` | 2 stone | Generated snow | Walkable. Opens mountain passes. |
| **Signpost** | `sign` | 2 wood, 1 pigment | Land | Up to 60 characters, in the world and on the atlas. |
| **Cairn** | `sign` | 3 stone | Land | A wordless marker in your colour. |
| **Waystation** | `way` + `give` | 20 wood, 15 stone, 5 pigment, 3 copper, pooled | Land in a charted square, 64+ tiles from another | Named place, fast-travel stop, spawn point. |
| **Lookout** | `way` + `give` | 15 wood, 20 stone, 2 crystal, pooled | A rock tile, 64+ tiles from another | Charts the 5×5 squares around it when finished; reveals rumours. |
| **Cache** | `cache` | 2 wood, plus what you put in | Land | Buries a note and up to 10 materials. See section 7. |

**Why it's fun.** Deep water and snow are the world's real walls. A group that pools wood to bridge a strait has changed where everyone can go.

**Waystations and Lookouts (pooled)**
- **Founding:** anyone places a site for free (`way`). It shows stakes and a rope outline.
- **Pooling:** anyone deposits. Each player's deposits are their own `give` record (running totals), so two players depositing at once never conflict. The site is complete when the sum across players meets the cost. No "completed" op exists: every peer derives it.
- **A finished waystation is:** a named place on the atlas; a fast-travel stop; your spawn point next session (the last one you visited).
- **Plaque:** founder and contributors, straight from the signed records.
- **The Landing:** the world spawn is a waystation from the start and never decays.
- **Fast travel:** from a kept waystation to any other kept waystation on your atlas. From anywhere, "return to my last station" on a 60-second cooldown.
- A rebuilt site gets a new nonce `n`, so old deposits don't count twice.

**Who may change a piece.** Only its builder, while it is kept. Section 7 covers what happens when it isn't.

**Decided:** the list and costs above; trails and bridges 25% faster; pooled big builds; station-to-station travel plus return; builder-only edits. *Not chosen:* one builder pays all; travel from anywhere; no travel; anyone-can-edit.

**Architecture**
- Live (host): `travel {x,y}` (client → host). The host moves the player only if its replica has a kept, complete waystation there. `act` relay for build animations.
- Lasting: `tile`, `sign` (zone scope); `way`, `give`, `cache` (world scope).
- Merge: last wins per key; `give` last wins per author, then summed. Two players filling the last slot both succeed; the surplus is lost.
- Host checks: cost paid in the purse; the tile is empty or the sender owns it; terrain rule. Two players claiming one empty tile: the host takes the first and rejects the second.
- **`step()` change:** per-tile speed. Kept Trail and Bridge are 1.25×. The host's speed check must use the same rule.
- Seed: stores all of it; relays `way`, `give`, `cache`.

**Worldgen:** none. Bridge and Steps are player-made tile types the generator never produces.

## 7. Tending, decay and relics

Sid's design. The aim: nobody can wreck what you built, nothing abandoned clutters the map forever unexamined, and what survives abandonment becomes part of the world's history.

**The life of every built piece,** counted from when its owner last tended it:

| Days untended | State | Look | Who can do what |
|---|---|---|---|
| 0–30 | **Kept** | As built | Only its owner can change or remove it. |
| 30–60 | **Weathered** | Moss, sagging, missing planks, faded banner | Anyone may dismantle it and salvage half its cost. Its owner tending it makes it Kept again. It works worse (below). |
| 60+ | **Relic** | A ruin, grown into the land | Nobody can remove or change it, ever, its owner included. It can be discovered. |

- **Tending** is walking into the map square a piece is in. That refreshes all your pieces in that square. The client signs one small `tend` record per square, at most once a day.
- **Pooled builds** (waystation, Lookout) are tended by their founder or any contributor. Only the founder can rename or dismantle one while it is kept.
- **A relic stays a relic.** A `tend` record carries the date its unbroken run of visits began, so coming back after day 60 doesn't revive anything.
- **Nothing is stored for the state itself.** Every device derives it from signed dates and its own clock. No timer, no "it decayed" op.

**What weathering does** (decided: everything degrades):

| Piece | Weathered | Relic (permanent) |
|---|---|---|
| Trail | No speed bonus | An old road: no bonus, drawn faintly on the atlas |
| Bridge, Steps | Wading speed | The same. Still crossable: decay never strands anyone |
| Wall | Crumbles; can be walked through | Rubble, walkable |
| Signpost | Text faded but readable | A weathered post; readable |
| Cairn | Half fallen | A scatter of stones |
| Waystation | Lantern out: no fast travel, not a spawn point, no rumours | A ruined waystation |
| Lookout | No rumours | A ruined Lookout |
| Cache | Anyone who finds it may dig it up | Treasure (below) |

**What makes relics valuable** (decided: finds, ranks and caches):
- **They are discoveries.** The first explorer who isn't one of its builders to reach a relic is credited (`found`, first wins), exactly like a landmark. Relic waystations, Lookouts and caches send out rumours. Relic signposts and cairns are found by coming across them. Old roads, bridges and rubble aren't found piece by piece.
- **They rank up with age:** Old at 60 days, Ancient at 180, Fabled at 365. The atlas symbol and the stinger change with rank.
- **They tell their story.** The plaque shows what it was, its name, who built it and when, when it was last tended, who found it. All of it comes from signed records.
- **They are a builder's legacy.** The journal lists your relics by rank.

**Caches: the "bury it and let it mature" game**
- Bury a note (120 characters) and up to 10 materials. The materials leave your purse.
- A cache is **hidden**: not on the atlas (except its owner's), and visible in the world only within 4 tiles, as disturbed earth.
- **Kept:** only its owner can dig it up, and gets back what went in.
- **Weathered:** anyone who finds it can dig it up, for what went in.
- **Relic:** the contents are doubled at Old, tripled at Ancient, quadrupled at Fabled. The first finder takes them, **the owner included**, and is credited. The opened cache stays as a relic with its note and story.
- So an owner who wants the bonus must stay out of that square for 60 days and hope nobody finds it in days 30 to 60. Remote and well-hidden spots are worth more.

**Architecture**
- Lasting: `tend` (world scope, so far-off devices know which waystations still work); `found` for relic discoveries and cache openings.
- Merge: `tend` last wins per author. State is a pure function of the piece's `at`, its owners' `tend` records and `now`. Clocks a few minutes apart don't matter against 30 days.
- Host checks: a non-owner's op on a kept piece is refused; any op on a relic is refused; a dismantle of a weathered piece is allowed and credits half the cost; a cache payout matches the cache record and its age.
- Two finders at the same moment: one is credited everywhere; both may be paid. Harmless.
- **Movement now depends on time:** a weathered bridge is slower than a kept one. Client and host each use their own clock; the lenient speed check absorbs the instant they disagree.
- Seed: stores `tend`. Its append-only file keeps the full history.

**Known weak spots**
- **Permanent words.** A name or signpost left 60 days can never be removed by anyone. The only tool in M5 is the per-player mute.
- **Relics accumulate.** A relic holds its tile forever; nothing can be built there.
- **Back-dating.** See section 1: a modified client could mint an instant relic or an "old" cache.
- **The owner profits from their own cache.** Waiting multiplies materials. Accepted: resources regrow anyway, and the 30–60 day window is the risk.

**Worldgen:** none.

## 8. Naming places

**What the player does.** Types a name into a cartouche on discovering a landmark or founding a waystation or Lookout. It appears hand-lettered on everyone's atlas and floats over the place in the world.

| What | Who names it | Stored as |
|---|---|---|
| Landmark | Its discoverer. Until then, its generated name. | `name` at the landmark's tile |
| Waystation, Lookout | Its founder, while it is kept. | `name` at its tile |
| Relic | Nobody. It keeps the name it had. | — |
| Anything else | Anyone, with a signpost. | `sign` text |
| Zone | Nobody. Zones keep their generated names ("Amber Fen"). | — |

**Decided:** discoverer or founder names; free text (32 characters for names, 60 for signposts, 120 for cache notes) with a per-player mute. *Not chosen:* anyone can rename; word lists.

**Architecture**
- Lasting: `name` (last wins, world scope); `who` maps an author key to a display name and hue, so credits show names, not keys.
- A name shows only while its anchor (landmark or `way`) exists.
- Naming rights are a live-host check.
- **Mute** hides one author's names, signs, cache notes and chat on your device.
- Seed: stores `name` and `who`.

## 9. Talking: pings, emotes, quick phrases, chat

- **Ping:** tap the atlas or long-press the world. A vermilion ring pulses there for 8 seconds in the world, on the atlas and as an arrow at the screen edge.
- **Emote:** wave, point, cheer, sit. An icon bubble plus a small procedural motion.
- **Quick phrase:** eight preset lines from a wheel ("Over here!", "Look at this", "Need wood", "Need stone", "Follow me", "On my way", "Wait for me", "Thanks!").
- **Signposts, cairns and cache notes** are the messages that stay.
- **Text chat** (last slice): Enter on desktop; a speech bubble over the speaker and a short log.

**Decided:** pointing first, text chat last. *Not chosen:* text chat first; no free text.

**Architecture**
- Live (host), all ephemeral: `ping {x,y}`, `act {a}` (emotes, gather, build), `say {q}`, `chat {text}` (120 characters). Client → host → every client in the zone and, over the existing border links, the eight neighbouring zones.
- Limits: 1 ping per 2 s; 1 chat per second.
- Cheating host: can drop, alter or forge these (they are unsigned). Tolerable for ephemeral talk.
- Seed: nothing.
- **Limit:** talk reaches your zone and its neighbours, not the whole world.

## 10. Goals and pacing

| Timescale | What pulls the player on | Built from |
|---|---|---|
| Every few seconds | A new square inks in | `chart` |
| Every few minutes | A "?" rumour to chase; a landmark or relic found; a vein worth marking | Seed, `found`, `name` |
| Once a session | One group project: a bridge, a pass, a waystation, a Lookout | `tile`, `way`, `give` |
| Every few weeks | Make the rounds: tend what's yours, or decide to let it go | `tend` |
| Across months | Relics ripen and rank up; buried caches mature; the atlas fills with history | Dates on everything |

- **Why go further:** rumours point outward; water and snow are gates that materials open; thinned woods near home push gatherers out; new stations move the start line.
- **Why come back:** your pieces need you within 30 days, and the trails and stations that make the rounds quick are themselves things to tend.
- **Session card (local):** on leaving, "Today: 46 squares charted, 2 landmarks found, 1 waystation founded".
- **Journal (local view of signed records):** landmarks visited; **your works, with days until each weathers**; your relics by rank; lifetime materials.
- **Zone surveyed:** when all 64 squares of a zone are charted, the atlas stamps it with a compass rose and its name. Derived.
- **Titles:** Wanderer → Surveyor → Cartographer, from squares charted first. Derived from signed `chart` ops.
- **What persists:** every op layer, on the devices that hold it and on the seed. **What doesn't:** positions, pings, chat, and `take`s past regrowth. **Per device only:** journal visits, last station, mute list.

**M5 is done when** 3–5 people on a fresh world, at least one on a phone, play 45 minutes with no instructions and: chart 150+ squares, find and name 2+ landmarks, finish 1 waystation or bridge, and at least half ask to play again. Decay is checked separately with the debug clock: jump a world 30 and 60 days and see pieces weather, get dismantled, become relics and get found.

## 11. Build order

Each slice is playable and testable on its own. Slices 1–4 are the **first playable**: explore, chart, point, discover, name.

| # | Slice | Done when |
|---|---|---|
| 1 | **Layered ops.** Generic `Op`, both merge rules, `at`, expiry, the three scopes, seed relay, `reject`, debug clock, protocol 10, wiped worlds. No visible change. | Existing e2e passes on the new format. Unit tests cover both merge rules and expiry in any order. Two browsers in different zones converge on a world-scope op; the seed keeps it across a restart. |
| 2 | **Charting and the atlas.** Sight disc, `chart`, fog mask, atlas screen with squares, credits, players, zone headcounts. | Browser A walks; B sees the same squares ink in within a second, in the world and on the atlas. They survive everyone leaving. The atlas pans and zooms on a phone-sized viewport. |
| 3 | **Pointing.** Pings, emotes, quick phrases, `act` relay. | A ping from A shows in B's world and atlas, including from a neighbouring zone, and is rate-limited. |
| 4 | **Landmarks.** `landmarkAt`, 11 types, discovery, credit, naming, rumours, `who`. | Both browsers place the same landmark on the same tile. Two simultaneous finders agree on one credit. A name shows on both atlases and survives a reload. |
| 5 | **Gathering.** `take`, regrowth and expiry, `nodeAt`, the `purse`, satchel strip, explorer figure. | A fells a tree; B sees a stump; with the debug clock it regrows on both. A wrong purse step is rejected. The purse survives a reload and a host change. |
| 6 | **Building.** Build sheet, costs through the purse, Bridge, Steps, trail speed and blaze toggle, signposts, cairns, builder-only checks. | A bridges deep water; B walks across and the host accepts it. B cannot remove A's bridge. A refused build refunds. |
| 7 | **Waystations and Lookouts.** Sites, pooled `give`, derived completion, naming, plaque, fast travel, spawn at last station, Lookout charting. | A and B each deposit half; the station completes on both. A third browser in a far zone sees it on the atlas and travels to it. A finished Lookout charts 25 squares. |
| 8 | **Tending and decay.** `tend`, the three states, weathered behaviour and looks, dismantle and salvage, "your works" list. | With the debug clock at +31 days, A's bridge is weathered on both browsers, slower, and B can dismantle it for half. If A visits first, it is kept again. At +61 days nobody can touch it. |
| 9 | **Relics and caches.** Relic discovery, ranks, rumours, plaques; Cache build, dig-up and multipliers. | At +61 days B finds A's ruined waystation and is credited on both. A cache pays double at +61 days to the first finder only. |
| 10 | **The arc.** Journal, session card, zone-surveyed stamp, titles, text chat, mute. | Each shows correct numbers after a scripted two-browser session. A muted author's names, signs, notes and chat disappear locally. |
| 11 | **Group playtest and decay check.** | The done-when in section 10. |

## 12. Assets

Formats follow ART_DIRECTION.md: models are low-poly and code-built, instanced, on the shared ramp; icons, symbols and chrome are SVG; particles are generated; **all sounds are synthesised in code**. **Slice** is where each is first needed; **bold slices (2–4) are the first playable.**

**Models**
| Asset | Slice | Notes |
|---|---|---|
| Landmarks ×11: Elder Tree, Stone Arch, Ice Spire, Hot Spring, Whale Bones, Great Boulder, Sea Stack; Overgrown Gate, Ruined Tower, Shipwreck, Standing Stones | **4** | The showpieces; each readable from a distance. |
| Explorer figure | 5 | Hat, satchel, cloak in the player's hue. Procedural walk, gather and build leans. |
| Stump and sapling | 5 | Swapped per instance, not per chunk. |
| Copper vein, crystal cluster (full and emptied) | 5 | |
| Bridge segment, Steps segment, Signpost, Cairn, Wall | 6 | Cairn's top stone in the builder's hue. |
| Waystation: site (3 fill stages) and complete | 7 | Shelter, lantern, banner in the founder's hue. |
| Lookout: site and complete | 7 | A tall, thin silhouette on rock. |
| Ruined waystation, ruined Lookout | 9 | Distinct ruin models: these are the rare finds. |
| Cache: disturbed earth, opened chest | 9 | |

**Shaders and effects (code)**
| Asset | Slice | Notes |
|---|---|---|
| Fog mask: charted squares + sight discs feeding the ink-in edge | **2** | Extends the visual foundation's circle. |
| Square inking in (ripple from the player) | **2** | |
| Ping ring and screen-edge arrow | **3** | Vermilion. |
| Discovery burst | **4** | An ink bloom, not fireworks. |
| Gather particles: wood chips, stone chips, petals, ore glints | 5 | |
| Quarried scar and picked patch on rock and meadow tiles | 5 | Vertex colour, not geometry. |
| Build ghost (valid / invalid) | 6 | |
| Travel effect (ink swirl out and in) | 7 | |
| **Weathering:** one shared treatment for every piece (moss tint, sag, dropped parts, faded hue), driven by one 0–1 value | 8 | Avoids a second model per piece. Trail overgrowth, wall rubble and the fallen cairn use it too. |
| Lantern lit / out | 8 | Reads at a glance whether a station works. |
| Tend glint, dismantle puff | 8 | |
| Dig-up, relic discovery (by rank) | 9 | |

**Atlas symbols (SVG, ink style)**
| Asset | Slice |
|---|---|
| Explorer marker (hue), zone headcount badge | **2** |
| Ping mark | **3** |
| Landmark symbols ×11, rumour "?" | **4** |
| Copper vein, crystal cluster | 5 |
| Trail, bridge and steps line styles; signpost; cairn | 6 |
| Waystation (site, complete), The Landing, Lookout | 7 |
| Weathered variants (lantern out); old-road line style | 8 |
| Relic symbols: waystation, Lookout, signpost, cairn, cache; rank marks ×3; own-cache mark | 9 |
| Zone-surveyed compass rose and cartouche | 10 |

**UI icons (SVG)**
| Asset | Slice |
|---|---|
| Atlas button (compass rose), close, confirm, cancel | **2** |
| Ping, emote ×4 (wave, point, cheer, sit), phrase wheel | **3** |
| Materials ×5: wood, stone, pigment, copper, crystal | 5 |
| Context action: gather, read, deposit, travel, dismantle, dig | 5–9 |
| Build pieces ×9: trail, wall, bridge, steps, signpost, cairn, waystation, Lookout, cache; blaze-trail toggle | 6–9 |
| Journal, mute, chat | 10 |

**UI chrome (SVG / CSS)**
| Asset | Slice |
|---|---|
| Atlas screen: parchment sheet, border, graticule, credit tooltip | **2** |
| Toast, speech and emote bubble | **3** |
| Discovery and naming cartouche; world name labels | **4** |
| Satchel strip | 5 |
| Build sheet, signpost text entry | 6 |
| Waystation and Lookout panel: progress, deposit, plaque, travel list | 7 |
| "Your works" list with days left; weathering warning | 8 |
| Relic story plaque; cache note and contents picker | 9 |
| Journal, session card, chat log | 10 |

**Fonts**
| Asset | Slice |
|---|---|
| IM Fell English (place names, cartouches) | **2** |
| Alegreya Sans (interface) | **2** |

Both believed to be under the SIL Open Font License; confirm at download.

**Sounds (synthesised)**
| Asset | Slice |
|---|---|
| Square inks in (quill scratch), atlas open and close (paper) | **2** |
| Ping chime, emote blips, UI tap | **3** |
| Discovery stinger, naming flourish, rumour revealed | **4** |
| Gather wood, stone, petals, ore, crystal; pickup; "nothing left here" | 5 |
| Place piece, bridge plank, refused | 6 |
| Deposit, waystation complete, Lookout complete, travel | 7 |
| Tended, weathering warning, dismantle and salvage | 8 |
| Relic found (3 ranks), dig, cache opened | 9 |
| Chat tick, zone surveyed, title earned | 10 |

Footsteps, ambience and music belong to the visual and audio foundation, not this list.

## 13. Changes to make elsewhere

When this design was written, other sessions were editing these files, so the changes were listed here to make later.

**Status (2026-11-13):** made with slice 1, adjusted to what M6 and M4c had changed by then. Items that describe something a later slice builds were held back for that slice: in PLAN.md's "Current limitations", everything except the rejected-edit and whole-atlas items, and the signal server's headcount per zone; in CLAUDE.md, the `landmarkAt` and `nodeAt`, per-tile speed and decay conventions. PLAN.md has no list of URL hash parameters, so `now` is in CLAUDE.md's.

**docs/PLAN.md**
- Core loop: add landmarks, depletion and regrowth, tending and relics; waystations are spawn and fast-travel points.
- World & networking: edits become layered ops with two merge rules, expiry and three scopes; the seed relays atlas layers and keeps purses; the signal server also sends a headcount per zone.
- "Open questions": scarcity and inventory are answered (shared depletion by expiring signed `take`s; a signed running-total purse checked by the live host; pooled per-author counters for group builds).
- "Current limitations": remove the rejected-edit item after slice 1. Add: every device holds the whole world's atlas layers (M6); talk reaches only neighbouring zones; ownership, decay and the purse are live-host checks; free text has only a local mute and relic text is permanent; movement depends on each device's clock at decay boundaries; one tab per device per world.
- Decisions table: one row per answer in section 14.
- M5 row: link here; use the done-when from section 10.
- URL hash parameters: add `now`.

**docs/ART_DIRECTION.md**
- Theme: ruins and wrecks are now in the world, wordless; player-made relics are its history. Reword "somewhere nobody has been" if it should stay true.
- "Open questions": remove the M5-mechanics item; audio is synthesised in code; fonts are IM Fell English and Alegreya Sans.
- Asset list: point to section 12 here as the production list.
- Visual foundation backlog: the known-world circle becomes a mask of charted squares plus sight discs (this answers the "trail of explored land" item); trees must be swappable per instance for stumps; one shared weathering treatment is needed for built pieces.
- Technical constraints: `landmarkAt` and `nodeAt` are frozen once shipped.

**CLAUDE.md**
- Conventions: "a new kind of lasting state is a new op layer, not a new message"; "`landmarkAt` and `nodeAt` are frozen like `tileAt`"; "per-tile speed lives in `step()` and depends on decay state; the host check must use it"; "decay and regrowth are derived from dates, never stored".
- URL hash parameters: `now=+45d`.

**Code (for the build sessions, not this one)**
- `packages/shared`: `edits.ts` → layered `Op` store with expiry; new decay module (state from `at`, `tend`, `now`); `protocol.ts` → messages in sections 1, 6 and 9, version 10 at slice 1; `worldgen.ts` → `Tile.Bridge` (19), `Tile.Steps` (20), `landmarkAt`, `nodeAt`; `movement.ts` → per-tile, state-aware speed.
- **M6 is merged** (it was in progress when this was written). M5's messages and host checks build on what it settled: the binary codec for the unreliable channel, per-link budgets (`limits.ts`) and catch-up pulled by the host. Reliable messages, ops included, stay JSON.

## 14. Decisions

All answered by Sid on 2026-11-12.

| # | Question | Recommended | Or | Decided |
|---|---|---|---|---|
| 1 | How does fog lift? | Shared, by 32×32 map square | Fine 8×8 cells / personal fog with a shared atlas screen | **Shared, by map square** |
| 2 | Credit for charting and discovery? | First wins, by the author's signed date | No credit | **First wins, by signed date** |
| 3 | How far does atlas data travel? | World-wide, via hosts and the seed | Only zones you have visited | **World-wide** |
| 4 | Add seed-placed landmarks? | Yes, about 1.6 a zone | No landmarks | **Yes, about 1.6 a zone** |
| 5 | Landmark theme? | Natural wonders only | Also ruins and wrecks | **Also ruins and wrecks** |
| 6 | Hints to the next landmark? | Rumours revealed by finds and waystations | Always-on compass / none | **Rumours** |
| 7 | What is gathered, from where? | Wood, stone, pigment from terrain tiles | Seed-placed nodes / both | **Both** |
| 7b | Which rare materials, and for what? | One: copper, for waystations | Two: copper and crystal, crystal for a Lookout / optional extras only | **Two: copper (waystation lantern) and crystal (Lookout lens).** The Lookout is in M5. |
| 8 | Scarcity? | None: private cooldowns | Rare nodes shared / everything depletes and regrows | **Everything depletes for everyone and regrows** |
| 9 | Inventory? | Local satchel, unverified | Signed ledger / host-held / add giving | **Signed ledger** |
| 9b | Which form of ledger? | Signed running totals per player | Full event log / local satchel | **Signed running totals** |
| 10 | Approve the build list and costs? | Yes | Drop the Wall / cheaper big builds | **Approved as listed** (section 6) |
| 11 | Trails and bridges 25% faster? | Yes | No | **Yes** |
| 12 | Who may change others' builds? | Anyone; last edit wins | Builder only / builder for big pieces | **Builder only** |
| 12b | What happens to builds whose owner is gone? | — | — | **Sid's design:** nobody can destroy another player's kept piece; pieces weather after 30 untended days (anyone may dismantle) and become permanent, valuable relics after 60. |
| 12c | What counts as tending? | Owner walks into the same map square | Owner plays in that world / touches each piece | **Owner walks nearby** |
| 12d | Does a weathered piece work less well? | Big pieces stop working; routes keep working | Looks only / everything degrades | **Everything degrades** |
| 12e | What makes a relic valuable? | Finds, age ranks, buried Caches; owner may dig up their own | No Cache / Caches for others only | **Finds, ranks and buried Caches** |
| 13 | How are waystations and Lookouts built? | Pooled by several players | One builder pays all | **Pooled** |
| 14 | Fast travel? | Station to station, plus return to last station | Anywhere to any / none | **Station to station, plus return** |
| 15 | Who names things? | Discoverer or founder | Anyone can rename | **Discoverer or founder** |
| 16 | Name input? | Free text with per-player mute | Word lists / lists for signs only | **Free text with a mute** |
| 17 | Talking, in what order? | Pointing first; text chat last | Text chat first / no free text | **Pointing first, text chat last** |
| 18 | Friends in other zones on the atlas? | Headcount per zone from the signal directory | Nothing / exact positions via the seed | **Headcount per zone** |
| 19 | Existing test edits? | Wipe (decay needs a signed date on every piece) | Keep, with a permanent special case | **Wipe test worlds** |
| 20 | Journal, session card, zone stamps, titles in M5? | Yes | "Your works" only / none | **Yes, all in M5** |
| 21 | Replace the capsule with an explorer figure? | Yes, code-built, procedural motion | Keep capsules / CC0 pack | **Yes, code-built** |
| 22 | Where do M5 sounds come from? | Synthesised in code | Mix in CC0 packs | **Synthesised in code** |
| 23 | Fonts? | IM Fell English + Alegreya Sans | Display face only / others | **IM Fell English + Alegreya Sans** |
| 24 | Accept the M5 done-when? | Yes, plus a debug-clock decay check | Add a 60-day real world / no numbers | **Accepted** |

## 15. Defaults set without asking

Details the answers above didn't settle. **Sid confirmed all nine on 2026-11-12.**

1. **Ownership and decay are enforced by the live host, not inside the merge rule.** Same strength as every other check today. A merge-level ownership rule would be stronger against modified clients, at the cost of a much more complex store.
2. **Relics are permanent, even for their owner,** and a visit after day 60 doesn't revive one.
3. **Decay never strands anyone:** weathered and relic bridges and steps stay crossable, at wading speed.
4. **Dismantling returns half the cost,** to whoever does it, owner included.
5. **Four ancient landmark types** (Overgrown Gate, Ruined Tower, Shipwreck, Standing Stones), one in three landmarks, with no inscriptions or lore.
6. **Yields and regrowth:** 1 per tile, 3 copper per vein, 2 crystal per cluster; 1–2 hours for tiles, 24 hours for nodes.
7. **Cache:** 2 wood, up to 10 materials, a 120-character note; ×2, ×3, ×4 by relic rank.
8. **Lookout:** rock tiles only, charts 5×5 squares, not a fast-travel stop.
9. **Relic ranks** at 60, 180 and 365 days.

## Stretch (not M5)

- Giving items between players; a shared store at waystations.
- Exact positions of friends world-wide; world-wide chat.
- A guest book at each waystation; sharing the atlas as an image.
- Ownership inside the merge rule; reputation; real moderation for names and signs.
- Lore and inscriptions for the seeded ruins.
- Repairing a relic into a new, kept piece.
