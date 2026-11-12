# Terra Ignota — Art Direction

This file is the source of truth for how the game looks and sounds. Read it before making or changing any visual or audio work, and update it in the same change whenever a decision is made or reversed. Architecture and milestones live in [PLAN.md](PLAN.md).

Each entry is marked **Decided** (Sid agreed), **Proposed** (a starting point nobody has confirmed; refine it, then record what you chose and why), or **Open** (needs Sid).

## Theme
**Decided.** *Terra Ignota* means "unknown land". The game is a co-op exploration of an endless world that starts out unknown and is charted together into a shared atlas.

- **The unexplored world is blank parchment.** As players explore, the land "inks in" and rises from the map into a 3D miniature.
- **Everything players make together is cartography:** the atlas, place names, waystations and markers use old map-making language (ink lines, compass roses, hand-lettered labels, cartouches).
- **The player is an explorer and map-maker,** not a fighter. Nothing in the look should suggest combat or threat.

## Visual style
**Decided: a low-poly diorama on a parchment map.**

- **Low-poly, flat-shaded 3D.** Faceted surfaces, visible planes, no photographic textures. Think of a hand-made tabletop miniature.
- **Orthographic isometric camera** (true isometric pitch, rotates in 90° steps with Q and E). The world should read as a model seen from above, with no perspective distortion.
- **Colour comes from vertex colours and small gradient ramps,** not painted texture maps.
- **A warm, limited palette.** Restraint over saturation.
- **Cohesion matters more than variety.** A new asset that doesn't look like it belongs with the others is wrong, however good it is alone.

**Rejected, and why:**
| Alternative | Why not |
|---|---|
| 2D pixel art | Throws away the 3D isometric switch made after M2. |
| Hand-painted textures | Needs an artist or an image model; can't be produced consistently in code. |
| Realistic models and materials | Too heavy for a PWA on phones, and can't be produced in code. |

## Mood
**Decided in outline; the wording is Proposed.**

- **Quiet wonder.** The feeling of unfolding a map of somewhere nobody has been.
- **Calm, warm and unhurried.** Low sun, long soft shadows, gentle motion. Never busy, never harsh.
- **Alive in small ways.** Grass moves, light shifts, water laps, dust drifts. The world should feel inhabited by weather and time even when no player is near.
- **Shared, not lonely.** Other explorers and what they built should read as welcome signs of company.
- **Every asset should feel emotive, expressive and nuanced, never generic or placeholder.** Favour subtlety and craft: layered lighting, believable motion, restrained colour, small environmental details.

## References
**Proposed. Sid hasn't named any references; these are starting points for the feeling, not things to copy.**

- **Antique cartography:** 17th–18th century engraved sea charts and atlases, for the parchment, ink line, lettering and compass roses.
- **Illustrated fantasy maps** in the hand-drawn tradition, for how mountains, forests and coasts are drawn as symbols.
- **Tabletop dioramas and architectural models,** for the faceted, hand-made, miniature quality and the soft directional light.
- **Low-poly isometric games with a calm, minimalist tone,** for proof that flat shading plus careful lighting and colour reads as crafted, not cheap.

Do not reproduce any existing game's characters, levels, art or specific look.

## Palette
**Chosen in visual-foundation milestones 1 to 3 (2026-11-12); awaiting Sid's approval.** The code is `apps/client/src/render/look.ts` (water, trees, cartography), `day.ts` (the light, hour by hour) and, in `terrain.ts`, the `GROUND` table and the plant colours beside it.

Each ground tile has **two tones**. Patches of land drift between them on a slow noise (about 13 tiles across), so no biome is a flat fill. The greens were pulled toward sage and olive and everything was warmed, so the land sits comfortably on parchment.

| Tile | Deep tone | Sun-bleached tone | Notes |
|---|---|---|---|
| Deep water (seabed) | `#325264` | `#3A5C6A` | Seen through the water |
| Water (seabed) | `#96A88E` | `#ACB290` | Sandy shallows |
| Sand | `#D6C496` | `#E4D2A4` | |
| Grass | `#709656` | `#92A860` | |
| Forest floor | `#54764A` | `#64804C` | |
| Meadow | `#9EB066` | `#BEBC70` | Golden, dry |
| Rock | `#8C8276` | `#A09482` | Warm grey |
| Snow | `#E8E8E4` | `#F4F0E6` | Warm white; its shadows turn blue from the sky fill |
| Path (player-made) | `#B89C74` | | Drawn crisp, never blended |
| Wall (player-made) | `#68625A` | | Drawn crisp, never blended |
| Bare earth (steep green slopes) | `#9E8666` | | Faces too steep to hold grass |
| Bare stone (steep rock and snow) | `#766C62` | | |

| Other surfaces | Hex | Notes |
|---|---|---|
| Water, shallow | `#7FC0BD` | Blends to deep over 2.4 tiles of depth; 60–96% opaque |
| Water, deep | `#2F6687` | |
| Shore foam | `#F4EFE2` | A thin line that breathes in and out |
| Broadleaf crown | `#41653F` to `#8AA65A` | Ramp from the shaded underside to the sunlit top. Each tree is tinted a little cooler or warmer by where it stands |
| Pine | `#2C4A3D` to `#587D5E` | Darker and bluer than broadleaf, so a stand of pine reads at a glance |
| Trunks | `#6B5137` (broadleaf), `#574333` (pine) | |
| Bush | `#466C40` to `#96AE62` | |
| Stone | `#706860` to `#BCB2A0` | Mossy among grass (`#9EA678` on top); darker and wet in the water |
| Reed | `#566C44` to `#BEB476`, seed head `#604430` | |
| Marram (beach grass) tip | `#E6E0AE` | |

**Grass is not its own colour.** A tuft takes the colour of the facet it grows from and lightens toward a tip colour (grass `#B2C470`, meadow `#E8D486`, fern `#749C58`), so it reads as the land's texture and not as something set on top.

| Flower | Hex | Where |
|---|---|---|
| Oxeye white | `#F4EEDC` | Meadow colonies; sprinkled into grass near them |
| Buttercup | `#ECCC60` | Meadow colonies; sprinkled into grass near them |
| Harebell | `#ACA0D6` | Meadow colonies |
| Sea thrift | `#E2AAB8` | Only near the shore: low grass and upper beach |

Flowers stay paler than any explorer's colour, and no flower is red: vermilion is kept for the player's own marks.

The colours of the light change through the day. They are in "Time of day" below.

**Cartography colours** (the unknown world, the atlas and the UI):
| Role | Hex | Status |
|---|---|---|
| Parchment | `#E8DCC0` | In use: the world's background and the HUD |
| Sepia ink | `#3A2E22` | In use: the edge of the known world, the graticule, HUD text |
| Parchment shadow / fold | `#CDBE9A` | Proposed, not used yet |
| Faded ink | `#7A6A54` | Proposed, not used yet |
| Vermilion accent (markers, the player's own things) | `#B5482E` | Proposed, not used yet |
| Sea-chart blue wash | `#9DB8BC` | Proposed. Today the sea in the fringe is a wash of the seabed colour |

**Rules:**
- Colours on the ground belong to facets (triangles), not tiles. A facet takes the average of its three corners, and each corner takes the average of the four tiles around it, so biomes meet in a band of in-between facets instead of a staircase of squares. Per-facet brightness varies by about ±4% from a seeded random.
- What players build (Path, Wall, any edited tile) is drawn crisp, exactly on its tile. Nature is irregular; what people make is regular.
- Player colours come from a hue the player picks. Keep them the most saturated things on screen so explorers read instantly.
- Night, weather and seasons shift the whole palette together through the shared light colours and the grade (`uGrade` in `look.ts`), not by recolouring assets one by one.

## Time of day
**Chosen in visual-foundation milestone 3 (2026-11-12); awaiting Sid's approval.** The code is `apps/client/src/render/day.ts` (the clock and the table of lights) and the `Look` class in `look.ts` (which turns an hour into the shared uniforms).

**Three lights, always.** A key light (the sun by day, the moon by night), a sky fill from above and a bounce from below. Each arrangement sets their colours and how strong they are against each other, and a **level**: how bright open, level ground is. The three are scaled together to meet the level, so the brightness of the picture is decided directly and never drifts as the sun climbs.

| Arrangement | Hour | Key | Sky fill | Level | The feeling |
|---|---|---|---|---|---|
| Dawn | 6.7 | Peach `#FFB48A`, 8° up, from the east | Lavender `#B0B2E2` | 0.64 | Cool and hushed; only east-facing slopes and crowns are gold |
| Morning | 9 | Cream `#FFEFD6` | Clear blue `#B2D0EE` | 0.86 | Fresh and clean |
| Noon | 12 | Near white `#FFF4E2`, 52° up | Blue `#B8D4F0`, strong | 0.92 | Open and even; the fill is raised so it is never harsh |
| Afternoon | 15.3 | Warm `#FFE6BE`, 30° up, from the west | `#B3CDEC` | 0.88 | The reference light. Milestones 1 and 2 were made in it |
| Golden hour | 16.8 | Gold `#FFCF96`, 14° up | Periwinkle `#AAB8E2` | 0.74 | Long shadows; lit slopes glow |
| Sunset | 17.55 | Orange `#FF9458`, 5° up | Violet `#B8A8D0` | 0.62 | Last light on the high ground; the hollows have gone cool |
| Dusk | 18.5 | The moon, just risen in the east | Violet-blue `#7C7EBE` | 0.35 | No direct light to speak of. Lanterns come on |
| Moonlit night | 21.5 | Moon `#A9C4F0` | Deep blue `#6E86B8` | 0.25 | Blue-green and quiet, with moon shadows. Never dark |

- **The sun is up from 6 to 18.** It rises east-south-east, leans south at midday (52° at its highest) and sets west-north-west.
- **The moon follows the same arc twelve hours behind,** so it rises as the sun sets. The terrain's baked shadows therefore serve both, and a moonlit night has long soft shadows of its own. The moon is always full; phases are for later.
- **The key light changes hands below the horizon.** As either body meets the horizon its light fades to nothing, so dusk and first light are lit by the sky alone.
- **Night is never dark.** Open ground at night is about a quarter as bright as in the afternoon (roughly half as bright to the eye). The picture is cooled and desaturated as the level falls, the way eyes see by moonlight.
- **The parchment takes the light too,** but only half its colour, so the map dims to slate at night and warms at sunset while staying paper.
- **Every explorer carries a lantern.** From sunset to just after sunrise a warm pool of light (`#FFAE62`, reaching 7.5 tiles) surrounds each explorer and flickers slightly. It lights the ground, trees, water and the piece itself. Yours always shows; up to three more go to the nearest other explorers. At night, another explorer is a warm light in the distance: company, in keeping with "shared, not lonely".
- **The day follows the wall clock, not the network.** One day lasts 48 real minutes and every explorer reads the same hour from their own clock. Nothing is sent. The hours are not spent evenly: the day lingers at dawn (about 5 minutes) and through the golden hour and sunset (about 8), and hurries through noon (about 5) and the night (about 10 of the 48).
- **`#time=`** holds the light still: a name (`dawn`, `morning`, `noon`, `afternoon`, `golden`, `sunset`, `dusk`, `night`) or an hour such as `#time=16.5`. `window.__ti.view.setHour(h)` does the same; `setHour(null)` returns to the clock. The debug panel shows the hour.

## Wind
**Chosen in visual-foundation milestone 4 (2026-11-12); awaiting Sid's approval.** The code is `apps/client/src/render/wind.ts` (direction and strength from the clock) and `windAt` in `look.ts` (the field every shader samples).

- **One wind for everything.** A direction, a strength from 0 to 1, and gusts that roll downwind across the land in broad, wandering bands about 30 tiles apart. Grass, flowers, reeds, bushes, trees and water all sample the same field, so a gust is seen crossing a meadow, reaching the trees and then ruffling the lake.
- **Supple things bend, stiff things rock.** A blade of grass leans downwind by up to its own height in a gale and flutters out of step with its neighbours. A tree's crown leans only a little and rocks slowly, each tree in its own time. Stones do not move.
- **Bent grass is paler.** A gust lightens the blades it bends by a few percent, so wind shows as bands of sheen crossing a meadow even when the blades are too small to see move.
- **Leaves turn.** The facets of a crown catch the light in turn as the wind passes, by tilting their normals. No geometry moves for this.
- **Water answers too.** Ripples grow with the wind, and a gust darkens the surface as it passes (a cat's paw).
- **Fair weather is never still and never rough.** On its own the wind wanders between 0.12 and 0.7 over minutes, from the south-west and swinging about 50° either way. Weather (milestone 5) will push it harder.
- **It follows the wall clock, not the network,** like the time of day. Every explorer feels the same breeze.
- **`#wind=0.8`** holds the wind at a strength from the prevailing direction; `window.__ti.view.setWind(s)` does the same and `setWind(null)` returns to the clock. The debug panel shows the strength.
- **Tree crowns thin out where they would hide you.** Crowns standing between your explorer and the eye are drawn as a faint scatter of their own pixels, so you can see yourself among the trunks. There is no blending and no sorting.

## Weather and seasons
**Chosen in visual-foundation milestone 5 (2026-11-12); awaiting Sid's approval.** The code is `apps/client/src/render/weather.ts` (the sky and the year, from the clock), the `Look` class in `look.ts` (which bends the lights, wind and mist by them), the season and snow code in the ground and foliage shaders, and `precip.ts` (rain and snow in the air).

**Weather is five amounts, not a list of states:** cloud, rain, snow, fog and storm, each from 0 to 1. They rise and fall on slow tides read from the wall clock, so weather drifts in over minutes and never switches, and every explorer sees the same sky with nothing sent. Fair weather is the rule: cloudy about a quarter of the time, raining about a seventh, a storm about one minute in twenty, mist about a tenth.

| Weather | What it does |
|---|---|
| Cloud | The sun goes in (its light falls by up to four-fifths), the sky fill greys and brightens to take its place, shadows soften, colour drains by a fifth, and the glint leaves the water. Open ground is about a seventh darker. |
| Rain | Thin, slanted streaks in the air, bent by the wind. The land darkens by a fifth as it gets wet, the water is pocked with small bright rings, a light haze settles, and the wind picks up. |
| Storm | Rain at its heaviest, more wind, darker still, and **distant lightning**: now and then a double flicker that lifts the whole picture for under half a second. There are no bolts and nothing strikes: this is weather, not a threat. |
| Fog | Mist lies in the low ground and over water, thins with height and drifts on the wind, so hilltops and high forest stand clear of it. It takes the colour of the light, so it is rose at dawn and slate at night. Mist needs still air, so the wind drops. |
| Snow | Rain becomes snow as winter comes on: small, slow flakes that wander. Snow on the ground deepens while it falls. |

**The year** has four seasons of 4 real hours each (five of the game's days), so a year is 16 hours and the season at a given time of day changes from one real day to the next. A season holds for two-thirds of its span and then gives way to the next.

| Season | What changes |
|---|---|
| Spring | Greens are fresher and a little yellower; broadleaf crowns are a lighter green. Colour is up 5%. |
| Summer | The reference. Everything in milestones 1 to 4 is summer. |
| Autumn | Broadleaves turn ochre `#BC9B50` to russet `#9B6945`, each tree in its own week and none completely, so a wood is a mix of green, gold and brown. Grass goes olive-gold. The sun is a little more golden. |
| Winter | Snow lies in drifts on whatever faces the sky: ground, stones, pine boughs, the tops of bare crowns. Grass under it is straw. Broadleaves are bare: a thinner, twig-coloured crown. Pines keep their needles. Colour is down 10% and the sun is paler. |

- **Autumn has no red.** The palette stops at russet, for the same reason no flower is red: vermilion is kept for the player's own marks.
- **Pines never change** except to carry snow. A stand of pine is where the green is in winter.
- **Snow is a rule in the shader, not new geometry.** Each surface whitens by how far it faces the sky and by a slow drift pattern, so cover comes and goes in patches as the amount changes. Nothing is rebuilt.
- **The seasons recolour by rule too:** anything green shifts, and sand, rock and what players build do not.
- **Rain and snow are one mesh** of 480 small quads that fall through a box around the explorer and wrap. The vertex shader places every one. Nothing falls on the blank map: weather belongs to the land.
- **`#weather=clear|overcast|rain|storm|fog|snow`** and **`#season=spring|summer|autumn|winter`** (or a point in the year from 0 to 4) hold them still. `window.__ti.view.setWeather(name)` and `setSeason(year)` do the same; pass `null` to return to the clock. The debug panel shows both.

## Asset types and formats
**Decided at this level. No bulk asset production yet: see "Decisions".**

| Type | Format | Notes |
|---|---|---|
| Terrain, water, fog of war, lighting, weather, wind | Code and shaders | Most of what players see. Not files. |
| Props, structures, landmarks, characters | Low-poly geometry, built in code or as `.glb` (glTF) | One shared palette or ramp texture. Instanced. |
| UI icons, atlas map symbols, UI chrome, cursors, app icons | SVG | |
| Particle sprites, paper grain, ink masks | Small PNG or generated at load | |
| Fonts | Two open-licence faces | A cartographic display face for place names; a clean face for UI. Not chosen yet. |
| Ambient beds, sound effects, music | See "Audio" | |

**What can be made well in code, and what can't:**
- **Strong:** low-poly models, SVG, shaders, procedural particle textures.
- **Usable but stylised:** synthesised audio (wind, water, clicks, chimes, plucks, pads).
- **Not possible in code:** high-quality rigged character animation, recorded audio, painted art. CC0 packs or a paid artist or composer would close this gap later. Downloading any pack needs Sid's OK.

## Audio
**Proposed direction; the source is Open.**

- **Ambient beds** per biome plus wind, sea, rain, night and caves.
- **Sound effects** for footsteps per surface, gathering, building, discovery, the atlas inking in, and UI.
- **Music:** calm exploration stems that layer with play, plus short stingers for discoveries and naming.
- **Open:** synthesise everything in code, or mix in CC0 packs.

## Technical constraints
**Decided.**

- **Target: a stable 60 fps on a mid-range phone from about three years ago.** That means a frame in under 16.6 ms on the reference device, with headroom.
- **It's a PWA.** Download size and memory matter. Assets should be small and cached by the service worker.
- **Stack:** Three.js (`three` ^0.170) under Vite. WebGL, not WebGPU.
- **Terrain is a pure function of `(seed, x, y)`** and is never sent over the network. Changing `tileAt` or `elevationAt` in `packages/shared` changes every existing world. Visual work must not change them without flagging it to Sid.
- **Decoration must be deterministic.** Anything placed on the world (trees, rocks, grass) is derived from the seed and position, so every player sees the same place. It is client-only and must not affect walkability or any rule in `packages/shared`.
- **`packages/shared` stays isomorphic:** no DOM or Three.js there.
- **`#render=0` must keep working.** The e2e tests load the game without rendering.
- **Players can edit tiles** (Path, Wall, back to generated). A chunk's mesh is rebuilt when an edit lands, so chunk builds must stay fast.

**Every asset and effect has a performance budget and stays within it.** Prefer techniques that look expensive but are cheap: baked or vertex lighting, gradient ramps, vertex animation, texture atlases, instancing, LODs, shader tricks over geometry.

**Proposed starting budgets for a typical view on the reference phone. Measure, then tighten or correct them here:**
| Budget | Limit |
|---|---|
| Frame time | 12 ms or less, leaving headroom under 16.6 ms |
| Draw calls | 150 or fewer |
| Visible triangles | 300k or fewer |
| Pixel ratio | Capped at 2 today; consider 1.5 on phones |
| Full-screen passes | One at most beyond the main render |
| Real-time shadow maps | None, or one at 1024 px, only if it measures within budget |
| Texture memory | 32 MB or less in total |
| Particles | 500 or fewer, instanced, in one or two draw calls |
| Chunk build | Must not drop a frame; builds are capped per frame today |

**Performance can't be measured on a real phone from a development session.** Use draw-call and triangle counts from `renderer.info`, frame times with CPU throttling, and say plainly that a real-device check is still owed.

**How to measure.** The debug panel (F3) shows frame time, main-thread time, draw calls, triangles and chunk build times. `window.__ti.view.perf` returns the same numbers, and `window.__ti.view.bench(120)` renders frames back to back, waiting for the GPU each time, so it shows headroom the display's refresh rate hides. The latest measurements are in "Visual foundation backlog".

## Where the renderer is today
As of visual-foundation milestone 5 (2026-11-12). Update this section as the visual foundation lands.

- `apps/client/src/render/look.ts`: **the look.** The palette, the shared uniforms (key light, sky fill, ground bounce, lanterns, the light on the parchment, grade, time, the known-world circle) and the master shaders every surface uses: ground, foliage (trees and ground cover), water, parchment, solid (avatars) and the soft blob shadow. New surfaces should be built from these, not from Three.js's stock materials, so they take the same light, lanterns, grade and ink-in.
- `apps/client/src/render/weather.ts`: **the weather and the seasons** (milestone 5), as plain numbers with unit tests. `apps/client/src/render/precip.ts` is the rain and snow in the air: one mesh, one draw call. See "Weather and seasons".
- `apps/client/src/render/wind.ts`: **the wind** (milestone 4). Direction and strength from the wall clock, as plain numbers with unit tests. The field itself (`windAt`) is in `look.ts`'s shared vertex code. See "Wind".
- `apps/client/src/render/day.ts`: **the day** (milestone 3). The clock (`hourAt`), the named arrangements (`TIMES`) and the table of lights, as plain numbers with unit tests. See "Time of day".
- **Lighting is per vertex and costs almost nothing per pixel.** Facets carry their face normal, so vertex lighting is flat shading. There are no Three.js lights, no shadow maps and no full-screen passes.
- **Shadows and ambient occlusion are baked when a chunk is built.** Each vertex stores how high the land (and forest canopy) rises toward the morning sun and toward the evening sun. The shader compares that with the sun's elevation, so long soft shadows follow the time of day for one byte per vertex per direction. The morning horizon is used until midday and the evening one after it, for the sun and for the moon alike.
- **The known world is a circle around the player** (44 tiles, `REVEAL_RADIUS`). Beyond it is blank parchment with a faint hand-ruled graticule every 64 tiles. In the 15-tile fringe the land is first a flat ink wash inside an inked outline, then rises as a pale paper relief, then takes its colour. This stands in for M5's explored area: M5 should replace `revealAt` in `look.ts` with a lookup of what has been explored.
- `apps/client/src/render/terrain.ts`: heightmap chunks streamed around the player, only inside the known world. Tile corners are nudged off the grid and each tile is split along its flatter diagonal, so the land reads as hand-cut facets. Water is its own mesh, built only where there is water, on the same corners as the ground so the shoreline lines up; it is tinted by depth, faceted by its own ripples, glints in the sun and has a foam line that laps at the shore. Steep hillsides show bare earth or stone in bands that follow the slope. Sand the water has just left is darker (the strand).
- `apps/client/src/render/flora.ts` and the `adorn` rules in `terrain.ts`: **what grows on the land** (milestone 2). Everything is decided from `(seed, x, y)`, is client-only and never affects walkability. A tile a player has edited is bare.
  - **Trees are instanced:** a broadleaf (31 triangles: trunk, a faceted crown and a side lobe) and a pine (21 triangles: trunk and three drooping tiers). About two forest tiles in three hold a tree, so the forest floor shows between them. Each is turned, stretched and tinted differently. Broadleaves fill the lowlands and pines take over as the land climbs, with the odd stand of each among the other. A few lone trees stand in open grass and cast a soft baked shadow.
  - **Ground cover is one merged mesh per chunk** (one draw call): grass tufts that thicken in the lusher patches, taller golden tufts and flower colonies in meadows, ferns and bushes on the forest floor, marram grass and pebbles on the beach, reed beds with seed heads in the shallows, stones that break the water, boulders and stunted pines on rock, dark stones in the snow.
  - Both use one vertex layout whose colour carries each vertex's height above its root (`lift`). The shader uses it to grow things out of the map at the edge of the known world, and the wind uses it to move tips more than roots.
- `apps/client/src/render/view.ts`: orthographic isometric camera, the parchment plane, avatars and the performance counters. An avatar is a placeholder **turned playing piece** in the player's colour (eight flat sides, a darker foot) with an HTML name label. It takes the baked shade of the ground it stands on, and lays a soft shadow along the slope, away from the sun and longer when the sun is low.
- `apps/client/src/render/atlas.ts`: a top-down 2D chunk painter, kept for the shared atlas (M5). Not used in-game yet.
- `apps/client/src/render/zones.ts`: debug-only zone border lines. They follow the true ground height, so they float over the flattened fringe.
- Biomes come from worldgen's tiles: deep water, water, sand, grass, forest, meadow, rock, snow.
- The HUD and debug panel are recoloured to parchment and sepia ink. Fonts and proper UI chrome are still to come.
- There is no audio or character model yet.

## Decisions
| Date | Decision | Why |
|---|---|---|
| After M2 | 3D isometric (Three.js) instead of 2D Pixi | Sid's call. |
| 2026-11-11 | Art style: low-poly diorama on a parchment map | It builds on the renderer that exists, hides the generated look of the terrain, stays small for a PWA, and can be produced reliably in code. |
| 2026-11-11 | Unexplored land is blank parchment that inks in | It makes the game's name and core loop (charting the unknown together) the look itself. |
| 2026-11-11 | Atlas, names and UI use old-cartography styling | Same reason: one theme across world and interface. |
| 2026-11-11 | Don't mass-produce game assets until the M5 mechanics are designed | Assets made ahead of the mechanics usually get remade. |
| 2026-11-12 | Build the visual foundation first: the parts that don't depend on mechanics | Lighting, shaders, biomes, time of day, weather and atmosphere define the look whatever the mechanics turn out to be. |
| 2026-11-12 | Performance target: stable 60 fps on a mid-range phone from about three years ago | Sid's requirement. Quality is pushed as high as that allows, no higher. |
| 2026-11-12 | Cohesion over variety; every asset is critiqued against this file before it's done | Sid's quality bar. |
| 2026-11-12 | Lighting, shadows and grading are done in the materials' own shaders, with terrain shadows baked per vertex; no shadow maps or full-screen passes | It gives layered light and long soft shadows at almost no per-pixel cost, which is where phones run out. Awaiting Sid. |
| 2026-11-12 | Ground colour belongs to hand-cut facets that blend across tile edges; player-made tiles stay crisp | It removes the grid-of-squares look while keeping what players build readable. Awaiting Sid. |
| 2026-11-12 | The known world is a 44-tile circle on blank parchment until M5 supplies real exploration | It makes "a diorama on a parchment map" literal from the first frame, hides chunk streaming and cuts what has to be drawn. Awaiting Sid. |
| 2026-11-12 | Screenshots and measurements use the world `vista` at fixed spots | Milestones stay comparable, and it keeps test sessions out of the default world. |
| 2026-11-12 | Trees are instanced; all other ground cover is merged into one mesh per chunk | Instancing keeps a forest's memory and build time small; merging keeps a chunk's whole undergrowth to one draw call. Awaiting Sid. |
| 2026-11-12 | Grass takes its colour from the ground it grows on; flowers grow in colonies of one kind | Cover should read as the land's texture. Scattering every colour everywhere reads as noise. Awaiting Sid. |
| 2026-11-12 | Two tree species placed by altitude and a slow noise, not at random | Where each grows tells the player something about the land. Awaiting Sid. |
| 2026-11-12 | The placeholder avatar is a turned playing piece, not a capsule | It fits "a diorama on a map" and needs no character design. Awaiting Sid. |
| 2026-11-12 | The hour comes from each player's wall clock (a 48-minute day), not from the network | Everyone sees the same light with no wire message and no protocol change. A world could later keep its own time if a mechanic needs it. Awaiting Sid. |
| 2026-11-12 | The moon travels the sun's arc twelve hours behind it | The shadows baked for the morning and evening sun then serve the night for nothing, and the key light can change hands while both are below the horizon. Awaiting Sid. |
| 2026-11-12 | Each arrangement sets how bright open ground is, and the lights are scaled to meet it | Brightness is authored directly, so no hour is blown out or murky, and weather can later change the mix of lights without changing the exposure. Awaiting Sid. |
| 2026-11-12 | The wind is one field, read from the wall clock, that every growing thing and the water sample | A gust that crosses grass, trees and water in turn makes the land feel like one place. It costs a few sines per vertex and no extra draw calls. Awaiting Sid. |
| 2026-11-12 | Crowns that would hide your explorer are thinned with a dither, not blended | Blending needs sorting and a second pass; a scatter of discarded pixels is free and reads as a soft cutaway. Awaiting Sid. |
| 2026-11-12 | Weather is five amounts on slow tides from the wall clock, not a set of states | It drifts in and out instead of switching, mixes freely (thin cloud, mist with drizzle), and needs no network. Awaiting Sid. |
| 2026-11-12 | Seasons, snow cover and wet ground are rules in the shaders, driven by four numbers | Nothing is rebuilt or re-uploaded when the year turns, so a season costs a few multiplications per vertex. Awaiting Sid. |
| 2026-11-12 | A storm is distant lightning and harder rain, with no bolts or strikes | The art direction rules out anything that suggests threat. Awaiting Sid. |
| 2026-11-12 | Milestone 7 (more biomes) is on hold until the new terrain generator (M4c) is merged | Sid's call. M4c adds lake, river, stream, cliff, desert, tundra, marsh and conifer-forest tiles and changes what the fixed screenshot spots show. |
| 2026-11-12 | Night is moonlit and readable, never dark; explorers carry lanterns | The game is calm, not threatening, and has to stay playable at any hour. The lantern makes night warm and makes company visible. Awaiting Sid. |

## Open questions
- **Audio source:** synthesised in code only, or mixed with CC0 packs?
- **References:** does Sid have specific works in mind?
- **Fonts:** which two faces?
- **M5 mechanics** (gathering, building, naming, the atlas, chat) aren't designed. The props, structures, resources, icons and sounds they need wait on that.

## Visual foundation backlog
The session building the visual foundation owns this section. It records the ordered backlog, what's done, the measured performance and anything waiting for Sid's approval, so a later session can pick up from it. Work is on the branch `claude/visual-foundation-f5eaa1`, one commit per milestone, not pushed.

### Order, and why
The order is by how much each step decides the look of everything after it. Each step is built on the one before, so none of them has to be redone.

| # | Milestone | Why here | Status |
|---|---|---|---|
| 1 | **Core look:** lighting model, grade, palette, master shaders, parchment and the ink-in edge, performance counters | Every later surface is built from these shaders and reads these uniforms. Getting them wrong means redoing everything. | **Done** |
| 2 | **Primary biome, fully realised:** temperate coast and woodland (sand, grass, meadow, forest, shallows). Real trees, undergrowth, grass tufts, rocks, flowers, reeds and shore detail; grounded avatars | It is the quality benchmark. Every other biome is judged against it and reuses its pieces. | **Done** |
| 3 | **Day/night cycle** and its key lighting arrangements (dawn, noon, golden hour, dusk, moonlit night) | The baked horizons and the grade were built for this in milestone 1. It has to come before weather, which bends the same lights. | **Done** |
| 4 | **Wind** and foliage sway, plus foliage detail | Needs the foliage from 2. Wind is one shared field that weather (5) then drives. | **Done** |
| 5 | **Weather** (rain, fog, snow, storms) and **seasons** | Layers on the lights (3) and the wind (4): each weather is mostly a setting of things that already exist, plus particles. | **Done** |
| 6 | **Atmosphere:** dust motes, light shafts, mist, fireflies, heat haze | Small, cheap layers whose timing depends on time of day and weather. | Next |
| 7 | **More biomes** and the transitions between them | Reuses everything above. See the finding below: worldgen has one climate today. | **On hold** until M4c is merged (Sid, 2026-11-12) |
| 8 | **Finishing:** variations, extra effects, loose ends from the list below | Polish last. | |

### Kept for later (found along the way)
- **Chunk generation belongs in a worker.** This is the biggest known risk to 60 fps on a phone. Building a chunk's mesh takes about 4 ms here on a desktop (plus generating its tiles and heights), so a phone will drop a frame each time new chunks stream in. It is sliced to at most about 4 ms a frame, which is not a fix. `packages/shared` is isomorphic, so it can run in a worker unchanged.
- **Pixel ratio on phones.** Still capped at 2. Try 1.5, or scale it by measured frame time.
- **Avatars** are a placeholder playing piece. Real characters wait for M5.
- **Other explorers outside the known world** are drawn at their true height while the land under them is flat map, so they float. Fade or flatten them with the fringe.
- **Trees do not block the explorer.** The piece passes through trunks. Crowns no longer hide it (milestone 4 thins them), but only for your own explorer: others still disappear under the canopy.
- **The wind is computed for every plant even when zoomed out,** where the sway is smaller than a pixel. If a phone's vertex load is too high, fade the sway out below about 12 pixels a tile and keep only the sheen.
- **Water does not freeze** in winter, and rain makes no splash on the ground.
- **A bare tree is a thinner, twig-coloured crown,** not branches. It reads at the game's scale; a real winter model would be better up close.
- **Flowers bloom all year** except under snow. Tying each kind to its season needs a flag on the vertex.
- **The season rule finds green by colour,** so the golden meadow does not turn. A per-vertex "this grows" flag would be exact.
- **Rain is not stopped by tree crowns or hills:** a streak can be seen falling through a canopy.
- **Lanterns do not come on in a dark storm by day.**
- **The thinned crowns are a visible dot pattern** on a low-density screen. It is finer on a phone. A blue-noise pattern would look softer.
- **No level of detail.** Fully zoomed out, every tuft is still drawn (about 100–130k triangles). It is within budget; if a phone struggles, drop ground cover when zoomed out first.
- **Zone debug lines** float over the flattened fringe.
- **The night has no sky of its own yet.** The camera looks down at a map, so there are no stars or moon to see. Candidates for milestone 6: stars reflected in still water, fireflies, mist at dawn.
- **The moon is always full.** Phases would change how bright each night is.
- **The playing piece has no lantern on it.** The light simply centres on the piece. A real character (M5) should carry one.
- **Only four lanterns light the land at once** (yours and the three nearest). A crowd of explorers at night would need a cheaper way to show the rest, such as a glow sprite.
- **Lantern light is not shadowed.** It passes through hills and trees. It reaches 7.5 tiles, so this is hard to see.
- **A trail of explored land** that stays inked-in for the session would show the idea better than a moving circle. It overlaps M5's fog of war, so it needs Sid's say-so.

### Findings for Sid
- **Worldgen has one climate.** `tileAt` makes eight tiles from elevation and moisture, the same everywhere. "Additional biomes" (milestone 7) can be done two ways: client-only variation of the existing tiles by region (for example birch against pine, heath against meadow, chosen from a large-scale noise), which changes no world and no rule; or new tiles and a temperature map in `packages/shared`, which changes every existing world. The first is in scope; the second needs a decision.
- **The shadow of a forest stays after a player paves it.** Shadows are baked from the generated tiles, not the edited ones, so that a chunk and its neighbours always agree at their seam. It's a soft shade and hard to notice.
- **`.claude/launch.json` gained a `client-visual` entry** (the client on port 5174) so this worktree can run beside the main checkout.
- **Sea and lake are the same tile**, so reed beds grow on sea shores as well as lake shores. Telling them apart needs either a client-side flood fill or a worldgen change.
- **Paving a tile clears what grew on it**, and un-paving brings the same plants back, because plants come from the seed and position.
- **A new terrain generator (M4c) is being built on another branch** (Sid, 2026-11-12). It adds lake, river, stream, cliff, desert, tundra, marsh and conifer-forest tiles. When it is merged, the fixed screenshot spots will show different land, the `adorn` rules in `terrain.ts` will need rules for the new tiles, and the sea-and-lake finding above goes away.
- **`main` has moved ahead of this branch** (found in milestone 3). It merged milestones 1 and 2 and the M6 scale work, which raised `PROTOCOL_VERSION` from 6 to 7. This branch still speaks 6. Two consequences: this worktree's client cannot join the main checkout's signal server (it runs solo, which is all the visual work needs), and `npm run e2e` here reuses that server on :8787 and fails every test on the version mismatch alone. Milestone 3's e2e run was therefore made against this worktree's own signal server on another port. Merging `main` into this branch would fix both; that is Sid's call. `main` also touched `CLAUDE.md`, `debug.ts` and `main.ts`, which milestone 3 edits too.

### Measured performance
On the development machine only (desktop, GeForce GTX 1050, Chrome). **No phone has been tested; a real-device check is still owed.**

**After milestone 5** rain or snow adds one draw call and 960 triangles (480 quads, inside the 500-particle budget); fog, seasons and snow cover add none. No textures or passes were added. At the hills spot, fully zoomed out (146k triangles, 66–67 draw calls), a frame took 2.5–2.8 ms in clear weather, rain, storm, fog, snow, autumn and winter alike, the same as milestone 4. The ground and foliage vertex shaders are longer (season, snow and mist are a few dozen operations and four sines a vertex), which a desktop does not show and a phone might. A first run of these measurements read 3 to 6 ms while another session was using the machine; it was discarded and repeated.

**After milestone 4** the wind added no draw calls, triangles, textures or passes. It adds vertex work: about six sines for each foliage vertex and two for each water vertex. At the hills spot, fully zoomed out (140k triangles, 77 draw calls in that run), a frame took 2.65–2.9 ms, against 2.5–2.65 ms in milestone 3's run. That difference is inside this machine's run-to-run drift, so the cost here is at most about 0.2 ms. A phone's cost is unknown. Calm and breezy cost the same (the shader does the same work either way).

**After milestone 3** the day/night cycle added nothing measurable: no draw calls, no triangles, no textures and no passes. At the hills spot, fully zoomed out, a frame took 2.5–2.65 ms at golden hour and at noon and 2.5–2.6 ms at night with the lantern lit (146k triangles and 66 draw calls in that run, with the debug lines on). The lantern is a four-step loop in the vertex shaders and is skipped by day. Driving the light costs a few dozen multiplications a frame on the main thread.

After milestone 2, fully zoomed out (the whole known world in view, the worst case), in an 862×1234 window:

| Measure | Coast (`at=-444,-516`) | Hills and forest (`at=744,612`) | Mountain (`at=816,48`) | Budget |
|---|---|---|---|---|
| Draw calls | 63 | 62 | 53 | 150 |
| Triangles | 102k | 129k | 88k | 300k |
| GPU + CPU per frame | 2.5 ms | 2.4 ms | 2.0 ms | 12 ms (on the phone) |
| Chunk build, warm | | about 4.2 ms mean over 42 chunks | | No dropped frame |
| Ground cover per chunk | | 1.9k triangles typical, 5k most (hard ceiling 15k) | | |
| Trees per chunk | | 122 typical, 508 most | | |
| Textures | 1 (a 128×128 grain, 16 KB) | | | 32 MB |
| Full-screen passes, shadow maps | 0 | | | 1 / 1 |

- **Milestone 2 against milestone 1:** draw calls went from 19–41 to 53–63 and triangles from 32–72k to 88–129k, for about 0.2 ms more per frame on this desktop (2.2 ms before, at a similar window size).
- **Chunk builds:** the ground cover first pushed a warm build from about 4 ms to about 7 ms. The builder was then tightened (slow noises sampled on a coarse lattice, flat lookup tables, blades written straight into buffers), which brought it back to about 4.2 ms with the cover included. Timings on this machine drift by tens of percent between runs, so treat these as rough.
- Milestone 1 measured 2.2 ms a frame at 1024×768, 3.7 ms at 2048×1536 and 0.8 ms of main-thread time per steady frame.

### Fixed spots for screenshots
World `vista`: `#w=vista&at=-444,-516` (coast, lake and forest), `#w=vista&at=744,612` (hills, forest edge, pond), `#w=vista&at=816,48` (mountain with snow). Zoom out fully to see the diorama on its map. Add `&time=afternoon` (the light milestones 1 and 2 were shot in) or another name from "Time of day", so the light holds still.

### Waiting for Sid
1. **The refined palette** (above): sage and olive greens, warm stone, teal water. Approve or steer.
2. **Facets that blend across tile edges, and corners nudged off the grid.** Tiles are no longer visible as squares, except what players build. A wall's edge can sit up to 0.16 of a tile from where collision puts it.
3. **The known world as a circle on parchment**, with the flat-wash, paper-relief, colour sequence at its edge and a faint graticule on the blank map.
4. ~~Late-afternoon light from the west as the default.~~ Replaced by the day/night cycle (items 10 to 13).
5. **HUD recoloured** to parchment and ink. It's a recolour only; real UI design is out of scope here.
6. **The woodland:** two species placed by altitude, about two forest tiles in three holding a tree, lone trees in open grass.
7. **Ground cover that is deliberately quiet:** grass coloured from its own ground, flowers in single-kind colonies, no red flowers.
8. **The playing-piece avatar** with its soft shadow, as the placeholder until characters are designed.
9. **Reed beds on every shallow shore**, sea included (see the finding above).
10. **A 48-minute day read from the wall clock**, the same for every explorer, with nothing sent over the network. Is 48 minutes the right length?
11. **Uneven hours:** the day lingers at dawn and through the golden hour and sunset, and hurries through noon and the night (about 10 of the 48 minutes are night).
12. **Night is moonlit, blue-green and readable, never dark,** and the parchment itself dims to slate.
13. **Every explorer carries a lantern** after sundown: a warm pool of light, which also makes other explorers visible from afar.
14. **A wind that is never still and never rough in fair weather** (0.12 to 0.7), read from the wall clock, with gusts that cross grass, trees and water in turn.
15. **Tree crowns thin to a scatter of pixels where they would hide your explorer.**
16. **Weather from the wall clock, mostly fair:** cloudy about a quarter of the time, rain about a seventh, storms rare, mist about a tenth. Are those the right odds?
17. **A 16-hour year** (4 real hours a season), so the season is different at the same time on different days. This means the game can open in winter. Is that the right length, and should a new player's first visit be held to summer?
18. **Autumn in ochre and russet, with no red,** and each tree turning in its own time.
19. **Winter as snow in drifts, bare broadleaves and green pines.**
20. **Storms are distant lightning only:** no bolts, nothing strikes.
21. **Mist lies in the low ground and leaves the hilltops clear,** instead of veiling the whole picture.
