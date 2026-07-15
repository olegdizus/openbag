import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// pnpm workspace aliases — @openbag/core resolves to packages/core/src,
// @openbag/api to packages/api/src, and tests reach the API Worker via the
// `@openbag/api` alias. The web-gui Worker is tested separately.
const coreSrc = resolve(root, "packages/core/src/index.ts");
const apiSrc = resolve(root, "packages/api/src/index.ts");

export default defineWorkersConfig({
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
    poolOptions: {
      workers: {
        wrangler: { configPath: "./packages/api/wrangler.jsonc" },
      },
    },
  },
});
