import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// Mirror the `alias` block from wrangler.jsonc so Vite can resolve the
// @openbag/* workspace packages when transforming test files (wrangler's own
// alias only applies to the Worker bundle, not to Vitest's Vite layer).
const pkg = (name: string) => resolve(root, `packages/${name}/src/index.ts`);

export default defineWorkersConfig({
  resolve: {
    alias: {
      "@openbag/core": pkg("core"),
      "@openbag/auth": pkg("auth"),
      "@openbag/parser": pkg("parser"),
      "@openbag/api": pkg("api"),
      "@openbag/web": pkg("web"),
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
