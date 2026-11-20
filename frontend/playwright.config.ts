import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Real-browser E2E suite. Playwright starts BOTH servers:
 *  - backend: fresh, freshly-seeded throwaway SQLite DB (backend/scripts/run_e2e_server.py) on :8010
 *  - frontend: production build (`next build` + `next start`) on :3010, pointed at the API via NEXT_PUBLIC_API_URL
 * Set E2E_REUSE=1 to reuse servers you started yourself, E2E_PYTHON to override the interpreter.
 */
const isWin = process.platform === "win32";
const repo = path.resolve(__dirname, "..");
const python = process.env.E2E_PYTHON || path.join(repo, ".venv", isWin ? "Scripts/python.exe" : "bin/python");
// Dedicated ports so the suite never collides with a dev/demo server already running on 3000/8000.
const API_PORT = Number(process.env.E2E_API_PORT || 8010);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3010);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
process.env.E2E_API_URL = API; // read by the spec
const reuse = !!process.env.E2E_REUSE;

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1, // one shared backend database; flows are ordered and stateful
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `"${python}" scripts/run_e2e_server.py --port ${API_PORT} --families 40`,
      cwd: path.join(repo, "backend"),
      env: { FRONTEND_URL: WEB },
      url: `${API}/health`,
      reuseExistingServer: reuse,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run build && npx next start -p ${WEB_PORT} -H 127.0.0.1`,
      cwd: __dirname,
      url: WEB,
      reuseExistingServer: reuse,
      timeout: 300_000,
      env: { NEXT_PUBLIC_API_URL: API },
    },
  ],
});
