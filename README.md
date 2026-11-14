# Terra Ignota

A co-op exploration MMO in an endless, unknown land. It runs peer-to-peer in the browser and installs as a PWA. Share a link and friends join you.

See [docs/PLAN.md](docs/PLAN.md) for the architecture and roadmap.

## Run locally

```sh
npm install
npm run dev            # signaling server on :8787 + client on :5173
```

Open http://localhost:5173 in two windows. Move with WASD or the arrow keys, or drag with one finger on a touch screen. Zoom with the mouse wheel or a two-finger pinch, and rotate the view with Q / E (there is no touch gesture for rotating yet). A phone can't use `http://<your-LAN-IP>:5173`: the game needs HTTPS anywhere but `localhost`, so see "Deploy" below for a phone link.

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

The game is served from GitHub Pages at https://sidmcfarland.github.io/Terra-Ignota/. `.github/workflows/pages.yml` builds and publishes it on every push to `main` (`npm run build`, output in `apps/client/dist`). A build reads `BASE_PATH`, `VITE_SIGNAL_URL` and `VITE_TURN_URL` from the environment; the workflow takes the last two from the repository variables `SIGNAL_URL` and `TURN_URL`. Neither is set, so the published game has no signal server and each visitor plays alone unless their link carries `#signal=wss://…`.

The game signs edits with WebCrypto, so it only starts on `localhost` or over HTTPS. To play from a phone on your own Tailscale network:

```sh
npm run build
npm -w @terra/signal start                                    # signal server on :8787
npm -w @terra/client run preview -- --strictPort --port 4174  # set __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS to your machine's ts.net name first
tailscale serve --bg --https=443 http://localhost:4174
tailscale serve --bg --https=8443 http://localhost:8787
```

Then open `https://<machine>.<tailnet>.ts.net/#signal=wss://<machine>.<tailnet>.ts.net:8443`. `tailscale serve reset` turns both off.

## Licence

Copyright (C) 2026 Sid McFarland.

Terra Ignota is free software: you can redistribute it and modify it under the terms of the GNU General Public License, version 3, as published by the Free Software Foundation. It comes with no warranty. The full text is in [LICENSE](LICENSE).

In short: you may use, copy and change the game, but anything you publish that is built from it must be released under the same licence, with its source, and must keep this notice.
