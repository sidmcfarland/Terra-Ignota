import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// A fresh, empty seed store for each run, so tests start with no edits on disk.
const seedData = join(tmpdir(), `terra-seed-e2e-${Date.now()}`);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      // Expose real host ICE candidates so local peers can connect without mDNS.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  webServer: [
    { command: 'npm -w @terra/signal start', env: { PORT: '8787' }, url: 'http://localhost:8787/health', reuseExistingServer: !process.env.CI },
    { command: 'npm run build && npm -w @terra/client run preview -- --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    {
      command: 'npm -w @terra/seed start',
      env: { SIGNAL_URL: 'ws://localhost:8787', SEED_PORT: '8788', DATA_DIR: seedData },
      url: 'http://localhost:8788/health',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
