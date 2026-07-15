// Test bindings for `cloudflare:test`. Augments the upstream
// `ProvidedEnv` interface so integration tests see the bindings declared in
// packages/api/wrangler.jsonc (DB + ALLOWED_REGISTRATION — and the test pool
// exposes them via the same shape).

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ASSETS: Fetcher;
    ALLOWED_REGISTRATION?: string;
  }
}
