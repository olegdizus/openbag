import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig, type Plugin } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const root = dirname(fileURLToPath(import.meta.url));

// pnpm workspace aliases — @openbag/core resolves to packages/core/src,
// @openbag/api to packages/api/src, and tests reach the API Worker via the
// `@openbag/api` alias. The web-gui Worker is tested separately.
const coreSrc = resolve(root, "packages/core/src/index.ts");
const apiSrc = resolve(root, "packages/api/src/index.ts");

// domutils@3 / entities@4 (transitive via linkedom -> htmlparser2) ship
// sourcemaps whose `sourceRoot` is a raw.githubusercontent.com URL. Vite runs
// that URL through path.resolve, lands on the project root, and warns
// "source file outside its package" for every file. Drop the external
// sourceMappingURL for any node_modules module whose referenced map points at
// a remote source root — the originals aren't shipped anyway.
function dropRemoteSourcemapDeps(): Plugin {
  return {
    name: "drop-remote-sourcemap-deps",
    enforce: "pre",
    async load(id) {
      if (!id.includes("/node_modules/") || !/\.[mc]?js$/.test(id)) return;
      let code: string;
      try {
        code = await readFile(id, "utf-8");
      } catch {
        return;
      }
      const m = code.match(/\/\/# sourceMappingURL=([^\n]+)/);
      if (!m || m[1].startsWith("data:")) return;
      try {
        const map = JSON.parse(await readFile(resolve(dirname(id), m[1]), "utf-8"));
        if (typeof map.sourceRoot === "string" && /^https?:\/\//.test(map.sourceRoot)) {
          return { code: code.replace(/\n?\/\/# sourceMappingURL=[^\n]+$/, "") };
        }
      } catch {
        // Map missing or unreadable — leave the file untouched.
      }
      return;
    },
  };
}

export default defineConfig({
  // @cloudflare/vitest-pool-workers v0.13+ is a Vite plugin (cloudflareTest),
  // not the old defineWorkersConfig test-pool wrapper (ADR-0018).
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./packages/api/wrangler.jsonc" },
    }),
    dropRemoteSourcemapDeps(),
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
