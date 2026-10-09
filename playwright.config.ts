import { defineConfig,devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const launchOptions={executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)};
export default defineConfig({
  testDir:'tests/e2e',fullyParallel:false,workers:1,timeout:45_000,
  use:{baseURL:'http://127.0.0.1:3000',trace:'off',screenshot:'off',video:'off'},
  projects:[{name:'desktop-chromium',use:{...devices['Desktop Chrome'],launchOptions}},
    {name:'mobile-chromium',use:{...devices['Pixel 7'],launchOptions}}],
  webServer:[{command:'npm run dev',url:'http://127.0.0.1:3000',reuseExistingServer:!process.env.CI,timeout:120_000},
    {command:'npm run worker',wait:{stdout:/PoC worker started/},reuseExistingServer:false,timeout:30_000}],
});
