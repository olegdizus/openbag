// Test bindings. @cloudflare/vitest-pool-workers v0.13+ exposes `env` from
// `cloudflare:workers`, typed as `Cloudflare.Env` — augment that namespace so
// integration tests see the bindings declared in packages/api/wrangler.jsonc
// (DB + ALLOWED_REGISTRATION). The test pool exposes them via the same shape.

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    ALLOWED_REGISTRATION?: string;
  }
}
