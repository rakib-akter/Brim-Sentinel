import { defineConfig } from "@playwright/test";

const frontend = "http://127.0.0.1:4175";
const backend = "http://127.0.0.1:8175";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: frontend,
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    ...(process.env["BRIM_CHROMIUM_PATH"]
      ? { launchOptions: { executablePath: process.env["BRIM_CHROMIUM_PATH"] } }
      : {}),
  },
  webServer: [
    {
      command: '"${BRIM_TEST_PYTHON:-python3}" tests/browser/serve_backend.py',
      env: { BRIM_BROWSER_BACKEND: backend, FRONTEND_ORIGIN: frontend },
      url: `${backend}/openapi.json`,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      command: "bun run dev --host 127.0.0.1 --port 4175 --strictPort",
      env: { VITE_SENTINEL_API_URL: backend },
      url: `${frontend}/vendors`,
      timeout: 120_000,
    },
  ],
});
