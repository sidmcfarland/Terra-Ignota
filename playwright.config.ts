import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Ports can be moved so several checkouts can run e2e on one machine at once:
//   E2E_SIGNAL_PORT (8787), E2E_SEED_PORT (8788), E2E_CLIENT_PORT (4173).
// E2E_REUSE=0 never reuses a server that is already listening (the run fails
// instead if a port is taken); E2E_REUSE=1 always reuses. Unset: reuse unless CI.
const port = (name: string, fallback: number) => Number(process.env[name]) || fallback;
const signalPort = port('E2E_SIGNAL_PORT', 8787);
const seedPort = port('E2E_SEED_PORT', 8788);
const clientPort = port('E2E_CLIENT_PORT', 4173);
const reuse = process.env.E2E_REUSE ? process.env.E2E_REUSE !== '0' : !process.env.CI;

// A fresh, empty seed store for each run, so tests start with no edits on disk.
const seedData = join(tmpdir(), `terra-seed-e2e-${Date.now()}`);

// The client finds the signal server on :8787 by default. On another port, the
// address is built into the client bundle the tests load.
const buildEnv: Record<string, string> =
  signalPort === 8787 ? {} : { VITE_SIGNAL_URL: `ws://localhost:${signalPort}` };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${clientPort}`,
    launchOptions: {
      // Expose real host ICE candidates so local peers can connect without mDNS.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  webServer: [
    {
      command: 'npm -w @terra/signal start',
      env: { PORT: String(signalPort) },
      url: `http://localhost:${signalPort}/health`,
      reuseExistingServer: reuse,
    },
    {
      command: `npm run build && npm -w @terra/client run preview -- --strictPort --port ${clientPort}`,
      env: buildEnv,
      url: `http://localhost:${clientPort}`,
      reuseExistingServer: reuse,
      timeout: 120_000,
    },
    {
      command: 'npm -w @terra/seed start',
      env: { SIGNAL_URL: `ws://localhost:${signalPort}`, SEED_PORT: String(seedPort), DATA_DIR: seedData },
      url: `http://localhost:${seedPort}/health`,
      reuseExistingServer: reuse,
    },
  ],
});
