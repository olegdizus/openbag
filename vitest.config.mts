import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// pnpm workspace aliases — @openbag/core resolves to packages/core/src,
// @openbag/api to packages/api/src, and tests reach the API Worker via the
// `@openbag/api` alias. The web-gui Worker is tested separately.
const coreSrc = resolve(root, "packages/core/src/index.ts");
const apiSrc = resolve(root, "packages/api/src/index.ts");

export default defineConfig({
  // @cloudflare/vitest-pool-workers v0.13+ is a Vite plugin (cloudflareTest),
  // not the old defineWorkersConfig test-pool wrapper (ADR-0018).
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./packages/api/wrangler.jsonc" },
    }),
  ],
  resolve: {
    alias: {
      "@openbag/core": coreSrc,
      "@openbag/core/db": resolve(root, "packages/core/src/db/index.ts"),
      "@openbag/core/wire": resolve(root, "packages/core/src/wire-types.ts"),
      "@openbag/api": apiSrc,
      "@openbag/web-gui": resolve(root, "packages/web-gui/src/index.ts"),
    },
  },
  test: {
    // Integration tests live under tests/integration/; unit tests are
    // co-located next to their source — e.g. packages/core/src/auth/password.test.ts.
    include: [
      "tests/**/*.test.ts",
      "packages/**/*.test.ts",
    ],
  },
});
