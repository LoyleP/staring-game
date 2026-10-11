import { defineConfig } from '@playwright/test';

/**
 * Tests de bout en bout contre le serveur de développement HTTPS (`npm run dev:phone`).
 * Chaque test lance lui-même ses navigateurs (voir e2e/helpers.ts) pour pouvoir mélanger
 * les moteurs dans un même duel (ex. Chromium contre WebKit).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  workers: 2,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE ?? 'https://localhost:5173', ignoreHTTPSErrors: true },
  webServer: {
    command: 'npm run dev:phone',
    url: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
  },
});
