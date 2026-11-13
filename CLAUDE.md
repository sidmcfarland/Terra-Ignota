# Terra Ignota: notes for contributors and agents

A peer-to-peer co-op exploration MMO that runs as a PWA. Read **docs/PLAN.md** first. It has the architecture, milestone status, current limitations and decision log. Update it when a milestone lands or a decision changes. For anything visual or audio, read **docs/ART_DIRECTION.md** too. It is the source of truth for the look, the palette and the performance budgets, and it gets updated whenever an art decision is made.

## Commands
```sh
npm install
npm run dev        # signal server :8787 + Vite client :5173
npm run typecheck  # one root tsconfig covers every workspace
npm test           # vitest unit tests (packages/**, apps/**/*.test.ts)
npm run e2e        # Playwright: builds the client, starts signal + preview + seed, real WebRTC between pages
npm run dev:seed   # optional: a local seed peer (:8788) that keeps edits in ./data
npm run bots -- --bots 100 --zones 4   # headless bot swarm against a signal server (load test); --help lists the options
node scripts/terrain-hash.ts           # the terrain hash of a few worlds; `bun scripts/terrain-hash.ts` must print the same
```
Before pushing, run typecheck, test and e2e.

## Layout
- `packages/shared`: worldgen, movement, zones, protocol, tile cache. It must stay **isomorphic**, with no DOM or Node-only APIs, because it runs in the browser, the signal server and the seed peer.
- `apps/client`: Vite + Three.js PWA. `net/` holds the signaling client, WebRTC peer and zone session; `render/` holds the 3D terrain/view and the 2D atlas painter. Chunk meshes are built in a worker (`terrain-worker.ts`), so `render/chunk-data.ts` and `render/cover.ts` must not use three.js or DOM APIs; a unit test checks their imports.
- `apps/signal`: WebSocket signaling + zone directory. It never relays gameplay.
- `apps/seed`: headless always-on peer. It dials every zone host over WebRTC (node-datachannel's polyfill, reusing the client's `Peer`) and keeps edits on disk.
- `apps/bots`: headless bot swarm for load tests. Each bot is the client's `Session` run in Node, so `apps/client/src/net/{session,border,peer,signal,stats}.ts` must not use DOM APIs beyond WebRTC, WebSocket and `performance`.

## Conventions and gotchas
- **Node runs the `.ts` files directly** (type stripping, Node ≥ 22.18), with no build step. `erasableSyntaxOnly` is on, so don't use enums, namespaces or constructor parameter properties. Use `as const` objects and explicit fields. Imports use `.ts` extensions.
- **Movement must go through `step()` in shared.** The client predicts with it and the host validates against the same rules.
- **Terrain is a pure function of `(seed, x, y)`.** Never send it over the network. Changes to worldgen change every existing world: the golden hash moves (`GOLDEN_HASH` in `packages/shared/src/shared.test.ts` and `tests/e2e/terrain.spec.ts`), and `PROTOCOL_VERSION` must be bumped with it.
- **Worldgen and movement rules use only exact arithmetic:** `+ - * /`, `Math.sqrt`, `floor`, `abs`, `min`, `max`, `round`, `imul` and integer hashes. No `sin`, `cos`, `pow`, `exp`, `log`, `atan2` or `hypot` in `noise.ts`, `terrain.ts`, `hydro.ts`, `worldgen.ts`, `rng.ts` or `movement.ts` of `packages/shared`: engines may round those differently, and a host checks movement against the world it computes. A unit test enforces it. The renderer's `heightFromElevation` uses `pow` and is for display only; rules use the shared `heightOf`.
- **Rivers and lakes come from a drainage simulation per 3,072-tile region** (`packages/shared/src/hydro.ts`), cached, about a quarter of a second each. `groundAt` is the land before water and is cheap anywhere; `landAt`, `tileAt`, `generateChunk` and `elevationAt` include water and compute the region on the spot if it isn't held. So: never scan tiles far and wide with those (a spawn search or a map should rule places out with `groundAt` first), and in the client ask `RegionLoader` (`apps/client/src/regions.ts`) for regions ahead of need. Bots and tests just pay the quarter second.
- **Every drainage rule must stay local** (it may only depend on land within a fixed number of nodes), or regions stop agreeing at their edges. The margin a region computes around itself (`MARGIN` in `hydro.ts`) is derived from those distances: change one and the margin's sum changes with it. The tests "compute the same nodes whatever window they are computed in" and "agree with their neighbours where they overlap" are what catch a mistake.
- **Tile ids are append-only.** A new tile needs a rule (`isWalkable`, `isWading`) and a colour in both `render/chunk-data.ts` and `render/atlas.ts`, which throw without one. Rules depend on the tile only, never on render height.
- **Bump `PROTOCOL_VERSION`** in `packages/shared/src/protocol.ts` whenever a wire message changes. The signal server rejects mismatches.
- **The unreliable channel is binary.** A new or changed `Unreliable` message needs its encoder and decoder in `packages/shared/src/codec.ts` and a round-trip test. Reliable messages are JSON.
- **Hosts refer to players by number.** A host announces a player to a client once (`meet`) and then sends only its number. Snapshots carry just the players within the client's view radius (48 tiles in the e2e window, so tests must keep players that close to see each other).
- **Hosts budget every link** (`packages/shared/src/limits.ts`). If a message will be sent more often or get bigger, check the budgets. Catch-up edits are only accepted for chunks the host asked for.
- **Swarm runs:** start a signal server of your own first (`PORT=8797 node apps/signal/src/server.ts`) and pass `--signal ws://localhost:8797`. About 100 bots is what one older 4-core machine carries; docs/PLAN.md has the measurements.
- **e2e ports:** `E2E_SIGNAL_PORT` (8787), `E2E_SEED_PORT` (8788) and `E2E_CLIENT_PORT` (4173) move the servers Playwright starts, so several checkouts can run e2e on one machine. `E2E_REUSE=0` refuses to reuse a server that is already listening (unset: reuse unless `CI`). Example: `E2E_SIGNAL_PORT=8797 E2E_SEED_PORT=8798 E2E_CLIENT_PORT=4183 E2E_REUSE=0 npm run e2e`.
- **e2e notes:** Chromium needs `--disable-features=WebRtcHideLocalIpsWithMdns` (set in `playwright.config.ts`) for local peers to connect. Tests load `#render=0` (headless WebGL is slow) and read game state from `window.__ti` (`cfg`, `self`, `session`).
- **e2e positions:** each e2e world is new, so its terrain is random. A host takes its own position as it is, but moves a client only as far as it could have walked and never onto anything that blocks (deep water, snow, cliffs, walls). Don't teleport a client far and expect its host to follow: teleport the host, or let the client arrive by crossing a zone border (a joining client's position is taken as it is).
- **URL hash parameters:** `w` (world), `at=x,y` (spawn spot), `signal` (signaling server override), `render=0`, `debug=1|0` (debug panel; also F3 or the HUD button, remembered in localStorage), `host=0|1` (override "Available to host" for this visit; the HUD toggle saves it), `time=dawn|morning|noon|afternoon|golden|sunset|dusk|night` or an hour such as `time=16.5` (holds the time of day still; without it the day follows the wall clock), `moon=new|crescent|half|gibbous|full` or `moon=0..1` (holds the moon's phase, which sets how bright the night is; without it the moon follows the wall clock), `wind=0..1` (holds the wind at a strength; without it the wind wanders with the wall clock), `weather=clear|broken|overcast|rain|storm|fog|snow` and `season=spring|summer|autumn|winter` (hold the sky and the year; without them both follow the wall clock), `pr=1.5` (holds the canvas's pixel ratio; without it the ratio follows the measured frame time), `chunks=main` (builds chunk meshes on the main thread instead of the worker, for comparing the two), `map=1` (the top-down terrain overview instead of the game; with `scale=<tiles per pixel>` and `at=x,y` for its centre).
- **Deploy:** there is none yet, and it won't be GitHub Pages (a private repo needs a paid plan); hosting is decided at M7. A build reads `BASE_PATH`, `VITE_SIGNAL_URL` and `VITE_TURN_URL` from the environment. Signing needs a secure context, so the game only starts on `localhost` or over HTTPS, never on a plain `http://` LAN address.
