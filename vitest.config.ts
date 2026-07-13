import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// After the Phase 1/2/3 refactor, tests import worker/src via relative paths.
// The aliases below are kept for the rare test that still uses @openbag/worker
// (and to support easy migration to package-style imports later).
const workerSrc = resolve(root, "worker/src");

export default defineWorkersConfig({
  resolve: {
    alias: {
      "@openbag/worker": workerSrc,
      "@openbag/worker/auth": resolve(workerSrc, "auth/index.ts"),
      "@openbag/worker/parser": resolve(workerSrc, "parser/index.ts"),
      "@openbag/worker/sanitize": resolve(workerSrc, "sanitize.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
