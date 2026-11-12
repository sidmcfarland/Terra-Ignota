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
**The terrain colours below are what the renderer uses today. Treat them as the Proposed base; refine them into a deliberate palette and record the result here.**

| Tile | Hex | Notes |
|---|---|---|
| Deep water | `#18304A` | |
| Water (seabed tint) | `#3C7078` | |
| Water surface | `#2F6A8F` | 78% opacity plane at sea level |
| Sand | `#D8C690` | |
| Grass | `#5C9A46` | |
| Forest floor | `#487C3A` | |
| Tree canopy | `#2F5E2C` | |
| Meadow | `#8FB35A` | Scattered flowers: `#E6DC78`, `#EB96AA`, `#F0F0F0`, `#AA96E6` |
| Rock | `#807C70` | |
| Snow | `#ECF0F4` | |
| Path (player-made) | `#A88C68` | |
| Wall (player-made) | `#54524E` | |

| Light | Hex | Notes |
|---|---|---|
| Sun | `#FFF1DC` | Low, from the west-north-west |
| Sky fill | `#CFE3FF` | Hemisphere light, sky side |
| Ground bounce | `#3A2E22` | Hemisphere light, ground side |
| Background | `#0E1A24` | To be replaced by parchment |

**Proposed cartography colours** (for the unknown world, the atlas and the UI):
| Role | Hex |
|---|---|
| Parchment | `#E8DCC0` |
| Parchment shadow / fold | `#CDBE9A` |
| Sepia ink | `#3A2E22` |
| Faded ink | `#7A6A54` |
| Vermilion accent (markers, the player's own things) | `#B5482E` |
| Sea-chart blue wash | `#9DB8BC` |

**Rules:**
- Per-tile brightness varies by a few percent from a seeded random, so ground never looks flat-filled.
- Player colours come from a hue the player picks. Keep them the most saturated things on screen so explorers read instantly.
- Night, weather and seasons should shift the whole palette together (a grade or ramp), not recolour assets one by one.

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

## Where the renderer is today
As of M4b (2026-11-12). Update this section as the visual foundation lands.

- `apps/client/src/render/view.ts`: orthographic isometric camera, one directional sun, one hemisphere light, flat background colour. Players are coloured capsules with HTML name labels.
- `apps/client/src/render/terrain.ts`: heightmap chunks streamed around the camera. Each tile is two flat-shaded triangles with a vertex colour. Forest tiles get an instanced cone tree. Water is one translucent plane per chunk.
- `apps/client/src/render/atlas.ts`: a top-down 2D chunk painter, kept for the shared atlas (M5). Not used in-game yet.
- `apps/client/src/render/zones.ts`: debug-only zone border lines.
- Biomes come from worldgen's tiles: deep water, water, sand, grass, forest, meadow, rock, snow.
- There is no fog of war, day/night, weather, wind, post-processing, audio or character model yet.

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

## Open questions
- **Audio source:** synthesised in code only, or mixed with CC0 packs?
- **References:** does Sid have specific works in mind?
- **Fonts:** which two faces?
- **M5 mechanics** (gathering, building, naming, the atlas, chat) aren't designed. The props, structures, resources, icons and sounds they need wait on that.

## Visual foundation backlog
The session building the visual foundation owns this section. It records the ordered backlog, what's done, the measured performance and anything waiting for Sid's approval, so a later session can pick up from it.

*Not started.*
