import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Tests that generate terrain run for seconds (a drainage region alone is a quarter of one), and the
    // test files run side by side. Under the default limit of 5 s the slowest test had about 6% to spare
    // and failed whenever another file was busy at the same time.
    testTimeout: 15000,
  },
});
