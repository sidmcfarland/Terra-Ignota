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
```
Before pushing, run typecheck, test and e2e.

## Layout
- `packages/shared`: worldgen, movement, zones, protocol, tile cache. It must stay **isomorphic**, with no DOM or Node-only APIs, because it runs in the browser, the signal server and the seed peer.
- `apps/client`: Vite + Three.js PWA. `net/` holds the signaling client, WebRTC peer and zone session; `render/` holds the 3D terrain/view and the 2D atlas painter.
- `apps/signal`: WebSocket signaling + zone directory. It never relays gameplay.
- `apps/seed`: headless always-on peer. It dials every zone host over WebRTC (node-datachannel's polyfill, reusing the client's `Peer`) and keeps edits on disk.

## Conventions and gotchas
- **Node runs the `.ts` files directly** (type stripping, Node ≥ 22.18), with no build step. `erasableSyntaxOnly` is on, so don't use enums, namespaces or constructor parameter properties. Use `as const` objects and explicit fields. Imports use `.ts` extensions.
- **Movement must go through `step()` in shared.** The client predicts with it and the host validates against the same rules.
- **Terrain is a pure function of `(seed, x, y)`.** Never send it over the network. Changes to worldgen change every existing world.
- **Bump `PROTOCOL_VERSION`** in `packages/shared/src/protocol.ts` whenever a wire message changes. The signal server rejects mismatches.
- **e2e notes:** Chromium needs `--disable-features=WebRtcHideLocalIpsWithMdns` (set in `playwright.config.ts`) for local peers to connect. Tests load `#render=0` (headless WebGL is slow) and read game state from `window.__ti` (`cfg`, `self`, `session`).
- **URL hash parameters:** `w` (world), `at=x,y` (spawn spot), `signal` (signaling server override), `render=0`, `debug=1|0` (debug panel; also F3 or the HUD button, remembered in localStorage), `host=0|1` (override "Available to host" for this visit; the HUD toggle saves it), `time=dawn|morning|noon|afternoon|golden|sunset|dusk|night` or an hour such as `time=16.5` (holds the time of day still; without it the day follows the wall clock), `wind=0..1` (holds the wind at a strength; without it the wind wanders with the wall clock), `weather=clear|broken|overcast|rain|storm|fog|snow` and `season=spring|summer|autumn|winter` (hold the sky and the year; without them both follow the wall clock).
- **Deploy:** `.github/workflows/pages.yml` deploys from `main`. Build-time configuration comes from the repo variables `SIGNAL_URL` and `TURN_URL`.
