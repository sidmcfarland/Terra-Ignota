# Terra Ignota — Art Direction

This file is the source of truth for how the game looks and sounds. Read it before making or changing any visual or audio work, and update it in the same change whenever a decision is made or reversed. Architecture and milestones live in [PLAN.md](PLAN.md).

Each entry is marked **Decided** (Sid agreed), **Proposed** (a starting point nobody has confirmed; refine it, then record what you chose and why), or **Open** (needs Sid).

## Theme
**Decided.** *Terra Ignota* means "unknown land". The game is a co-op exploration of an endless world that starts out unknown and is charted together into a shared atlas.

- **The unexplored world is blank parchment.** As players explore, the land "inks in" and rises from the map into a 3D miniature.
- **Everything players make together is cartography:** the atlas, place names, waystations and markers use old map-making language (ink lines, compass roses, hand-lettered labels, cartouches).
- **The player is an explorer and map-maker,** not a fighter. Nothing in the look should suggest combat or threat.
- **The land is uncharted, not untouched** (M5 design, decided 2026-11-12). The seed places old ruins and wrecks among its natural wonders: an overgrown gate, a ruined tower, a shipwreck, standing stones. They are wordless, with no inscriptions or lore. The world's real history is what players build and then leave: after 60 untended days a piece becomes a relic, grown into the land, for later explorers to find.

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

- **Quiet wonder.** The feeling of unfolding a map of somewhere nobody has charted. (It read "somewhere nobody has been" until the M5 design put ruins in the world.)
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
**Decided.** Chosen in visual-foundation milestones 1 to 3 and approved by Sid on 2026-11-12. The code is `apps/client/src/render/look.ts` (water, trees, cartography), `day.ts` (the light, hour by hour) and, in `terrain.ts`, the `GROUND` table and the plant colours beside it.

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
| Lake bed, deep | `#283E42` | `#304848` | Peat. Darker and greener than the sea bed |
| Lake bed, shallows | `#7A8664` | `#92946E` | Silt and weed |
| Marsh | `#566442` | `#768050` | Wet olive and moss. Dark pools `#384846` stand where it is lowest |
| Conifer forest floor | `#4A5C42` | `#626648` | Needle litter: browner and darker than under broadleaves |
| Desert | `#D4AA70` | `#E8C488` | Apricot and ochre, deeper than the pale beach. Dune ripples cross it |
| Tundra | `#829074` | `#A28E6E` | Lichen green drifting into russet heath. Frost `#E2E8EE` lies in patches all year |
| Cliff | `#A8967E` | `#BEAC92` | Warm buff stone with darker bedding seams |
| Stream bed, river bed | `#969680`, `#3A4E54` | `#AAA488`, `#42585A` | Pebbles under a stream, seen through its water; a dark bed under a river, hidden by it |
| Path (player-made) | `#B89C74` | | Drawn crisp, never blended |
| Wall (player-made) | `#68625A` | | Drawn crisp, never blended |
| Bare earth (steep green slopes) | `#9E8666` | | Faces too steep to hold grass |
| Bare stone (steep rock and snow) | `#766C62` | | |

| Other surfaces | Hex | Notes |
|---|---|---|
| Water, shallow | `#7FC0BD` | Blends to deep over 2.4 tiles of depth; 60–96% opaque |
| Water, deep | `#2F6687` | |
| Lake water, shallow | `#8FB89A` | Greener than the sea |
| Lake water, deep | `#2A5458` | Darker and greener. A lake lies stiller than the sea and has only a thin pale line at its edge, no surf. Rivers and streams use the same two colours: all fresh water is one family |
| Shore foam | `#F4EFE2` | A thin line that breathes in and out |
| Broadleaf crown | `#41653F` to `#8AA65A` | Ramp from the shaded underside to the sunlit top. Each tree is tinted a little cooler or warmer by where it stands |
| Pine | `#2C4A3D` to `#587D5E` | Darker and bluer than broadleaf, so a stand of pine reads at a glance |
| Trunks | `#6B5137` (broadleaf), `#574333` (pine) | |
| Bush | `#466C40` to `#96AE62` | |
| Stone | `#706860` to `#BCB2A0` | Mossy among grass (`#9EA678` on top); darker and wet in the water |
| Reed | `#566C44` to `#BEB476`, seed head `#604430` | |
| Marram (beach grass) tip | `#E6E0AE` | |
| Desert: dry grass tip, sage, dead twigs, sandstone | `#E2CE96`, `#7C7A5C` to `#BAB488`, `#604E3E`, `#967050` to `#D4AA78` | Sparse, and gathered where the sand is darker |
| Tundra: heath tip, dwarf shrub, lichened stone, cotton-grass | `#9E7868`, `#544E40` to `#806C56`, `#7C7E70` to `#BCC0AA`, `#F6F4EC` | Nothing stands tall |
| Marsh sedge tip | `#B0AA68` | Tussocks; reeds in the pools; marsh marigold (the buttercup yellow) between |
| Bilberry (conifer forest floor) | `#3A543E` to `#6C8458` | |

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
**Decided.** Chosen in visual-foundation milestone 3 and approved by Sid on 2026-11-12. The code is `apps/client/src/render/day.ts` (the clock and the table of lights) and the `Look` class in `look.ts` (which turns an hour into the shared uniforms).

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
- **The moon follows the same arc twelve hours behind,** so it rises as the sun sets. The terrain's baked shadows therefore serve both, and a moonlit night has long soft shadows of its own.
- **The moon has phases** (milestone 8). It goes from new to full and back over eight days (6.4 hours of play), read from the wall clock like the hour, so every explorer has the same moon. The night in the table is a full moon's. With less moon:
  - the moon's own light weakens, to a quarter under a new moon, so moon shadows fade but starlight still gives the land its form;
  - open ground darkens, by 28% under a new moon (0.18 against 0.25);
  - the moon's glint leaves the water and the stars lying in it show half as bright again;
  - lanterns are unchanged, so they matter more.
  - Sundown and first light are the same under any moon: the dark comes on with the night.
  - `#moon=new|crescent|half|gibbous|full` (or how much is lit, 0 to 1) holds a phase; `window.__ti.view.setMoon(lit)` does the same and `null` hands it back to the clock.
- **The key light changes hands below the horizon.** As either body meets the horizon its light fades to nothing, so dusk and first light are lit by the sky alone.
- **Night is never dark.** Open ground at night is about a quarter as bright as in the afternoon (roughly half as bright to the eye), and a little under a fifth under a new moon. The picture is cooled and desaturated as the level falls, the way eyes see by moonlight.
- **The parchment takes the light too,** but only half its colour, so the map dims to slate at night and warms at sunset while staying paper.
- **Every explorer carries a lantern.** From sunset to just after sunrise a warm pool of light (`#FFAE62`, reaching 7.5 tiles) surrounds each explorer and flickers slightly. It lights the ground, trees, water and the piece itself. Yours always shows; up to three more go to the nearest other explorers. At night, another explorer is a warm light in the distance: company, in keeping with "shared, not lonely".
- **The day follows the wall clock, not the network.** One day lasts 48 real minutes and every explorer reads the same hour from their own clock. Nothing is sent. The hours are not spent evenly: the day lingers at dawn (about 5 minutes) and through the golden hour and sunset (about 8), and hurries through noon (about 5) and the night (about 10 of the 48).
- **`#time=`** holds the light still: a name (`dawn`, `morning`, `noon`, `afternoon`, `golden`, `sunset`, `dusk`, `night`) or an hour such as `#time=16.5`. `window.__ti.view.setHour(h)` does the same; `setHour(null)` returns to the clock. The debug panel shows the hour.

## Water
**Decided.** Built in visual-foundation milestones 1, 7 and 8 (2026-11-12). Sid approved the sea and the lakes' colours on 2026-11-12, and the rivers, streams and raised lakes of milestone 8 on 2026-11-13. The code is the water shader in `look.ts` and the height field and water mesh in `terrain.ts`.

- **Every water stands at its own level.** The sea is at height 0. A lake stands wherever its basin filled, a river falls along its course, and each is drawn there. The generator (M4c step 2) gives the surface; the renderer gives each corner of the map a ground height and, where it is wet, a water level.
- **How deep it is drawn.**
  | Water | Depth | What you see |
  |---|---|---|
  | Sea | The sea bed's own, about 1.3 tiles where it turns deep | Teal shallows to deep blue |
  | Lake | The generator's depth, drawn 8 tiles to its unit, as under the sea | Jade shallows over silt, dark green-teal over peat |
  | Stream | 0.22 of a tile | Pale, part see-through: the pebbled bed shows, stones break the surface, a few reeds stand at the edge. It looks wadeable, and is |
  | River | 0.9 of a tile | Dark and opaque: the bed is hidden. It looks deep, and blocks |
- **Fresh water darkens with depth sooner than the sea,** so a river a tile deep already reads as deep.
- **The current shows.** Streaks of lighter and darker water are drawn out along a river or stream and carried down it, about a tile and a half a second. The direction comes from the generator's channel spans. Lakes and the sea have none.
- **White water.** Where the water's own surface is steep (a river dropping over a step, one lake spilling into another, a river falling to the sea), it breaks into foam that streams down the drop. This is read from the surface's slope, so it needs no data of its own.
- **The shoreline is cut by the land.** The water's surface is carried through the dry corners beside it at the level of the nearest water, so it runs flat under the bank and the ground itself makes the edge. That is how the sea's shore has always worked; it now works at any height.
- **An explorer wades** a quarter of a tile under the surface of whatever water they stand in.
- **The swell comes from real noise.** The surface heaves by the grain texture read at two scales that drift against each other. It was two sine waves, whose crests fell into rows; the sun's glint then lit the sea in a regular pattern of white patches (found in milestone 8, the same fault as the snow's polka dots).
- **Snow does not lie on a lake's or river's bed.** The ground mesh carries a flag for "under water".

## Wind
**Decided.** Chosen in visual-foundation milestone 4 and approved by Sid on 2026-11-12. The code is `apps/client/src/render/wind.ts` (direction and strength from the clock) and `windAt` in `look.ts` (the field every shader samples).

- **One wind for everything.** A direction, a strength from 0 to 1, and gusts that roll downwind across the land in broad, wandering bands about 30 tiles apart. Grass, flowers, reeds, bushes, trees and water all sample the same field, so a gust is seen crossing a meadow, reaching the trees and then ruffling the lake.
- **Supple things bend, stiff things rock.** A blade of grass leans downwind by up to about its own height in a gale and quivers out of step with its neighbours. The quiver is the same small amount whatever the plant's height, so a tall reed does not thrash. A tree's crown leans only a little and rocks slowly. Stones do not move.
- **A wood moves as one.** The rocking of trees is a wave that travels downwind, about 21 tiles long, and each tree is only a little out of step with it. Trees each rocking in their own time made a forest shimmer.
- **Bent grass is paler.** A gust lightens the blades it bends by a few percent, so wind shows as bands of sheen crossing a meadow even when the blades are too small to see move.
- **A facet's brightness changes only as the thing itself moves.** When a crown leans, its facets tilt with it, by the same amount and at the same moment, and the light on them follows. Nothing else may change a facet's brightness. (Milestone 4 tilted every facet's normal on a faster clock of its own, to suggest leaves turning. Sid saw it as crowns flashing "like Christmas lights", and it was removed in milestone 8: see "Flicker" under Measured performance.)
- **Water answers too.** Ripples grow with the wind, and a gust darkens the surface as it passes (a cat's paw).
- **Fair weather is never still and never rough.** On its own the wind wanders between 0.12 and 0.7 over minutes, from the south-west and swinging about 50° either way. Weather (milestone 5) will push it harder.
- **It follows the wall clock, not the network,** like the time of day. Every explorer feels the same breeze.
- **`#wind=0.8`** holds the wind at a strength from the prevailing direction; `window.__ti.view.setWind(s)` does the same and `setWind(null)` returns to the clock. The debug panel shows the strength.
- **Tree crowns thin out where they would hide you.** Crowns standing between your explorer and the eye are drawn as a faint scatter of their own pixels, so you can see yourself among the trunks. There is no blending and no sorting.
- **They thin over other explorers too** (milestone 8): the three nearest, the same ones whose lanterns show. The opening is a little smaller than your own and its crowns a little less bare (three pixels in ten kept at its heart, against two in ten over you), so you stay the subject. Company is not lost under the canopy.

## Weather and seasons
**Decided.** Chosen in visual-foundation milestone 5 and approved by Sid on 2026-11-12, with the year's length set by him and the snow's drifts corrected (both below). The code is `apps/client/src/render/weather.ts` (the sky and the year, from the clock), the `Look` class in `look.ts` (which bends the lights, wind and mist by them), the season and snow code in the ground and foliage shaders, and `precip.ts` (rain and snow in the air).

**Weather is five amounts, not a list of states:** cloud, rain, snow, fog and storm, each from 0 to 1. They rise and fall on slow tides read from the wall clock, so weather drifts in over minutes and never switches, and every explorer sees the same sky with nothing sent. Fair weather is the rule: cloudy about a quarter of the time, raining about a seventh, a storm about one minute in twenty, mist about a tenth.

| Weather | What it does |
|---|---|
| Cloud | The sun goes in (its light falls by up to four-fifths), the sky fill greys and brightens to take its place, shadows soften, colour drains by a fifth, and the glint leaves the water. Open ground is about a seventh darker. |
| Rain | Thin, slanted streaks in the air, bent by the wind. The land darkens by a fifth as it gets wet, the water is pocked with small bright rings, a light haze settles, and the wind picks up. |
| Storm | Rain at its heaviest, more wind, darker still, and **distant lightning**: now and then a double flicker that lifts the whole picture for under half a second. There are no bolts and nothing strikes: this is weather, not a threat. |
| Fog | Mist lies in the low ground and over water, thins with height and drifts on the wind, so hilltops and high forest stand clear of it. It takes the colour of the light, so it is rose at dawn and slate at night. Mist needs still air, so the wind drops. |
| Snow | Rain becomes snow as winter comes on: small, slow flakes that wander. Snow on the ground deepens while it falls. |

**The year** (Sid, 2026-11-12) has four seasons of 100 of the game's days each. A day is 48 real minutes, so a season is 80 real hours, and a year is 400 days: 320 real hours, or 13 days and 8 hours, just under two weeks. A season holds for two-thirds of its span and then gives way to the next, so the turn from one to the next takes about a real day. The game can therefore open in any season; Sid did not ask for a first visit to be held to summer.

| Season | What changes |
|---|---|
| Spring | Greens are fresher and a little yellower; broadleaf crowns are a lighter green. Colour is up 5%. |
| Summer | The reference. Everything in milestones 1 to 4 is summer. |
| Autumn | Broadleaves turn ochre `#BC9B50` to russet `#9B6945`, each tree in its own week and none completely, so a wood is a mix of green, gold and brown. Grass goes olive-gold. The sun is a little more golden. |
| Winter | Snow lies in drifts on whatever faces the sky: ground, stones, pine boughs, the tops of bare crowns. Grass under it is straw. Broadleaves are bare: a thinner, twig-coloured crown. Pines keep their needles. Colour is down 10% and the sun is paler. |

- **Autumn has no red.** The palette stops at russet, for the same reason no flower is red: vermilion is kept for the player's own marks.
- **Pines never change** except to carry snow. A stand of pine is where the green is in winter.
- **Snow is a rule in the shader, not new geometry.** Each surface whitens by how far it faces the sky and by where the drifts lie, so cover comes and goes in patches as the amount changes. Nothing is rebuilt.
- **Drifts come from real noise, and from the land.** Where snow lies is read from the paper's grain texture at two scales, which gives broad drifts with ragged edges and no pattern. Snow also goes first from slopes that face the midday sun. (The first version summed three sine waves. Cut off at a level, that leaves round bare patches in rows; Sid saw them as polka dots, and it was replaced on 2026-11-12.) **Rule for anything that covers or clears ground in patches: use the grain texture or other real noise, never a sum of a few sine waves.**
- **The seasons recolour by rule too:** anything green shifts, and sand, rock and what players build do not.
- **Flowers keep to their seasons** (milestone 8). Each kind is out in its own part of the year (the shares below are rough), and comes and goes flower by flower, each a little earlier or later than its neighbours, rising as it opens. Nothing flowers in winter.

  | Flower | Where | Spring | Summer | Autumn |
  |---|---|---|---|---|
  | Buttercup (yellow) | Grass and meadow | All | Six in ten | None |
  | Marsh marigold (yellow) | Marsh | All | Three in ten | None |
  | Thrift (pink) | The shore | Seven in ten | All | A few |
  | Oxeye daisy (white) | Grass and meadow | Half | All | A quarter |
  | Cotton-grass (white) | Tundra and marsh | Three in ten | All | Four in ten |
  | Harebell (lilac) | Meadow | None | Eight in ten | All |

  So a meadow is yellow in spring, white and lilac in summer, and thinly lilac in autumn. The table is `bloomsAt` in `weather.ts`. A flower's vertices carry its kind, and the shader leaves out the ones not in season; where every flower stands is unchanged from before.
- **Rain and snow are one mesh** of 480 small quads that fall through a box around the explorer and wrap. The vertex shader places every one. Nothing falls on the blank map: weather belongs to the land.
- **`#weather=clear|broken|overcast|rain|storm|fog|snow`** and **`#season=spring|summer|autumn|winter`** (or a point in the year from 0 to 4) hold them still. `window.__ti.view.setWeather(name)` and `setSeason(year)` do the same; pass `null` to return to the clock. The debug panel shows both.

## Atmosphere
**Decided.** Chosen in visual-foundation milestone 6 and approved by Sid on 2026-11-12, except a heat shimmer, which he had removed. The code is `apps/client/src/render/air.ts` (what is in the air, and when), `motes.ts` (the specks themselves) and small additions to the shared shader code in `look.ts`.

**Nothing here has a clock of its own.** Each layer's amount follows from the hour, the weather, the season and the wind, so the atmosphere is always the one that belongs to the moment.

| Layer | When | What it is |
|---|---|---|
| Cloud shadows | Whenever there is broken cloud | Slow shadows about 25 tiles across drift downwind over the land, with pools of sun between them. The sun is dimmed spot by spot, so a hillside brightens and darkens as they pass. This is the game's version of light shafts seen from above. |
| Dawn mist | From first light to mid-morning, in still air; thickest in autumn | Thinner and lower than a fog. It fills the hollows and sits on the water, then burns off. |
| Sunbeams | Whenever there is mist and the sun (or, faintly, the moon) is low | Long soft beams lie through the mist along the sun's direction, in the sun's own colour. |
| Dust and pollen | Dry daylight, most at dawn and in the golden hour; little in winter | Pale specks near the ground that drift with the wind and glint as they turn. |
| Falling leaves | Autumn, by day; more in a wind | Ochre and russet specks that come down tumbling, carried downwind. They take the dust's place. |
| Fireflies | Warm, dry nights from dusk into the small hours; fewer in a wind; none in winter | Small yellow-green lights (`#DDF981`) that wander near the ground and each glow for a moment at a time. They add light and hide nothing. |
| Stars in the water | Clear, calm nights | Fixed points in deeper water that twinkle. The night has no sky of its own from this camera, so the sky is shown where it would be reflected. |

- **Dust, leaves and fireflies are one mesh of 160 instanced quads** and one draw call. Only one kind shows at a time, and one gives way to the next by thinning to nothing first. Rain clears them, so with the 480 streaks of rain the total stays under the 500-particle budget.
- **Each mote keeps to a spot on the ground,** found by a height lookup, so fireflies sit over the grass on a hillside and not inside it. That is 160 lookups a frame.
- **There is no heat shimmer.** Milestone 6 made the light over bare sand and rock waver on a still summer noon. Sid looked at it over the desert at midday and had it removed (2026-11-12).
- **`#weather=broken`** shows the cloud shadows. `window.__ti.view.air` reports the amounts.

## Asset types and formats
**Decided at this level. No bulk asset production yet: see "Decisions".**

| Type | Format | Notes |
|---|---|---|
| Terrain, water, fog of war, lighting, weather, wind | Code and shaders | Most of what players see. Not files. |
| Props, structures, landmarks, characters | Low-poly geometry, built in code or as `.glb` (glTF) | One shared palette or ramp texture. Instanced. |
| UI icons, atlas map symbols, UI chrome, cursors, app icons | SVG | |
| Particle sprites, paper grain, ink masks | Small PNG or generated at load | |
| Fonts | Two open-licence faces | **IM Fell English** for place names and cartouches; **Alegreya Sans** for the interface (decided 2026-11-12). Both are believed to be under the SIL Open Font License: confirm at download. First needed in M5 slice 2. |
| Ambient beds, sound effects, music | See "Audio" | |

**The production list is [M5_DESIGN.md](M5_DESIGN.md), section 12:** every model, shader and effect, atlas symbol, icon, piece of UI chrome, font and sound M5 needs, each with the slice that first needs it. Assets are made slice by slice from that list, not ahead of it.

**What can be made well in code, and what can't:**
- **Strong:** low-poly models, SVG, shaders, procedural particle textures.
- **Usable but stylised:** synthesised audio (wind, water, clicks, chimes, plucks, pads).
- **Not possible in code:** high-quality rigged character animation, recorded audio, painted art. CC0 packs or a paid artist or composer would close this gap later. Downloading any pack needs Sid's OK.

## Audio
**The source is Decided (2026-11-12): every sound is synthesised in code** (the alternative was mixing in CC0 packs). The direction below is still Proposed. The sounds M5 needs are listed in M5_DESIGN.md, section 12; footsteps, ambience and music belong to the visual and audio foundation, not that list.

- **Ambient beds** per biome plus wind, sea, rain, night and caves.
- **Sound effects** for footsteps per surface, gathering, building, discovery, the atlas inking in, and UI.
- **Music:** calm exploration stems that layer with play, plus short stingers for discoveries and naming.

## Technical constraints
**Decided.**

- **Target: a stable 60 fps on a mid-range phone from about three years ago.** That means a frame in under 16.6 ms on the reference device, with headroom.
- **It's a PWA.** Download size and memory matter. Assets should be small and cached by the service worker.
- **Stack:** Three.js (`three` ^0.170) under Vite. WebGL, not WebGPU.
- **Terrain is a pure function of `(seed, x, y)`** and is never sent over the network. Changing `tileAt` or `elevationAt` in `packages/shared` changes every existing world. Visual work must not change them without flagging it to Sid.
- **Decoration must be deterministic.** Anything placed on the world (trees, rocks, grass) is derived from the seed and position, so every player sees the same place. It is client-only and must not affect walkability or any rule in `packages/shared`.
- **Landmarks and resource nodes will be frozen the same way.** M5 adds `landmarkAt` (slice 4) and `nodeAt` (slice 5) to `packages/shared`: overlays that place landmarks and veins from the seed without touching `tileAt` or `elevationAt`. Once each ships, changing its constants moves every landmark or node and orphans what players found and named there, so it is frozen like the terrain.
- **`packages/shared` stays isomorphic:** no DOM or Three.js there.
- **`#render=0` must keep working.** The e2e tests load the game without rendering.
- **Players can edit tiles** (Path, Wall, back to generated). A chunk's mesh is rebuilt when an edit lands. The rebuild jumps the queue and the old mesh stays on show until the new one is ready, two frames later on the development machine.

**Every asset and effect has a performance budget and stays within it.** Prefer techniques that look expensive but are cheap: baked or vertex lighting, gradient ramps, vertex animation, texture atlases, instancing, LODs, shader tricks over geometry.

**Proposed starting budgets for a typical view on the reference phone. Measure, then tighten or correct them here:**
| Budget | Limit |
|---|---|
| Frame time | 12 ms or less, leaving headroom under 16.6 ms |
| Draw calls | 150 or fewer |
| Visible triangles | 300k or fewer |
| Pixel ratio | The screen's own, capped at 2; lowered step by step towards 1 while frames run late, and raised again when they do not (see "Where the renderer is today") |
| Full-screen passes | One at most beyond the main render |
| Real-time shadow maps | None, or one at 1024 px, only if it measures within budget |
| Texture memory | 32 MB or less in total |
| Particles | 500 or fewer, instanced, in one or two draw calls |
| Chunk build | No main-thread time: chunks are built in a worker. Turning finished chunks into meshes (three a frame at most) must not drop a frame |

**Performance can't be measured on a real phone from a development session.** Use draw-call and triangle counts from `renderer.info`, frame times with CPU throttling, and say plainly that a real-device check is still owed.

**How to measure.** The debug panel (F3) shows frame time, main-thread time, draw calls, triangles, chunk build times (and whether they run on the worker) and how many chunks in view are not drawn yet. `window.__ti.view.perf` returns the same numbers, and `window.__ti.view.bench(120)` renders frames back to back, waiting for the GPU each time, so it shows headroom the display's refresh rate hides. The latest measurements are in "Visual foundation backlog".

## Where the renderer is today
As of visual-foundation milestone 7 (2026-11-12). Update this section as the visual foundation lands.

- `apps/client/src/render/look.ts`: **the look.** The palette, the shared uniforms (key light, sky fill, ground bounce, lanterns, the light on the parchment, grade, time, the known-world circle) and the master shaders every surface uses: ground, foliage (trees and ground cover), water, parchment, solid (avatars) and the soft blob shadow. New surfaces should be built from these, not from Three.js's stock materials, so they take the same light, lanterns, grade and ink-in.
- `apps/client/src/render/air.ts`: **the atmosphere** (milestone 6): how much dust, leaf-fall, fireflies, starlight and dawn mist the moment calls for, as plain numbers with unit tests. `apps/client/src/render/motes.ts` draws the specks: one instanced mesh, one draw call. See "Atmosphere".
- **Shader work that is not needed is skipped.** Snow, mist, cloud shadows, lantern light, rain rings and stars each sit behind a test of their own amount, so a clear summer afternoon pays for none of them.
- **Small things are dropped when the view is too far out to show them** (milestone 8). Zoom is CSS pixels to a tile, from 8 to 48.
  - **Ground cover** sinks into the ground between zoom 13 and 9.5, where a blade of grass is under three pixels tall, and below that its meshes are not drawn at all. Fully zoomed out this removes a third to a half of the triangles on open ground.
  - **Wind sway** stills between zoom 15 and 10, where a crown moves less than a pixel, and below that the wind is not worked out in the foliage shader at all.
  - Both fade, so nothing pops. In screenshots the land at zoom 9 without cover cannot be told from zoom 11 with it.
- **The canvas's pixel ratio follows the measured frame time** (`governor.ts`, milestone 8). A phone's frame cost is mostly pixels, and a ratio of 2 is four times the pixels of 1. When more than two frames in five run late for three quarters of a second, the ratio drops by 15%, down to 1 at the least. When frames have been on time for about five seconds, and no drop happened in the last half minute, it rises again. A ratio that proves too much is tried again less and less often, so it settles. A hidden tab, a single long frame and the first second and a half are ignored. A screen whose own ratio is 1 is never changed. `#pr=1.5` holds a ratio; `window.__ti.view.setPixelRatio(r)` does the same and `null` hands it back. The debug panel shows the ratio in force.
- `apps/client/src/render/weather.ts`: **the weather and the seasons** (milestone 5), as plain numbers with unit tests. `apps/client/src/render/precip.ts` is the rain and snow in the air: one mesh, one draw call. See "Weather and seasons".
- `apps/client/src/render/wind.ts`: **the wind** (milestone 4). Direction and strength from the wall clock, as plain numbers with unit tests. The field itself (`windAt`) is in `look.ts`'s shared vertex code. See "Wind".
- `apps/client/src/render/day.ts`: **the day** (milestone 3). The clock (`hourAt`), the named arrangements (`TIMES`) and the table of lights, as plain numbers with unit tests. See "Time of day". The moon's phase (`moonAt`) and what it does to a night's light (`moonOn`) are here too (milestone 8).
- **Lighting is per vertex and costs almost nothing per pixel.** Facets carry their face normal, so vertex lighting is flat shading. There are no Three.js lights, no shadow maps and no full-screen passes.
- **Shadows and ambient occlusion are baked when a chunk is built.** Each vertex stores how high the land (and forest canopy) rises toward the morning sun and toward the evening sun. The shader compares that with the sun's elevation, so long soft shadows follow the time of day for one byte per vertex per direction. The morning horizon is used until midday and the evening one after it, for the sun and for the moon alike.
- **The known world is a circle around the player** (44 tiles, `REVEAL_RADIUS`). Beyond it is blank parchment with a faint hand-ruled graticule every 64 tiles. In the 15-tile fringe the land is first a flat ink wash inside an inked outline, then rises as a pale paper relief, then takes its colour. This stands in for M5's explored area: M5 should replace `revealAt` in `look.ts` with a lookup of what has been explored.
- **Chunk meshes are built in a worker** (milestone 8), so a frame never waits for one.
  - `apps/client/src/render/chunk-data.ts` works a chunk's mesh out as plain typed arrays: ground, cliffs, baked shadows, water, ground cover (`cover.ts`) and where its trees stand. **It must not use three.js or the DOM,** because it runs in the worker; a unit test checks its imports.
  - `apps/client/src/terrain-worker.ts` runs it. The same script also computes drainage regions for `RegionLoader`; the game starts it twice, once for each job, so a region (a quarter of a second) never holds up a chunk.
  - `apps/client/src/render/terrain.ts` asks for chunks and turns the answers into geometries, which is cheap: the arrays are handed over, not copied, and go to the GPU as they are.
  - **Order:** a chunk an edit has changed first, then the nearest. Two are in the worker at a time, so it always has the next one waiting.
  - **Chunks are asked for 8 tiles before the view reaches them** and kept hidden until it does, so the worker's answer is never seen arriving. A chunk that no longer touches the view is hidden too (it was drawn before, as blank parchment).
  - **Regions are shared, not computed twice:** `RegionLoader` hands each region it computes to the chunk worker. A chunk whose region has not arrived computes it on the spot, in the worker.
  - A chunk's corner heights come back with its mesh, so the main thread does not work them out again for standing explorers on the ground.
  - **Without a worker** (it failed to start, or `#chunks=main`) the same builder runs on the main thread, 4 ms a frame at most, as before.
- **The land is heightmap chunks** streamed around the player, only inside the known world. Tile corners are nudged off the grid and each tile is split along its flatter diagonal, so the land reads as hand-cut facets. Steep hillsides show bare earth or stone in bands that follow the slope. Ground the water has just left is darker (the strand). **Water** is its own mesh, built only where there is some, on the same corners as the ground so the shoreline lines up; each corner carries its own level (see "Water"). `Terrain.heightAt` is the ground (the bed, under water), `waterAt` the water's surface over a spot and `surfaceAt` the top of whichever is higher.
- `apps/client/src/render/flora.ts` (the tree models), `cover.ts` (the ground-cover builder) and the `adorn` rules in `chunk-data.ts`: **what grows on the land** (milestone 2). Everything is decided from `(seed, x, y)`, is client-only and never affects walkability. A tile a player has edited is bare.
  - **Trees are instanced:** a broadleaf (31 triangles: trunk, a faceted crown and a side lobe) and a pine (21 triangles: trunk and three drooping tiers). About two forest tiles in three hold a tree, so the forest floor shows between them. Each is turned, stretched and tinted differently. Broadleaves fill the lowlands and pines take over as the land climbs, with the odd stand of each among the other. A few lone trees stand in open grass and cast a soft baked shadow.
  - **Ground cover is one merged mesh per chunk** (one draw call): grass tufts that thicken in the lusher patches, taller golden tufts and flower colonies in meadows, ferns and bushes on the forest floor, marram grass and pebbles on the beach, reed beds with seed heads in the shallows, stones that break the water, boulders and stunted pines on rock, dark stones in the snow.
  - Both use one vertex layout whose colour carries each vertex's height above its root (`lift`). The shader uses it to grow things out of the map at the edge of the known world, and the wind uses it to move tips more than roots.
- `apps/client/src/render/view.ts`: orthographic isometric camera, the parchment plane, avatars and the performance counters. An avatar is a placeholder **turned playing piece** in the player's colour (eight flat sides, a darker foot) with an HTML name label. It takes the baked shade of the ground it stands on, and lays a soft shadow along the slope, away from the sun and longer when the sun is low.
- `apps/client/src/render/atlas.ts`: a top-down 2D chunk painter, kept for the shared atlas (M5). Not used in-game yet.
- `apps/client/src/render/zones.ts`: debug-only zone border lines. They follow the true ground height, so they float over the flattened fringe.
- **Biomes come from worldgen's tiles** (M4c): sea and lake (each deep and shallow), sand, grass, broadleaf forest, conifer forest, meadow, marsh, desert, tundra, rock, cliff and snow. Each has two ground tones, its own plants, and its own rules in `adorn`. Where two meet, the facets between them take a mix of both, so there are no hard borders except cliffs.
- **Heights come from the shared rule's own curve** (`heightOf`), so a tile the rules call a cliff is drawn exactly as steep as the rule measured it.
- **Cliffs are sheer** (milestone 8). A cliff tile is not one steep slope: a vertical wall runs through it, with level ground above and below. How it is built, in `chunk-data.ts` (`cliffTile`):
  - Every corner near a cliff is on the upper or the lower side of the drop, by whether it stands above or below the middle of the heights around it.
  - The wall crosses each edge of a cliff tile that joins an upper corner to a lower one, half-way along, so it follows the cliff's contour from tile to tile and turns corners with it.
  - A corner that only cliff tiles touch is moved to the level, and takes the colours, of the open ground on its own side. Grass then runs to the cliff's edge and the beach to its foot, and the wall takes the whole drop.
  - **Open ground is never reshaped.** Tiles an explorer can stand on keep their true heights. Where a cut edge is shared with such a tile, the cliff tile closes the gap with a small upright bank, so the mesh has no holes.
  - Everything is decided per corner and per edge from generated tiles and heights, so neighbouring tiles and neighbouring chunks always agree.
  - A cliff a tile or two deep becomes one clean face. A broad mountain face that is cliff from top to bottom stays craggy, sloping rock.
- **Trees outside the known world are not drawn.** A chunk thick with trees splits them into four quarters, and quarters wholly beyond the known world are skipped; the shader also stops early for any tree that is not inked in yet. This halved the triangles in a forest.
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
| 2026-11-12 | Lighting, shadows and grading are done in the materials' own shaders, with terrain shadows baked per vertex; no shadow maps or full-screen passes | It gives layered light and long soft shadows at almost no per-pixel cost, which is where phones run out. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Ground colour belongs to hand-cut facets that blend across tile edges; player-made tiles stay crisp | It removes the grid-of-squares look while keeping what players build readable. Approved by Sid, 2026-11-12. |
| 2026-11-12 | The known world is a 44-tile circle on blank parchment until M5 supplies real exploration | It makes "a diorama on a parchment map" literal from the first frame, hides chunk streaming and cuts what has to be drawn. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Screenshots and measurements use the world `vista` at fixed spots | Milestones stay comparable, and it keeps test sessions out of the default world. |
| 2026-11-12 | Trees are instanced; all other ground cover is merged into one mesh per chunk | Instancing keeps a forest's memory and build time small; merging keeps a chunk's whole undergrowth to one draw call. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Grass takes its colour from the ground it grows on; flowers grow in colonies of one kind | Cover should read as the land's texture. Scattering every colour everywhere reads as noise. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Two tree species placed by altitude and a slow noise, not at random | Where each grows tells the player something about the land. Approved by Sid, 2026-11-12. |
| 2026-11-12 | The placeholder avatar is a turned playing piece, not a capsule | It fits "a diorama on a map" and needs no character design. Approved by Sid, 2026-11-12. |
| 2026-11-12 | The hour comes from each player's wall clock (a 48-minute day), not from the network | Everyone sees the same light with no wire message and no protocol change. A world could later keep its own time if a mechanic needs it. Approved by Sid, 2026-11-12. |
| 2026-11-12 | The moon travels the sun's arc twelve hours behind it | The shadows baked for the morning and evening sun then serve the night for nothing, and the key light can change hands while both are below the horizon. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Each arrangement sets how bright open ground is, and the lights are scaled to meet it | Brightness is authored directly, so no hour is blown out or murky, and weather can later change the mix of lights without changing the exposure. Approved by Sid, 2026-11-12. |
| 2026-11-12 | The wind is one field, read from the wall clock, that every growing thing and the water sample | A gust that crosses grass, trees and water in turn makes the land feel like one place. It costs a few sines per vertex and no extra draw calls. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Crowns that would hide your explorer are thinned with a dither, not blended | Blending needs sorting and a second pass; a scatter of discarded pixels is free and reads as a soft cutaway. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Weather is five amounts on slow tides from the wall clock, not a set of states | It drifts in and out instead of switching, mixes freely (thin cloud, mist with drizzle), and needs no network. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Seasons, snow cover and wet ground are rules in the shaders, driven by four numbers | Nothing is rebuilt or re-uploaded when the year turns, so a season costs a few multiplications per vertex. Approved by Sid, 2026-11-12. |
| 2026-11-12 | A storm is distant lightning and harder rain, with no bolts or strikes | The art direction rules out anything that suggests threat. Approved by Sid, 2026-11-12. |
| 2026-11-12 | The atmosphere has no clock of its own: every layer follows from the hour, weather, season and wind | Fireflies on a warm still night and mist at an autumn dawn feel right because they are consequences, not a random schedule. It also keeps every explorer's view the same. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Light shafts are done as cloud shadows on the land and beams in the mist, not as volumes in the air | The camera looks down at a map, so there is no sky to hang shafts from. Both are a few sines in shaders that already run. Approved by Sid, 2026-11-12. |
| 2026-11-12 | No heat shimmer | Sid looked at the wavering light over the desert at midday and chose to remove it. |
| 2026-11-12 | A season is 100 game days and a year 400 (just under two real weeks) | Sid's call, replacing the 16-hour year proposed in milestone 5. |
| 2026-11-12 | Patchy cover (snow) is cut from real noise, never from a sum of sine waves | Sid saw the sine-wave drifts as polka dots. A few sine waves always fall into a lattice once they are cut off at a level. |
| 2026-11-12 | A facet's brightness changes only as the thing itself moves | Sid saw crowns flashing: their lighting ran on a faster clock than their sway. Motion is now measured with the flicker harness before it ships. |
| 2026-11-12 | Each new biome is told apart by its ground first, its plants second, and by what is missing | A desert reads from its dunes and bare sand, tundra from frost and the lack of anything tall, marsh from dark pools and sedge. No new models were needed, so the world stays one family. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Lakes differ from the sea in the water itself: greener, darker, stiller, edged with reeds and no surf | A lake and a sea bay should never be confused at a glance, and the difference should be visible from far out. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Cliffs show bedding: level seams drawn by the ground shader from the height of each pixel | A bare steep facet is a grey smear. Seams that run level across a whole escarpment make it read as rock and as one continuous wall. It costs a few operations per pixel and no texture. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Cliffs are sheer walls cut through cliff tiles along the drop's contour; open ground keeps its true heights | Sid asked for sheer cliffs. Reshaping only what nobody can stand on means an explorer is always drawn on the heights the rest of the game uses, and what looks like a wall is exactly what blocks. Decided by Sid, 2026-11-12: "Keep it ragged". |
| 2026-11-12 | Ground cover and wind sway fade out as the view zooms out, and the work for them is skipped | A blade under three pixels and a sway under one cannot be seen, and fully zoomed out is the heaviest view. Sid's steer for milestone 8. Approved by Sid, 2026-11-13. |
| 2026-11-12 | The pixel ratio follows measured frame time, between the screen's own (capped at 2) and 1 | Pixels are most of a phone's frame cost, and sharpness is the cheapest thing to trade for 60 frames a second. Sid's steer for milestone 8. That it never goes below 1 was approved by Sid, 2026-11-13. |
| 2026-11-12 | Chunk meshes are built in a worker, asked for 8 tiles ahead of the view, and shown in place of the old mesh when ready | Building a chunk was the last main-thread cost that scaled with the device: 4 to 30 ms here, several times that on a phone. Sid's steer for milestone 8. That an edit shows two frames later was approved by Sid, 2026-11-13. |
| 2026-11-12 | The chunk worker and the region worker are one script started twice, and regions are handed from one to the other | One worker for both would stall chunks for a quarter of a second (more on a phone) whenever a region is computed; two that each computed regions would do that work twice. |
| 2026-11-12 | Crowns thin over the three nearest other explorers, as they do over your own | "Shared, not lonely": another explorer should read as company, not vanish in a wood. It reuses the lantern positions the shaders already have, so it adds no uniforms and no draw calls. Sid's steer for milestone 8. Approved by Sid, 2026-11-13. |
| 2026-11-12 | The moon has phases over an eight-day month, and they change only how bright the night is | A different night each time you play, for no cost. Keeping the moon's hours fixed keeps the approved rule that it rises as the sun sets, and the baked shadows with it. Approved by Sid, 2026-11-13. |
| 2026-11-12 | Each flower keeps to its season, decided in the shader from a kind carried on its vertices | The seasons were recolouring the land while its flowers stayed out all year. A table of numbers and one byte per vertex, with nothing rebuilt as the year turns. Approved by Sid, 2026-11-13. |
| 2026-11-12 | The renderer takes heights from the shared rule (`heightOf`) | What blocks the explorer must be exactly what is drawn. Merged with milestone 7. |
| 2026-11-12 | Milestone 7 (more biomes) is on hold until the new terrain generator (M4c) is merged | Sid's call. M4c adds lake, river, stream, cliff, desert, tundra, marsh and conifer-forest tiles and changes what the fixed screenshot spots show. |
| 2026-11-12 | Night is moonlit and readable, never dark; explorers carry lanterns | The game is calm, not threatening, and has to stay playable at any hour. The lantern makes night warm and makes company visible. Approved by Sid, 2026-11-12. |
| 2026-11-12 | Ruins and wrecks stand in the world, wordless; player-made relics are its history | Sid's choice in the M5 design (question 5) over natural wonders only. Four ancient landmark types, one landmark in three, no inscriptions or lore. |
| 2026-11-12 | The playing piece becomes a code-built explorer figure: hat, satchel, a cloak in the player's hue, procedural motion | M5 design, question 21. It is first needed in slice 5 (gathering), where the figure leans into its work. |
| 2026-11-12 | All M5 sounds are synthesised in code | M5 design, question 22. One source keeps the sound of the game as consistent as its look, and adds nothing to the download. |
| 2026-11-12 | Fonts: IM Fell English for place names and cartouches, Alegreya Sans for the interface | M5 design, question 23. An engraver's face for the map and a clean, warm face for reading. |
| 2026-11-12 | M5's assets are produced slice by slice from the list in M5_DESIGN.md, section 12 | The mechanics are designed now, which is what the 2026-11-11 decision waited for. |

## Open questions
- **References:** does Sid have specific works in mind?

Answered by the M5 design (2026-11-12): the audio source (synthesised in code), the fonts (IM Fell English and Alegreya Sans) and the M5 mechanics themselves (M5_DESIGN.md).

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
| 6 | **Atmosphere:** dust motes, light shafts, mist, fireflies, heat haze | Small, cheap layers whose timing depends on time of day and weather. | **Done** |
| 7 | **More biomes** and the transitions between them | Reuses everything above, on the M4c terrain. | **Done** for the six tiles M4c step 1 generates (lake, cliff, desert, tundra, marsh, conifer forest). Streams and rivers wait for M4c step 2 |
| 8 | **Finishing:** in the order Sid set on 2026-11-12, with river and lake water put first once M4c step 2 was merged: (1) sheer cliff faces, (1b) river, stream and lake water at their own levels, (2) phone-risk reductions that need no phone (drop ground cover and wind sway when zoomed out; scale pixel ratio by measured frame time), (3) other explorers hidden under tree crowns, (4) small polish (moon phases, seasonal flowers and the like) | Polish last. | **Done:** (1), (1b), (2), the chunk-mesh worker, (3), and for (4) moon phases and flowers in season. What is left is under "Kept for later" |

### Kept for later (found along the way)
- **Tiles near the player are still generated on the main thread,** a chunk at a time, because movement reads them synchronously (`step()`): 1.2 ms a chunk here (3.6 ms at worst), about one chunk for every 32 tiles walked. The harness does not time this (it is in the game's own loop, not in `view.frame()`). The heights under a spot no built chunk covers yet are also worked out on the main thread; in the measured runs that never happened.
- **Short pauses remain that are not chunks.** With the worker, the slowest frame in a 10-second run was 6 to 23 ms, in a frame where no chunk arrived and nothing was generated: most likely the browser collecting garbage. Chunk data is the largest thing allocated and freed as the land streams by.
- **Trees are still every tree at any zoom** (see "No level of detail for trees").
- **A cliff's rim and foot are a little ragged.** Next to the wall, the open ground and the wall-less cliff tiles keep their true heights, which tilt by up to a tile. A few facets there catch the light differently and read as notches. Smoothing them means reshaping ground an explorer can stand on, which this milestone chose not to do. **Sid chose to keep it this way (2026-11-12): "Keep it ragged".** This is settled, not a loose end.
- **A diagonal terrace is a run of short walls and banks,** not one straight face, because each wall has to end on a tile's edge. It reads as a rocky step.
- **Walls cast no shadow of their own.** Shadows are still baked from the height field, which sees the cliff as the slope it used to be. The shade is roughly right and softer than a sheer face would cast.
- **A waterfall is a ramp, not a fall.** Where a river drops several tiles in one, the water is one steep facet of streaming foam. A sheer fall would need the cliff builder to carry water.
- **Mist does not gather on a mountain lake.** It lies below a fixed height, measured from the sea.
- **Water does not freeze** (already listed), and a river in winter runs between snowy banks unchanged.
- **Avatars** are a placeholder playing piece. Real characters wait for M5.
- **Other explorers outside the known world** are drawn at their true height while the land under them is flat map, so they float. Fade or flatten them with the fringe.
- **Trees do not block the explorer.** The piece passes through trunks. Crowns no longer hide it (milestone 4 thins them), nor the three nearest other explorers (milestone 8). A fourth and any further still disappear under the canopy, though their name labels show.
- **Water does not freeze** in winter, and rain makes no splash on the ground.
- **A bare tree is a thinner, twig-coloured crown,** not branches. It reads at the game's scale; a real winter model would be better up close.
- **The season rule finds green by colour,** so the golden meadow does not turn. A per-vertex "this grows" flag would be exact.
- **Rain is not stopped by tree crowns or hills:** a streak can be seen falling through a canopy.
- **Lanterns do not come on in a dark storm by day.**
- **The thinned crowns are a visible dot pattern** on a low-density screen. It is finer on a phone. A blue-noise pattern would look softer.
- **No new tree for the new biomes.** Conifer forest uses the existing pine, taller and closer. A birch for the tundra's edge or a thorn tree for the desert would add variety; neither was needed to tell the biomes apart.
- **The desert has no cactus or palm.** It is dry scrub, which suits a temperate map. An oasis (palms by desert water) could come when rivers do.
- **Snow on tundra is the same as snow anywhere.** Tundra should hold snow earlier and longer than the lowlands. That needs a per-vertex climate value.
- **No level of detail for trees.** Ground cover and sway are dropped when zoomed out (milestone 8); every tree is still drawn at any zoom. Trees are most of the triangles in a forest (133k fully zoomed out in conifer forest). A cheaper far tree is the next lever if a phone needs one.
- **The pixel ratio governor has not met a real phone.** Its thresholds (what counts as late, how long to wait) are reasoned, and unit-tested against made-up frame times, not tuned on a device.
- **Zone debug lines** float over the flattened fringe.
- **Fireflies and dust do not know what is under them** beyond its height: fireflies drift over open water and sand as readily as over grass.
- **Motes are not lit by lanterns or shaded by hills.**
- **Cloud shadows do not fall on the parchment** or on the rain.
- **The moon's phase changes how bright the night is, not when the moon is up.** It still rises as the sun sets, whatever its phase, so the baked shadows go on serving it. There is no moon to see: the view never shows the sky.
- **The playing piece has no lantern on it.** The light simply centres on the piece. A real character (M5) should carry one.
- **Only four lanterns light the land at once** (yours and the three nearest). A crowd of explorers at night would need a cheaper way to show the rest, such as a glow sprite.
- **Lantern light is not shadowed.** It passes through hills and trees. It reaches 7.5 tiles, so this is hard to see.
- **The moving circle is temporary.** Sid approved the parchment, the graticule and the fade at the edge (2026-11-12), and noted that the M5 design replaces the moving circle with charted squares that stay inked in. `revealAt` in `look.ts` is the one place to change.

### What M5 needs from the renderer
From M5_DESIGN.md (sections 2, 4, 7 and 12). None of it is built; each item belongs to the M5 slice named.
- **The known world becomes a mask, not a circle** (slice 2). The mask is the charted map squares near the camera plus a soft sight disc of about 10 tiles around each explorer. It feeds the same ink-in edge the circle feeds today, through `revealAt` in `look.ts`. Charted squares stay inked in, so explored land no longer closes up behind the player: this is what replaces "the moving circle is temporary" under "Kept for later".
- **A tree must be swappable on its own** (slice 5). A felled tree is a stump, then a sapling, until it regrows. The swap has to toggle one instance, not rebuild the chunk's mesh, and visible chunks re-check regrowth about once a minute. Quarried rock and picked meadow are a vertex colour on the tile, not geometry.
- **One weathering treatment for every built piece** (slice 8): moss tint, sag, dropped parts and a faded hue, all driven by one value from 0 to 1, so no piece needs a second model. Trail overgrowth, wall rubble and the fallen cairn use it too.

### Findings for Sid
- **Worldgen had one climate.** Answered by M4c (merged 2026-11-12): six climates, real cliffs, and lakes apart from the sea. Milestone 7 styles them.
- **The shadow of a forest stays after a player paves it.** Shadows are baked from the generated tiles, not the edited ones, so that a chunk and its neighbours always agree at their seam. It's a soft shade and hard to notice.
- **`.claude/launch.json` gained a `client-visual` entry** (the client on port 5174) so this worktree can run beside the main checkout.
- **Sea and lake were the same tile.** Answered by M4c. Reed beds now grow only on lake shores and in marsh; the sea has none.
- **Paving a tile clears what grew on it**, and un-paving brings the same plants back, because plants come from the seed and position.
- **The renderer drew the land on a different curve from the one the rules use** (found in milestone 7). M4c's shared rule calls a tile a cliff when its corners differ by more than 1.2 tiles on the curve `heightOf` (30·u^1.5). The renderer was still drawing with its own older curve (30·u^1.6), so a cliff was drawn a little less steep than the rule measured. The renderer now calls `heightOf`, so what blocks you is exactly what you see. Mountains are about 5% taller as a result.
- **This branch is `main` plus milestone 7.** `main` was merged in on 2026-11-12 as a fast-forward (it already held milestones 1 to 6), which brought protocol 8. `npm run e2e` now takes its ports from the environment, so this worktree runs it beside the main checkout with `E2E_SIGNAL_PORT=8797 E2E_SEED_PORT=8798 E2E_CLIENT_PORT=4174 E2E_REUSE=0 npm run e2e`.
- **Cliffs were steep slopes, not vertical faces.** Fixed in milestone 8: see "Cliffs are sheer" above.
- **Streams, rivers and raised lakes had no water** until milestone 8: the renderer drew one water surface at sea level, so they showed as ground in a flat colour. They now have water at their own levels (see "Water").
- **The generator gives a channel no depth and no distance to its middle** (found in milestone 8), only its surface and its kind. So a stream or river is drawn at one fixed depth from bank to bank, and its banks step at the size of a tile. A distance to the channel's centre line in `Ground` would allow a bed that shelves and a smoother bank. It would not change any tile or rule.
- **Rivers drop steeply in places:** 72 spans within about 2,600 tiles of the `vista` spawn fall more than half a tile in a tile and a half, some by 3 tiles, including where a river meets the sea below a cliff. They are drawn as a slope of white water one tile long, not as a sheer fall.
- **One shared unit test ran close to its time limit.** `worldgen > gives the same answer whatever was asked before` takes 4.2 to 4.7 s on the development machine, against the default limit of 5 s. With one more test file running beside it (the chunk builder's, which computes a region) it failed about every other run, at 5.1 to 5.3 s. The limit for all tests is now 15 s (`vitest.config.ts`); the test itself is untouched. Sid, 2026-11-13: "Keep 15 s".
- **The renderer drew chunks nobody could see** (found building the worker). A chunk the view had moved off stayed in the scene until it was two chunks away, drawn as blank parchment over the paper. It is hidden now. This is the only difference between pictures from before and after the worker.
- **Two traps in measuring this renderer,** both met while measuring the worker:
  - A timing loop that makes a new `MessageChannel` for every pause makes thousands a second, and the browser's clean-up of them shows up as stalls of 60 to 400 ms inside whatever code is running. The harness reuses one.
  - Two captures of the same view do not match pixel for pixel unless the gust phase and the cloud drift are set first: both are added up frame by frame, so they carry the history of earlier frames. `same-picture.js` sets them.

### Flicker: how motion is measured
Nobody had watched the wind move before Sid did, and he found tree crowns flashing. Motion is now measured, not judged from stills.

**The method.** Hold the hour, season, weather and wind still. Replace the page's clock with one that steps a thirtieth of a second a frame, draw 240 frames (8 seconds), and read the canvas after each. Find the pixels a kind of mesh covers by drawing one frame with it hidden. For each of those pixels, record how far its brightness swings (highest minus lowest, over its mean) and how often it crosses its mean (the rate). To tell a change in lighting from a change caused by movement, repeat with the sway switched off in the live shader, and again with the lighting change switched off. The harness is in the shared notes folder as `flicker-harness.js`.

**What it found** (conifer forest at `#w=vista&at=144,48`, wind 0.6, 28 pixels a tile, 13,500 tree pixels):

| Tree pixels | Before | After |
|---|---|---|
| Brightness swing with the sway switched off, typical pixel | 5.3% | 1.3% |
| The same, the liveliest tenth of pixels | 34% or more | 3.3% or more |
| Share of pixels swinging more than 20%, sway off | 23% | 1.3% |
| Rate of that change | 0.81 times a second | 0.13 to 0.31 |
| Rate of the sway itself | 0.19 to 0.38 | 0.25 to 0.44 |
| Swing as shipped (light and movement together), typical pixel | 19% | 3.2% |
| Largest change between two frames, typical pixel | 5.4% | 1.8% |

- **The cause:** each facet's normal was tilted by its own sine wave, three to four times faster than the tree swayed and out of step with every other facet. The sway never touched the lighting at all, so colour changed with no relation to movement.
- **Ruled out:** normals are not rebuilt from moved positions (they are fixed per facet), and the wind's sheen is on grass only and is slow (it moved a typical grass pixel 1.8%, about once every four seconds).
- **What still changes:** with light and movement together, three pixels in ten still swing more than 20%. Those are pixels on the edge of a crown or between two of its facets, which a moving tree passes back and forth across. That is the movement itself, at the sway's own rate.
- **Reeds thrashed.** Their quiver grew with their height, so a reed flicked four times as far as grass. Rate of change for a reed pixel went from 0.81 to 0.44 times a second, and its largest frame-to-frame change from 15% to 10%.
- **Water after milestone 8's changes** (wind 0.6): the sea 2.5% for a typical pixel at 0.13 times a second; a lake 5.1% at 0.19; a river 6.9% at 0.56, which is its current. The river's streaks first ran twice as fast (9.7% at 0.94) and were slowed.
- **Grass and water were sound.** Grass changes with its own movement (typical pixel 13%, 0.44 times a second after the change). Lake and sea water change slowly: 6 to 11% for a typical pixel, about once every five seconds.

### Moon phases and flowers in season (milestone 8 step 4, 2026-11-12)
- **The moon, seen:** the river at night (`256,-256`, `#time=night`) under a full, a half and a new moon. The mean green of the open slope in the captures was 77, 72 and 66 of 255: a new-moon night is about a seventh darker on screen (28% less light). Moon shadows fade, and the stars in the river stand out more. It stays easy to read.
- **The flowers, seen:** the meadow at `216,-1400` in the four seasons. Spring shows mostly buttercups with some daisies; summer shows daisies and harebells with fewer buttercups; autumn shows harebells and little else; winter shows none.
- **Cost:** no draw calls, triangles or textures were added; one uniform of seven numbers was. Ground cover's baked shade went from three bytes a vertex to four (it was padded to four on the GPU already). A flower out of season is skipped at its first vertex test; one in season costs one table lookup.
- **Not checked:** neither was put through the flicker harness. The moon changes by under 13% of its range in a night, and a flower takes hours of play to open.

### Crowns over other explorers (milestone 8 step 3, 2026-11-12)
- **Seen:** in conifer forest (`144,48`) with four stand-in explorers around the player, one that showed only the tip of its head before is in plain view after. The fourth-nearest gets no opening, as designed.
- **Cost:** frames drawn back to back in that forest, with three others near and with none (median of five rounds of 60 frames): 4.3 against 4.1 ms fully zoomed out (134k triangles), 4.7 against 4.4 ms at zoom 14, 3.7 against 3.9 ms at zoom 26. That is 0.3 ms at most and inside the noise. With nobody near, the shader skips the work. No draw calls, triangles or uniforms were added.
- **Not checked:** the opening moving with a walking explorer was not put through the flicker harness. It is the same dither as over your own explorer, which was.

### Chunk meshes off the main thread (milestone 8, 2026-11-12)
**How it was measured.** `stream-harness.js` (in the session's shared notes folder) stops the game's own loop, moves the player itself, calls `view.frame()` every 16.7 ms and times each call, for 600 frames a run on a fresh page. Between frames it yields to the event loop without timers, so it works in a background pane. "Main thread" is the same build with `#chunks=main`. Its figures match two runs of the commit before the worker (95th percentile 6.9 and 7.6 ms, 99th 17.4 and 15.5 ms, 23 and 27 frames over 8 ms), so the switch is a fair stand-in for "before". Desktop only (GTX 1050, 862×1234 window); each cell is the range over two or three runs.

Main-thread time per frame while chunks stream in:

| Run (600 frames) | | 95th percentile | 99th percentile | Frames over 8 ms | Frames over 16.7 ms | Slowest frame |
|---|---|---|---|---|---|---|
| Open land at 24 tiles a second, fully zoomed out (30 chunks) | Main thread | 7.0–8.2 ms | 16.7–20.3 ms | 26–30 | 6–10 | 24–31 ms |
| | Worker | 1.6–2.6 ms | 2.1–3.8 ms | 0–1 | 0 | 6–11 ms |
| Conifer forest at 24 tiles a second, fully zoomed out (35 chunks) | Main thread | 7.3–7.9 ms | 15.3–15.6 ms | 22–28 | 3–4 | 17–26 ms |
| | Worker | 2.1–2.6 ms | 3.1–3.3 ms | 0–1 | 0–1 | 6–19 ms |
| Walking pace (6 tiles a second) at the default zoom (6 chunks) | Main thread | 1.4–2.0 ms | 1.9–7.9 ms | 4–5 | 0 | 13–16 ms |
| | Worker | 1.3–2.1 ms | 1.7–4.1 ms | 1 | 0–1 | 8–23 ms |
| A jump to fresh land (16 chunks at once) | Main thread | 1.7–2.7 ms | 11.5–15.3 ms | 7–13 | 0–2 | 14–26 ms |
| | Worker | 1.7–2.4 ms | 2.2–3.5 ms | 1 | 0–1 | 9–19 ms |

- **The worker's one slow frame per run is not a chunk.** Timed piece by piece, it fell in frames where no chunk arrived and no heights were generated: a pause by the browser, most likely garbage collection. The main thread's slow frames are chunk builds.
- **No chunk was ever missing from view while travelling** with the worker, at either speed: they are asked for 8 tiles ahead. After a jump, all 16 were drawn within 5 to 7 frames, against 11 on the main thread.
- **A build takes 4 to 11 ms in the worker** once the land around it is generated, and about 100 to 130 ms for the very first, which generates everything around it. None of that is main-thread time now.
- **Edits:** painting a tile showed in the mesh 2 frames later (33 ms) in 16 of 16 tries, standing still and while running with chunks streaming in. The slowest frame during any of them was 2.5 ms. Before, an edit was rebuilt in the same frame, at the cost of one build in that frame.
- **The picture is the same.** The commit before the worker and this one were run side by side and captured at eleven fixed views (river, cliffs, lake, conifer forest at two zooms, coast, white water, desert, tundra, marsh) with the clocks frozen. The land matched to within 2 levels in 255 at every pixel (two captures of one build differ by 1 in a few dozen pixels). The only other differences were the explorer's own colour (each page has its own) and, in two views, bare parchment where the old build drew a leftover chunk (see "Findings for Sid").
- **The built client works too:** `vite build` bundles the worker (40 KB), and the preview of it drew 16 chunks from the worker with no errors.
- **Not measured: a phone.** The gain should be larger there, since a build costs several times more and a frame has the same 16.7 ms. `#chunks=main` is there so the two can be compared on a device.

### Zoomed-out savings (milestone 8 step 2, 2026-11-12)
Fully zoomed out (zoom 8) in an 862×1234 window, before and after ground cover is dropped there:

| Spot | Triangles before | After | Draw calls before | After | Frame before | After |
|---|---|---|---|---|---|---|
| Terrace cliffs in grassland (`-1524,-1020`) | 76k | 36k | 51 | 44 | 2.5 ms | 1.9 ms |
| River in a valley (`256,-256`) | 91k | 54k | 72 | 56 | 3.2–3.4 ms | 2.1 ms |
| Lake and marsh (`352,144`) | 101k | 81k | 59 | 49 | 2.7 ms | 2.3 ms |
| Sandy sea coast (`1968,1200`) | 48k | 37k | 38 | 28 | 2.0 ms | 1.7 ms |
| Stream through conifer forest (`128,128`) | 172k | 149k | 93 | 80 | 3.7 ms | 2.8 ms |
| Deep conifer forest (`144,48`) | 154k | 133k | 75 | 67 | 3.1–4.1 ms | 3.0 ms |

- The "before" figures are the ones measured in milestones 7 and 8 on the same machine, not a same-run comparison.
- **Sway:** in conifer forest at wind 0.6, the share of pixels that change over one second is 0.01% at zoom 8 and 10 (still), 3% at 12.5, 7% at 15 and 12% at 28.
- **Pixel ratio:** the governor is unit-tested with made-up frame times. This desktop's screen has a ratio of 1, so it had nothing to lower here and was never seen to act on a real slow frame. Holding a ratio by hand (`setPixelRatio(1.25)`) resized the canvas as expected.

### Water at its own levels (milestone 8, 2026-11-12)
Fully zoomed out in an 862×1234 window, on the M4c step 2 terrain:

| Spot | Draw calls | Triangles | Frame |
|---|---|---|---|
| River in a valley (`256,-256`) | 72 | 91k | 3.2–3.4 ms |
| Stream through conifer forest (`128,128`) | 93 | 172k | 3.7 ms |
| Mountain lake below a snow slope (`960,-192`) | 67 | 75k | 3.0 ms |
| River dropping into a lake (`960,-802`) | 86 | 119k | 3.2 ms |
| Lake and marsh (`352,144`) | 59 | 101k | 2.7 ms |
| Sandy sea coast (`1968,1200`) | 38 | 48k | 2.0 ms |
| Budget | 150 | 300k | 12 ms on the phone |

- Water adds one draw call for each chunk that has any, as before; inland chunks with a river or lake now have one where they had none.
- The water shader reads the grain texture twice per vertex for the swell and, on rivers only, once per pixel for the current.
- **Chunk build, warm:** 4.8 ms mean (6.8 ms worst) over 14 chunks at the river.

### Snow drifts, the year and the heat (2026-11-12)
Three changes Sid asked for, checked after they were made:
- **Snow.** The polka dots were reproduced at the grassland spot (`-1524,-1020`) in winter, in early winter and in a light snowfall in summer, and in tundra. After the change the same views show broad, ragged drifts with no rows. Drawing the snow from the grain texture costs nothing measurable: the conifer-and-lake view took 2.65 to 3.04 ms in summer and 2.67 to 2.90 ms in winter, alternating.
- **Heat.** With the shimmer removed, the bare desert ground at a still summer noon does not change at all between frames half a second apart (0 pixels of the ground).
- **The year.** A unit test pins a season at 100 game days and the year at 13 real days and 8 hours.

### Measured performance
The numbers below are from the development machine only (desktop, GeForce GTX 1050, Chrome).

**First phone, 2026-11-13.** Sid played the production build of `main` on a Pixel 10, served over Tailscale HTTPS, and reported that it "works great". The debug panel's FRAME line read **10 to 12 ms average and 15 to 17 ms at the 95th percentile**. That figure is the interval between frames, so the screen's refresh rate paces it: on the Pixel's 120 Hz screen an on-time frame is 8.3 ms and one that misses a refresh is 16.7 ms. The reading therefore means roughly a fifth to two fifths of frames missed a 120 Hz refresh, almost none took longer than one 60 Hz refresh, and the game ran at about 85 to 100 frames a second. It does not say how long a frame's work takes, so it cannot be set against the 12 ms budget. The pixel ratio, the `cpu` line, the zoom and the place were not noted. A frame has to pass 19.5 ms before the governor counts it late, so the governor will not have acted. A Pixel 10 is a current flagship, well above the target; that it does not hold its own 120 Hz suggests the reference phone will be close to the limit at a pixel ratio of 2, which is a guess until one is measured. **With the pixel ratio held at 1 (`#pr=1`) Sid found the numbers "relatively unchanged".** So on this phone the missed refreshes are not the cost of pixels: they come from somewhere else (the main thread, vertex work, or how Chrome on Android paces frames at 120 Hz), and which one is not yet known. This is one device, and a fast one, but it is the first evidence against the governor's premise that a phone's frame cost is mostly pixels. If the same holds on the reference phone, lowering the pixel ratio will not rescue a slow frame there, and the levers would be triangles (a cheaper far tree) and main-thread work instead. **The `cpu` line read 0.8 ms average and 1.3 ms worst,** so the game's own code on the main thread is not the cost either (that figure covers the script inside a frame, not the GPU or the workers). With pixels and script both ruled out, what is left is vertex work on the GPU or the way Chrome on Android paces a 120 Hz screen; the second is the likelier, since a flagship GPU should make light work of this many triangles, but nothing here proves it. Comparing the FRAME line fully zoomed in and fully zoomed out would tell them apart: the triangle count changes severalfold, pacing does not. Taken together the readings withdraw the earlier guess: they show a phone with a great deal of headroom, not one near its limit, and they say nothing either way about the reference phone. **Still owed:** frame times on a mid-range phone from about three years ago (the reference device), and the pixel-ratio governor acting on a real slow frame. Playing on the phone also showed there was no way to zoom by touch; pinch to zoom was added the same day.

**After milestone 8, step 1 (sheer cliffs),** fully zoomed out in a 1277×1234 window. Walls add few triangles: a cliff tile goes from 2 triangles to between 6 and 12, and cliffs are about one tile in two hundred.

| Spot | Draw calls | Triangles | Frame |
|---|---|---|---|
| Sea cliff (`276,-2172`) | 68 | 90.5k (89.6k before) | 3.0 ms (3.0 ms before) |
| Terrace cliffs (`-1524,-1020`) | 51 | 76k | 2.5 ms |
| Mountain face by the desert (`-3216,720`) | 38 | 55k | 2.3 ms |
| Deep conifer forest (`144,48`), for comparison | 75 | 154k (unchanged) | 3.1 ms |

- **Chunk build, warm:** 5.1 ms mean (7.7 ms worst) over 14 chunks at the sea cliff. This spot was not measured before the change, so there is no before-and-after figure; conifer forest measured 4.3 ms in milestone 7.

**After milestone 7**, on the M4c terrain, fully zoomed out in a 1277×1234 window (larger than earlier milestones' 862×1234):

| Spot | Draw calls | Triangles | Frame |
|---|---|---|---|
| Deep conifer forest (`144,48`) | 75 | 154k | 3.1–4.1 ms |
| Conifer forest and lake (`144,-48`) | 82 | 140k | 3.6 ms |
| Lake and marsh (`352,144`) | 61 | 103k | 3.2 ms |
| Sea cliff (`276,-2172`) | 68 | 90k | 3.0 ms |
| Tundra (`336,1776`) | 39 | 57k | 2.4 ms |
| Desert (`-48,-720`) | 30 | 42k | 2.1 ms |
| Budget | 150 | 300k | 12 ms on the phone |

- **One regression, found and fixed.** Conifer forest first drew 249k–265k triangles at 4.5–5.1 ms: close to the triangle budget and the heaviest view yet. Most of those trees stood outside the known world, where they are drawn and then discarded. Trees are now split into quarters of a chunk and the quarters beyond the known world are skipped, the shader stops early for trees that are not inked in, and conifer density went from seven trees in ten tiles to six. That brought it to 140k–154k triangles and 3.1–4.1 ms, for 15 to 20 more draw calls.
- **Chunk build, warm:** about 4.3 ms mean (5.4 ms worst) over 11 conifer-forest chunks, after the same changes; it was 6.7 ms before them. The slowest cold build in the session was 39 ms, which includes generating the terrain around it. Building in a worker is still the main thing owed for a phone.
- The bedding seams add about six operations per ground pixel. That did not show here.

**After milestone 6** the motes add one draw call and 320 triangles when they show; cloud shadows, mist beams and stars add none. No textures or passes were added. At the hills spot, fully zoomed out (130k triangles, 63 draw calls), a frame took 2.8–3.1 ms on a clear summer afternoon and 3.1–3.3 ms with cloud shadows, dawn mist, fireflies, heat, falling leaves or snow at night. Milestone 5 measured 2.5–2.8 ms, so this is about 0.3 ms more, at the edge of this machine's run-to-run drift. Hiding the motes changed it by under 0.1 ms. The 160 height lookups a frame for the motes did not show in the main-thread time (0.8–0.9 ms a frame, as before).

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
World `vista`, on the M4c terrain. Add `&time=afternoon&season=summer&weather=clear&wind=0.3` so the light, the year and the sky hold still.

| Spot | Shows |
|---|---|
| `#w=vista&at=276,-2172` | A sea cliff with its bedding, conifers above, a cove below. The benchmark view |
| `#w=vista&at=352,144` | A lake with marsh along its shore and conifers behind |
| `#w=vista&at=144,-48` | Conifer forest meeting a lake |
| `#w=vista&at=144,48` | Deep conifer forest. The heaviest view to draw |
| `#w=vista&at=-48,-720` | Desert dunes |
| `#w=vista&at=336,1776` | Tundra with frost patches |
| `#w=vista&at=-1524,-1020` | Terrace cliffs stepping through grassland |
| `#w=vista&at=1968,1200` | A sandy sea coast |
| `#w=vista&at=256,-256` | A river in its valley |
| `#w=vista&at=128,128` | A stream through conifer forest, by the spawn |
| `#w=vista&at=960,-192` | A mountain lake below a snow slope |
| `#w=vista&at=960,-802` | A river dropping into a lake between cliffs: white water |
| `#w=vista&at=218,332` | A river reaching the sea across a beach |
| `#w=vista&at=550,-92` | A river running into a lake |

The spots used in milestones 1 to 6 (`-444,-516`, `744,612`, `816,48`) show different land now. Zoom out fully to see the diorama on its map.

### Decided by Sid (2026-11-12)
Sid answered every item that was waiting, through the coordinating session. The item numbers are the ones used in the check-ins.

**Approved as built**
- **The daytime look** (items 1, 2, 5, 6, 7, 8): the refined palette, facets that blend across tile edges with corners nudged off the grid, the woodland, quiet ground cover, the playing-piece avatar and the recoloured HUD.
- **The map** (item 3): the parchment, the graticule and the fade at the edge of the known world. M5 will replace the moving circle with charted squares that stay inked in.
- **The day** (items 10, 11): 48 minutes from the wall clock, with uneven hours.
- **The night** (items 12, 13, 23, 24): moonlit and readable, parchment dimming to slate, a lantern for every explorer, stars in the water, fireflies on warm still nights.
- **The wind** (items 14, 15): its strength and gusts, and crowns thinning over your explorer. The flashing crowns were a defect and are fixed.
- **The weather** (items 16, 20, 21, 22): from the wall clock at the odds given, storms as distant lightning, mist lying low, light shafts as cloud shadows and beams in the mist.
- **Autumn, winter and falling leaves** (items 18, 19, 26): no objection raised.
- **The six new biomes** (items 27 to 32), with the snow defect fixed.

**Changed**
- **Season length** (item 17): 100 game days a season, 400 a year, in place of the 16-hour year. Built.
- **Heat shimmer** (item 25): removed. Built.
- **Snow in polka dots** (a defect he found): drifts now come from real noise. Built.

**Overtaken**
- Item 4 (late-afternoon default light) by the day/night cycle, and item 9 (reeds on sea shores) by milestone 7.

**Decided later**
- **The sheer cliffs' rim** (item 33): "Keep it ragged". Walkable ground beside a cliff stays at its true heights, as built. No change.

### Decided by Sid (2026-11-13)
Sid answered items 34 to 44, all of milestone 8, through the coordinating session, each after looking at the dev client on the merged tree (`5ec8738`). Nothing was changed.

**Approved as built**
- **Fresh water** (items 34, 35, 36, 37):
  - streams pale and part see-through, rivers dark and opaque, in the lakes' two colours;
  - a visible current, as slow streaks carried downstream;
  - white water wherever water drops, drawn as a steep slope of streaming foam (a sheer waterfall stays under "Kept for later");
  - a gentler, irregular swell on all water.
- **Zoomed-out savings** (items 38, 39): ground cover fades out between zoom 13 and 9.5 and wind sway between 15 and 10; the pixel ratio never goes below 1.
- **The chunk worker's one visible cost** (item 40): an edit shows two frames later, not in the same frame, and the old mesh stays until then.
- **Crowns over other explorers** (item 42): they thin over the three nearest, a little less than over you. Beyond three, an explorer in a wood shows only as a name label.
- **The moon** (item 43): new to full and back over eight days, a new-moon night 28% darker than a full-moon one, and the moon's hours unchanged.
- **The flower calendar** (item 44): buttercups and marsh marigolds in spring, thrift, oxeye daisies and cotton-grass in summer, harebells into autumn, none in winter.

**Kept**
- **The unit-test limit** (item 41): "Keep 15 s" (`vitest.config.ts`, up from 5 s).

### Waiting for Sid
Nothing, as of 2026-11-13. New items continue from 45.
