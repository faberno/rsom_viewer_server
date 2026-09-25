import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pages', timeout: 60000, workers: 1,
  use: {
    baseURL: 'http://localhost:4174/rsom_viewer_server/',
    launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: {
    command: 'npm run preview:pages -- --port 4174 --strictPort --base /rsom_viewer_server/',
    url: 'http://localhost:4174/rsom_viewer_server/',
    reuseExistingServer: false
  }
});
