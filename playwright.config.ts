import { defineConfig } from '@playwright/test';

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
    { command: 'PORT=8787 npm -w @terra/signal start', url: 'http://localhost:8787/health', reuseExistingServer: !process.env.CI },
    { command: 'npm run build && npm -w @terra/client run preview -- --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
