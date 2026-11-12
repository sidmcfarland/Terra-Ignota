# Terra Ignota — M5 gameplay design

**Status: draft, waiting for Sid's decisions (2026-11-12).** Every choice below is a recommendation until it is recorded in [section 12](#12-decisions-for-sid). Architecture is in [PLAN.md](PLAN.md); the look is in [ART_DIRECTION.md](ART_DIRECTION.md). Numbers (radii, costs, cooldowns) are starting values to tune in play.

## 0. The loop in one screen

- **Walk into blank parchment.** Each 32×32 map square you enter inks in for everyone and goes on the shared atlas with your name and the date.
- **Find landmarks.** Rare natural wonders, placed by the seed. The first explorer to reach one is credited and gets to name it. Each find hints at the next.
- **Gather as you go.** Wood from forest, stone from rock, pigment from meadow flowers. Nothing is contested: every player can harvest every tile.
- **Build to go further.** Bridges cross deep water, steps cross snow, trails speed the way back. Signposts leave words.
- **Found waystations together.** Several players pour materials into one site. A finished waystation is a named place on the atlas, a spawn point and a fast-travel stop.
- **Talk by pointing.** Pings on the world and the atlas, emotes, quick phrases; text chat last.

A session's arc: travel to the frontier, chart, find and name something, finish one group build, look at how the atlas grew.

## 1. One engine change everything else uses: layered ops

Today there is one kind of lasting edit: `TileOp`, last-writer-wins per tile. M5 needs a few more kinds of lasting, signed record. Generalise the op once, and every mechanic below becomes "a new layer", with no consensus and no trusted server.

```ts
interface Op {
  l: Layer;          // which layer
  x: number; y: number;   // tile, or chunk coordinates for 'chart'
  v: Value | null;   // layer-specific value; null removes
  clock: number;     // Lamport clock, as today
  at: number;        // author's wall clock, unix seconds (new)
  author: string; sig: string;
}
```

| Layer | Key | Value | Merge | Scope | Used for |
|---|---|---|---|---|---|
| `tile` | x, y | `Tile` or null | Last wins | Zone | Path, Wall, Bridge, Steps (as today) |
| `sign` | x, y | `{k:'post'\|'cairn', text?}` | Last wins | Zone | Signposts, cairns |
| `chart` | chunk x, y | `1` | **First wins** | World | A map square was charted, and by whom |
| `found` | x, y | `1` | **First wins** | World | A landmark was discovered, and by whom |
| `name` | x, y | text ≤ 32 | Last wins | World | Name of the landmark or waystation at that tile |
| `way` | x, y | `{n}` (a nonce) | Last wins | World | A waystation or its building site |
| `give` | x, y, **author** | `{n, w, s, p}` running totals | Last wins per author | World | One player's contribution to a waystation |
| `who` | **author** | `{name, hue}` | Last wins per author | World | Display name for an author key |

- **Last wins** is today's rule (`opWins`: clock, then author, then signature).
- **First wins** keeps the op with the lowest `at`, ties broken by author then signature. It is still a CRDT (a minimum over a total order), so replicas converge. It needs a wall clock because Lamport clocks say nothing about which of two unsynced players was really first.
- `who` ops have no place of their own; they are kept and synced with zone 0,0's atlas ops.
- **Zone scope** syncs as today: per-chunk digests for the zone you are in.
- **World scope** ("atlas layers") syncs everywhere: `sync` gains a digest per zone of that zone's atlas ops; hosts pass new atlas ops to all neighbouring hosts, not only near the border; the seed passes them to every host it is linked to in that world. Without a seed, atlas data still travels with players and across linked hosts.
- **Checks every peer makes at merge** (pure, so replicas agree): shape, signature, `at` not more than 5 minutes in the future, and terrain rules that follow from the seed (a Bridge only on generated water, a `found` only where the seed puts a landmark).
- **Checks only the live host makes** (as today: they slow casual misuse, nothing more): author is the sender, within reach, within a rate limit, `at` within 2 minutes of the host's clock, and naming rights.
- **A refused op is sent back** (`reject`), so the client undoes it and refunds its cost. This closes the "rejected edit stays in the painter's copy" limitation in PLAN.md.
- **Existing edits stay valid**: `tile` ops keep today's signature payload (`ti-edit:1|…`); other layers sign `ti-op:1|world|l|x|y|v|clock|at|author`.
- **Seed**: stores all layers in the same append-only file. Nothing live.
- **`PROTOCOL_VERSION` 6 → 7.**

**What cheating looks like under this model, for every mechanic:** nobody can forge another player's op. A host can drop or delay ops (they still spread later through the author, the seed or the next host). Anyone with a modified client can sign anything the pure checks allow: chart the whole world, back-date a discovery, claim materials they never gathered. All of that only spoils cosmetic credit or their own fun, which is the bargain PLAN.md already made for co-op.

## 2. Shared atlas and fog of war

**What the player does.** Walks. A soft disc of land (about 10 tiles) is always inked around each explorer. Stepping into an uncharted square inks the whole square in, for everyone, for good, with a quill-scratch sound. The atlas (a full-screen parchment map, M key or the compass-rose button) shows every charted square, names, waystations, landmarks and other explorers.

**Why it's fun.** A constant drip of small rewards (a square every ~5 seconds of walking), a map the group visibly made together, and "who got there first" credit without any competition over resources.

| Option | What | Verdict |
|---|---|---|
| **A. Shared reveal, by map square** | One first-wins `chart` op per chunk. Charted squares are inked for everyone. | **Recommended.** One small op per square, trivial merge, matches "discoveries persist for everyone". |
| B. Shared reveal, fine cells | 8×8 cells, a 16-bit mask per author per chunk, OR-ed together. | Smoother edge, but ~3× the data and a second merge rule. The ink-edge shader hides A's blockiness anyway. |
| C. Personal fog, shared atlas | The 3D world inks in only where *you* have been; others' charting shows only on the map screen. | Everyone gets their own discovery moment, but the world looks different to each player and "shared" is weaker. |

- **Fog is presentation only.** Terrain is a pure function of the seed, so any client can compute unexplored land. Fine for co-op.
- **Other explorers are always visible**, even over blank parchment. A friend's dot on empty map is the point.
- **A fresh world is one link away** (`#w=`), so a group that wants a blank map starts its own.

**Architecture**
- Live (host): nothing new. The sight disc is client-only.
- Lasting: `chart` ops, world scope. A client signs one when it has stood 2 tiles inside a square its replica shows as uncharted.
- Merge: first wins by `at`. Two players entering together both sign; one is credited everywhere.
- Host limits: accept a live `chart` only for the square the player is in or next to, 2 a second.
- Cheating host: can withhold a chart (it arrives later). Any client can chart squares it never visited: the map fills in, nothing breaks.
- Seed: stores `chart` ops and relays them between hosts. About 220 bytes a square, so 25 fully charted zones is about 350 KB.
- **Known limit (M6):** every device holds the whole world's atlas ops. Fine for hundreds of zones; a big world needs per-zone summaries.
- Friends in other zones: the signal directory already knows who is in which zone. It sends each member a headcount per zone (`pop`), shown as a badge on the atlas. Exact positions only for your zone and its neighbours, as today.

**Worldgen:** none.

**Rendering:** the visual foundation built "the known world as a circle" with an ink-in edge. M5 feeds that shader a mask (charted squares near the camera, plus the sight discs) instead of one circle. This answers the foundation's open item about a trail of explored land. `render/atlas.ts` is restyled as ink-and-wash and drawn at 1 texel per tile.

**Assets:** fog and ink-in are shader work. Atlas symbols, atlas chrome, compass-rose button, the display font, the ink-in sound. See section 11.

## 3. Landmarks and discovery

Not in PLAN.md's M5 list. Added because charting alone has no peaks, and naming needs something worth naming.

**What the player does.** Spots something unusual, walks up to it (within 3 tiles), gets a stinger and a cartouche: "You found the Quiet Arch". They may rename it. It goes on everyone's atlas with their name and the date. Later visitors add it to their own journal.

**Why it's fun.** It is the "look what I found!" moment, the thing you call friends over to see, and a permanent personal mark on a shared map.

| Option | What | Verdict |
|---|---|---|
| **A. Seed-placed landmarks** | A new pure function places about 1.6 per zone. | **Recommended.** Gives exploration peaks and direction with no network state at all. |
| B. No landmarks | Name only what players build. | Smaller, but the frontier has nothing in it to find. |
| C. Player-declared landmarks | Anyone plants a "point of interest" marker anywhere. | Covered by signposts (section 6); doesn't reward going further. |

- **Types (one per biome, natural only):** Elder Tree (forest), Stone Arch (rock), Hot Spring (meadow), Whale Bones (sand), Great Boulder (grass), Sea Stack (shallow water), Ice Spire (rock at the snow line). Natural wonders fit "somewhere nobody has been"; ruins and wrecks would imply earlier people and need a story.
- **Default names** are generated like zone names ("The Quiet Arch"), so an unnamed landmark still reads well.
- **Rumours.** Every discovered landmark and every waystation reveals a "?" on the atlas for each undiscovered landmark within 1.5 zones (the square it is in, not the exact spot). Computed on the client from the seed and the `found` ops. There is always a next place to go.

**Architecture**
- Live (host): nothing.
- Lasting: `found` (first wins, world scope), `name` (last wins, world scope).
- Merge: concurrent finders both sign; the earliest `at` is credited everywhere.
- Every peer rejects a `found` or a landmark `name` where the seed has no landmark, so nobody can invent one.
- Cheating host or client: can back-date `at` to steal a credit. Cosmetic.
- Seed: stores both layers.

**Worldgen — FLAGGED.** Adds `landmarkAt(seed, cellX, cellY)` in `packages/shared`: the world is cut into 128-tile cells; a hash gives each cell a 40% chance of one landmark at a jittered spot; the type comes from the generated tile there; cells whose spot is deep water or snow have none.
- It **does not touch `tileAt` or `elevationAt`**, so no terrain, walkability or existing edit changes. Landmarks don't block movement.
- It **does add landmarks to every existing world**, at spots that may already carry player edits.
- **Once shipped it is frozen.** Changing its constants moves every landmark and orphans every `found` and `name`. Tune it before slice 4 ships.

**Assets:** 7 landmark models, 7 atlas symbols plus the rumour "?", discovery cartouche, stinger. See section 11.

## 4. Gathering and resources

**What the player does.** Faces a forest, rock or meadow tile and holds the action button for 1.5 seconds: the tree shakes, chips fly, +1 in the satchel. The same tile gives that player nothing more for 10 minutes, so they move on to the next.

**Why it's fun.** A small tactile beat while travelling, and a reason to care where forests, hills and meadows are. Materials only matter because of what the group builds with them.

| Resource | From | Why this biome matters |
|---|---|---|
| **Wood** | Forest tiles | Bridges, signposts, waystations |
| **Stone** | Rock tiles (hills) | Steps, walls, cairns, waystations |
| **Pigment** | Meadow tiles (flowers) | Ink for signposts and waystation banners |

| Option | What | Verdict |
|---|---|---|
| **A. Harvest terrain tiles, per-player cooldown** | The tile type is the resource. Nothing shared changes. | **Recommended.** No worldgen change, no network state, no way to take from a teammate. |
| B. Seed-placed resource nodes | Rare nodes (ore, crystal) as a second seed overlay. | A reason to seek specific spots, but landmarks already do that. Stretch. |
| C. Shared depletion and regrowth | A harvested tree becomes a stump for everyone, regrowing over hours. | The world visibly changes, but every harvest is a stored op forever, and players compete. |

- **Scarcity answer (PLAN.md's open question):** there is none to enforce. Forest, rock and meadow sit in different places, so the cost is the trip, not the contest.

**Architecture**
- Live (host): only an `act` relay, so others see and hear you gathering (`{t:'act', a:'gather'}`, client → host → zone).
- Lasting: nothing. Cooldowns are a local list.
- Cheating: a modified client can grant itself anything. The host never knew the count, so it has nothing to cheat with.
- Seed: nothing.

**Worldgen:** none.

**Assets:** 3 resource icons, chip and petal particles, 3 gather sounds, a pickup sound. See section 11.

## 5. Inventory

**What the player does.** Carries a satchel: three counters (wood, stone, pigment), 30 of each at most, shown as a small strip on the HUD.

| Option | What | Verdict |
|---|---|---|
| **A. Local satchel** | Counters in IndexedDB per world and device. Unverified. | **Recommended.** Zero network cost; the cap sends people back out and makes pooling worthwhile. |
| B. Signed ledger | Every gather and spend is a signed op; inventory is derived. | Verifiable, but grows forever and protects nothing a co-op game needs protected. |
| C. Host-held inventory | The zone host keeps counts. | Lost or forgeable on every host change; hosts can already cheat. |

- **No giving or trading in M5.** Players pool materials at waystation sites instead (section 6). A trust-based "give" is a stretch.
- Clearing site data or changing device loses the satchel, like the identity key today. Low stakes.

**Architecture:** nothing on the wire, nothing on the seed. Spending happens when the client signs a build op; a `reject` refunds it.

**Assets:** satchel strip, 3 resource icons (shared with section 4), "full" and "not enough" toasts.

## 6. Building and waystations

**What the player does.** Opens the build sheet, picks a piece, sees a ghost on the tile in front, confirms. One context button does gather / read / deposit / travel depending on what is in front of the player; one build button opens the sheet. Both are thumb-sized.

| Piece | Layer | Cost | Where | What it does |
|---|---|---|---|---|
| **Trail** (Path) | `tile` | Free | Land | Walk 25% faster. A "blaze trail" toggle lays it under you as you walk. |
| **Wall** | `tile` | 1 stone | Land | Blocks movement. Decorative; lowest priority. |
| **Bridge** (new tile) | `tile` | 2 wood | Generated water or deep water | Makes it walkable. Opens far shores and islands. |
| **Steps** (new tile) | `tile` | 2 stone | Generated snow | Makes it walkable. Opens mountain passes. |
| **Signpost** | `sign` | 2 wood, 1 pigment | Land | Shows up to 60 characters in the world and on the atlas. |
| **Cairn** | `sign` | 3 stone | Land | A wordless marker in your colour. A ping that stays. |
| **Waystation** | `way` + `give` | 20 wood, 15 stone, 5 pigment, pooled | Land in a charted square, 64+ tiles from another | See below. |

**Why it's fun.** Deep water and snow are the world's real walls. A group that pools wood to bridge a strait has changed where everyone can go. That is co-op with no combat.

**Waystations**
- **Founding:** anyone places a site for free (`way` op). It shows stakes and a rope outline.
- **Pooling:** anyone deposits materials. Each player's deposits are their own `give` record (running totals), so two players depositing at once never conflict. The site is complete when the sum across players meets the cost. No "completed" op exists: every peer derives it.
- **Complete, it is:** a named place on the atlas; a **fast-travel stop**; your **spawn point** next session (the last one you visited); a plaque listing who built it, straight from the signed `give` records.
- **The Landing:** the world spawn counts as a waystation from the start.
- **Removing one:** hold for 5 seconds and confirm. A rebuilt station gets a new nonce `n`, so old deposits don't count twice.

| Option | What | Verdict |
|---|---|---|
| **A. Pooled sites** | As above. | **Recommended.** "We built this" is the co-op heart, and per-author counters merge cleanly. |
| B. One builder pays | A single player carries the full cost. | Simpler by one layer, but solo by design: nobody else has a reason to turn up. |
| C. Host-run building progress | The host counts deposits live. | Lost on host change; conflicts with everything else being signed ops. |

| Fast travel option | Verdict |
|---|---|
| **A. Station to station, plus "return to my last station" from anywhere (60 s cooldown)** | **Recommended.** Stations form a network worth extending; nobody gets stranded on a phone. |
| B. From anywhere to any station | Convenient, but nobody walks back, so trails and bridges lose their point. |
| C. None | The frontier becomes a 15-minute walk within a few sessions. |

| Who may change someone else's build | Verdict |
|---|---|
| **A. Anyone; last edit wins** (as tiles work today) | **Recommended.** One merge rule; a shared map anyone can tidy. Hold-to-dismantle stops accidents. Every edit is signed, so it is known who did it. |
| B. Builder only | Needs an ownership rule inside the merge (first claimant owns the tile), which complicates removal and rebuilding. Revisit if griefing actually happens. |

**Architecture**
- Live (host): `travel {x,y}` (client → host). The host moves the player only if its replica has a complete waystation there; otherwise the usual snap-back applies. `act` relay for build animations.
- Lasting: `tile`, `sign` (zone scope); `way`, `give` (world scope, so anyone can see and travel to a far station).
- Merge: last wins per tile for `tile`, `sign`, `way`; last wins per author for `give`, then summed. Two players filling the last slot both succeed; the surplus is lost.
- Every peer checks the terrain rule for Bridge and Steps against the seed.
- **`step()` change:** Trail and Bridge tiles move at 1.25× speed. The host's speed check must use the same per-tile speed, or it will snap honest players back.
- Cheating: a modified client can build for free, or sign a full `give`. A host can refuse travel. All low stakes. Griefing by walling or dismantling is as possible as it is today; the seed's append-only file keeps the history if something has to be restored by hand.
- Seed: stores all four layers; relays `way` and `give`.

**Worldgen:** none. Bridge and Steps are player-made tile types the generator never produces, like Path and Wall, so adding them changes no world.

**Assets:** models for waystation (site stages and complete), signpost, cairn, bridge, steps, improved wall; build sheet and icons; travel effect; build, deposit, completion and travel sounds. See section 11.

## 7. Naming places

**What the player does.** Types a name into a cartouche when they discover a landmark or found a waystation. It appears hand-lettered on everyone's atlas and floats over the place in the world. Signposts are the free-form version: words anywhere.

| What | Who names it | Stored as |
|---|---|---|
| Landmark | Its discoverer (the `found` winner). Until then, its generated name. | `name` at the landmark's tile |
| Waystation | Its founder (the `way` author). | `name` at the station's tile |
| Anything else | Anyone, with a signpost. | `sign` text |
| Zone | Nobody. Zones keep their generated names ("Amber Fen"). | — |

| Naming rights option | Verdict |
|---|---|
| **A. Discoverer or founder only, enforced by the live host** | **Recommended.** Makes being first matter. Same strength of protection as today's edit checks. |
| B. Anyone can rename | Simplest, but invites rename wars and cheapens discovery. |

| Input option | Verdict |
|---|---|
| **A. Free text, 32 characters, with a per-player mute** | **Recommended.** "Dave's Disappointing Hill" is the fun. Mute hides one author's names, signs and chat on your device. |
| B. Pick from word lists | Safe and phone-friendly, but every name sounds generated. Keep as a fallback if abuse appears. |

**Architecture**
- Lasting: `name` (last wins, world scope); `who` maps an author key to a display name and hue, so credits show names, not keys.
- A name shows only while its anchor (landmark or `way`) exists.
- Concurrent renames by the same person on two devices: last wins.
- Cheating: a modified client can rename anything, since rights are a live-host check, not a merge rule. Tolerable; revisit with the builder-only question above.
- **Known weak spot:** free text from strangers in a lasting world. Mute is the only tool in M5. Real moderation waits for reputation (PLAN.md risks).
- Seed: stores `name` and `who`.

**Worldgen:** none beyond section 3.

**Assets:** naming cartouche, hand-lettered label style on atlas and in world, naming flourish sound, **the display font**.

## 8. Talking: pings, emotes, quick phrases, chat

**What the player does.**
- **Ping:** taps the atlas or long-presses the world. A vermilion ring pulses there for 8 seconds in the world, on the atlas and as an arrow at the screen edge.
- **Emote:** wave, point, cheer, sit. An icon bubble plus a small procedural bob (no rigged animation exists).
- **Quick phrase:** eight preset lines from a wheel ("Over here!", "Look at this", "Need wood", "Need stone", "Follow me", "On my way", "Wait for me", "Thanks!").
- **Signposts and cairns** (section 6) are the messages that stay.
- **Text chat:** Enter on desktop; a speech bubble over the speaker and a short log.

| Option | Verdict |
|---|---|
| **A. Pings, emotes and quick phrases first; text chat in the last slice** | **Recommended.** Friend groups are usually on voice already; what the game must add is *pointing*. Works on phones with no keyboard. |
| B. Text chat first | The `chat` message already exists, but typing is the weakest tool on a phone. |
| C. No free text at all | Safest. Loses jokes and names in conversation. |

**Architecture**
- Live (host), all ephemeral, nothing lasting: `ping {x,y}`, `act {a}` (emotes, gather, build), `say {q}` (phrase number), `chat {text}` (120 characters). Client → host → every client in the zone and, over the existing border links, the eight neighbouring zones.
- Limits: 1 ping per 2 s; 1 chat per second.
- Merge: none.
- Cheating host: can drop, alter or forge any of these (they are unsigned). Tolerable for ephemeral talk.
- Seed: nothing.
- **Limit:** talk reaches your zone and its neighbours, not the whole world.

**Worldgen:** none.

**Assets:** ping ring and edge arrow, 4 emote icons, phrase wheel, speech bubble, chat log, ping chime, emote and chat sounds.

## 9. Goals and pacing

| Timescale | What pulls the player on | Built from |
|---|---|---|
| Every few seconds | A new square inks in | `chart` |
| Every few minutes | A "?" rumour to chase; a landmark found and named | Seed + `found`, `name` |
| Once a session | One group project finished: a bridge, a pass, a waystation at the frontier | `tile`, `way`, `give` |
| Across sessions | The atlas, the station network and the trails keep growing; you spawn at the frontier | Everything on the seed |

- **Why go further:** rumours point outward; water and snow are gates that materials open; new stations move the start line.
- **A 45-minute session:** spawn at the last station → travel to the frontier station → chart outward, gathering on the way → chase a rumour, find and name the landmark → pool materials for a bridge or a new station → open the atlas and see the new patch.
- **Session card (local):** on leaving, "Today: 46 squares charted, 2 landmarks found, 1 waystation founded", computed from ops by author and `at`.
- **Journal (local):** landmarks you have visited, stations you helped build, squares you charted first.
- **Zone surveyed:** when all 64 squares of a zone are charted, the atlas stamps it with a compass rose and its name. Derived; no new state.
- **Titles:** Wanderer → Surveyor → Cartographer, from how many squares you charted first. Derived from signed `chart` ops, shown under your name.
- **What persists:** every op layer, on every device that saw it and on the seed. **What doesn't:** positions, pings, chat. **Per device only:** satchel, journal, cooldowns, last station.

**M5 is done when** 3–5 people on a fresh world, at least one on a phone, play 45 minutes with no instructions and: chart 150+ squares, find and name 2+ landmarks, finish 1 waystation or bridge, and at least half ask to play again.

## 10. Build order

Each slice is playable and testable on its own. Slices 1–4 are the **first playable**: explore, chart, point, discover, name.

| # | Slice | Done when |
|---|---|---|
| 1 | **Layered ops.** Generic `Op`, first-wins merge, `at`, world-scope sync, seed relay, `reject`, protocol 7. No visible change. | Existing e2e still passes. Unit tests cover both merge rules in any order. Two browsers in different zones converge on a world-scope op; the seed keeps it across a restart. |
| 2 | **Charting and the atlas.** Sight disc, `chart` on entering a square, fog mask, atlas screen with squares, credits, players, zone headcounts. | Browser A walks; B sees the same squares ink in within a second, in the world and on the atlas. The squares survive everyone leaving. The atlas pans and zooms on a phone-sized viewport. |
| 3 | **Pointing.** Pings, emotes, quick phrases, `act` relay. | A ping from A shows in B's world and atlas, including from a neighbouring zone, and is rate-limited. |
| 4 | **Landmarks.** `landmarkAt`, discovery, credit, naming, rumours, `who`. | Both browsers place the same landmark on the same tile. Two simultaneous finders agree on one credit (unit test). A name shows on both atlases and survives a reload. |
| 5 | **Gathering and the satchel.** | Wood, stone and pigment come from the right tiles; cooldown and cap work; the satchel survives a reload; B sees A gathering. |
| 6 | **Building.** Costs, Bridge, Steps, trail speed and blaze toggle, signposts, cairns, build sheet. | A bridges deep water; B walks across and the host accepts it. A refused build refunds. Signpost text shows for both and persists. |
| 7 | **Waystations.** Site, pooled `give`, derived completion, naming, plaque, fast travel, spawn at last station. | A and B each deposit half; the station completes on both. A third browser in a far zone sees it on the atlas and travels to it. |
| 8 | **The arc.** Journal, session card, zone-surveyed stamp, titles, text chat, mute. | Each shows correct numbers after a scripted two-browser session. A muted author's names, signs and chat disappear locally. |
| 9 | **Group playtest.** | The done-when in section 9. |

## 11. Assets

Formats follow ART_DIRECTION.md: models are low-poly and code-built (or `.glb`), instanced, on the shared ramp; icons, symbols and chrome are SVG; particles are small PNG or generated; sounds are in the format the audio decision picks. **Slice** is where each is first needed; **bold slices (2–4) are the first playable.**

**Models**
| Asset | Slice | Notes |
|---|---|---|
| Landmarks ×7: Elder Tree, Stone Arch, Hot Spring, Whale Bones, Great Boulder, Sea Stack, Ice Spire | **4** | The showpieces; each readable from a distance. Hot Spring has steam. |
| Explorer figure | 5 | Replaces the capsule: hat, satchel, cloak in the player's hue. Procedural walk, gather and build leans. |
| Bridge segment (straight, ends) | 6 | Sits at sea level. |
| Steps segment | 6 | Cut into snow. |
| Signpost | 6 | |
| Cairn | 6 | Top stone in the builder's hue. |
| Wall, improved | 6 | Low priority. |
| Waystation: site (3 fill stages) and complete | 7 | Shelter, flagpole, banner in the founder's hue. |

**Shaders and effects (code)**
| Asset | Slice | Notes |
|---|---|---|
| Fog mask: charted squares + sight discs feeding the ink-in edge | **2** | Extends the visual foundation's circle. |
| Square inking in (ripple from the player) | **2** | |
| Ping ring and screen-edge arrow | **3** | Vermilion. |
| Discovery burst | **4** | Restrained: ink bloom, not fireworks. |
| Gather particles: wood chips, stone chips, petals | 5 | |
| Build ghost (valid / invalid) | 6 | |
| Travel effect (ink swirl out and in) | 7 | |

**Atlas symbols (SVG, ink style)**
| Asset | Slice |
|---|---|
| Explorer marker (hue), zone headcount badge | **2** |
| Ping mark | **3** |
| Landmark symbols ×7, rumour "?" | **4** |
| Bridge, steps and trail line styles; signpost; cairn | 6 |
| Waystation (site, complete), The Landing | 7 |
| Zone-surveyed compass rose and cartouche | 8 |

**UI icons (SVG)**
| Asset | Slice |
|---|---|
| Atlas button (compass rose), close, confirm, cancel | **2** |
| Ping, emote ×4 (wave, point, cheer, sit), phrase wheel | **3** |
| Context action: gather, read, deposit, travel | 5–7 |
| Resources ×3: wood, stone, pigment | 5 |
| Build pieces ×7: trail, wall, bridge, steps, signpost, cairn, waystation; blaze-trail toggle | 6 |
| Journal, mute, chat | 8 |

**UI chrome (SVG / CSS)**
| Asset | Slice |
|---|---|
| Atlas screen: parchment sheet, border, graticule, credit tooltip | **2** |
| Toast, speech and emote bubble | **3** |
| Discovery and naming cartouche; world name labels | **4** |
| Satchel strip | 5 |
| Build sheet, signpost text entry | 6 |
| Waystation panel: progress, deposit, plaque, travel list | 7 |
| Journal, session card, chat log | 8 |

**Fonts**
| Asset | Slice |
|---|---|
| Cartographic display face (place names, cartouches) | **2** |
| Clean UI face | **2** |

**Sounds**
| Asset | Slice |
|---|---|
| Square inks in (quill scratch), atlas open and close (paper) | **2** |
| Ping chime, emote blips, UI tap | **3** |
| Discovery stinger, naming flourish, rumour revealed | **4** |
| Gather wood, stone, petals; pickup; "nothing here" | 5 |
| Place piece, bridge plank, refused | 6 |
| Deposit, waystation complete, travel | 7 |
| Chat tick, zone surveyed, title earned | 8 |

Footsteps, ambience and music belong to the visual and audio foundation, not this list.

## 12. Decisions for Sid

Answer each in a line. The recommendation is first. Answers are recorded in the last column.

| # | Question | Recommended | Or | Decided |
|---|---|---|---|---|
| 1 | How does fog lift? | Shared, by 32×32 map square | Fine 8×8 cells / personal fog with a shared atlas screen | |
| 2 | Credit for charting and discovery? | First wins, by the author's signed date (adds `at` to ops) | No credit, plain last-writer-wins | |
| 3 | How far does atlas data travel? | World-wide, via hosts and the seed | Only zones you have visited | |
| 4 | Add seed-placed landmarks (a new overlay function; terrain untouched; appears in existing worlds)? | Yes, about 1.6 a zone | No landmarks | |
| 5 | Landmark theme? | Natural wonders only | Also ruins and wrecks | |
| 6 | Hints to the next landmark? | Rumours revealed by finds and waystations | Always-on compass / none | |
| 7 | What is gathered, from where? | Wood, stone, pigment from forest, rock, meadow tiles | Seed-placed nodes / both | |
| 8 | Scarcity? | None: per-player cooldown, world unchanged | Shared depletion with regrowth | |
| 9 | Inventory? | Local satchel, 30 of each, unverified, no trading | Signed ledger / host-held / add giving | |
| 10 | Approve the build list and costs (section 6 table)? | Yes | Name the changes | |
| 11 | Trails and bridges 25% faster (changes `step()`)? | Yes | No | |
| 12 | Who may change others' builds? | Anyone; last edit wins; hold to dismantle a waystation | Builder only | |
| 13 | How are waystations built? | Pooled by several players | One builder pays all | |
| 14 | Fast travel? | Station to station, plus "return to last station" | Anywhere to any / none | |
| 15 | Who names things? | Discoverer or founder; signposts for the rest | Anyone can rename | |
| 16 | Name input? | Free text with per-player mute | Word lists | |
| 17 | Talking, in what order? | Pings, emotes, phrases first; text chat last | Text chat first / no free text | |
| 18 | Friends in other zones on the atlas? | Headcount per zone from the signal directory | Nothing / exact positions via the seed (stretch) | |
| 19 | Existing test edits? | Keep (tile ops keep their signature format) | Wipe | |
| 20 | Journal, session card, zone stamps and titles in M5? | Yes, slice 8 | Stretch | |
| 21 | Replace the capsule with an explorer figure in M5? | Yes, slice 5, code-built, procedural motion | Keep capsules | |
| 22 | Where do M5 sounds come from? (open in ART_DIRECTION.md) | Synthesised in code | Mix in CC0 packs | |
| 23 | Fonts? (open in ART_DIRECTION.md; needed by slice 2) | IM Fell English for names, Alegreya Sans for UI (both open-licence; confirm at download) | Name others | |
| 24 | Accept the M5 done-when playtest (section 9)? | Yes | Name the changes | |

## 13. Changes to make elsewhere once decided

Not made here: other sessions are editing these files.

**docs/PLAN.md**
- Core loop: add landmarks; say waystations are spawn and fast-travel points.
- World & networking: edits become layered ops with two merge rules and two scopes; the seed relays atlas layers between hosts.
- "Open questions": mark scarcity and inventory answered (nothing contested; local satchel; pooled per-author counters).
- "Current limitations": remove the rejected-edit item after slice 1; add "every device holds the whole world's atlas ops (M6)", "talk reaches only neighbouring zones", "free-text names have only a local mute".
- Decisions table: one row per answer in section 12.
- M5 row: link here; use the done-when from section 9.
- Signal server description: it now also sends a headcount per zone.

**docs/ART_DIRECTION.md**
- "Open questions": remove the M5-mechanics item; record the audio and font answers.
- Asset list: point to section 11 here as the production list.
- Visual foundation backlog: the known-world circle becomes a mask of charted squares plus sight discs; the "trail of explored land" item is answered by charting.
- Technical constraints: add "landmarks are placed by `landmarkAt` in shared and are frozen once shipped".

**CLAUDE.md**
- Conventions: "a new kind of lasting state is a new op layer, not a new message"; "`landmarkAt` is frozen like `tileAt`"; "per-tile speed lives in `step()`, and the host check must use it".

**Code (for the build sessions, not this one)**
- `packages/shared`: `edits.ts` → layered `Op` store; `protocol.ts` → messages in sections 1, 6 and 8, version 7; `worldgen.ts` → `Tile.Bridge`, `Tile.Steps`, `landmarkAt`; `movement.ts` → per-tile speed.
- **Coordinate with the M6 session:** it is adding rate limits, validation and possibly a binary encoding. M5's new messages and host checks should land on whatever M6 settles, and only one of the two should bump `PROTOCOL_VERSION` at a time.

## Stretch (not M5)

- Giving items between players; a shared cache at waystations.
- Lookout tower: an expensive build that charts the squares around it.
- Seed-placed rare resource nodes.
- Exact positions of friends world-wide; world-wide chat.
- A guest book at each waystation; sharing the atlas as an image.
- Builder-only edit rights; reputation; real moderation for names.
- Ruins, wrecks and any story they imply.
