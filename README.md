# Terra Ignota

A co-op exploration MMO in an endless, unknown land. It runs peer-to-peer in the browser and installs as a PWA. Share a link and friends join you.

See [docs/PLAN.md](docs/PLAN.md) for the architecture and roadmap.

## Run locally

```sh
npm install
npm run dev            # signaling server on :8787 + client on :5173
```

Open http://localhost:5173 in two windows. Move with WASD or the arrow keys, drag on touch screens, zoom with the mouse wheel, and rotate the view with Q / E. To play from a phone on the same Wi-Fi, open `http://<your-LAN-IP>:5173`.

URL hash parameters:
- `w=<world>`: world id. Each id is a different procedurally generated world.
- `at=x,y`: spawn at a spot. The invite button adds this.
- `signal=wss://…`: use a specific signaling server.

## Test

```sh
npm run typecheck
npm test               # unit tests (worldgen, movement, zones)
npm run e2e            # real browsers connecting over WebRTC
npm run bots -- --bots 100 --zones 4   # load test: headless bots against a running signal server (--help for options)
```

## Layout

```
packages/shared   worldgen, movement, protocol (runs in browser and Node)
apps/client       PWA (Vite + Three.js)
apps/signal       signaling + zone directory server
apps/seed         always-on seed peer: keeps world edits on disk
apps/bots         headless bot swarm for load tests
```

## Deploy

The client deploys to GitHub Pages from `main` (Settings → Pages → Source: GitHub Actions). Multiplayer on the deployed site needs a signaling server. Set the `SIGNAL_URL` repository variable to its `wss://` URL. Until then, the deployed site runs solo, unless someone adds `#signal=` to the link.
