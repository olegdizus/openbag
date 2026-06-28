// Central Worker bindings type.
//
// Note: `vars` from wrangler.jsonc and secrets set via `wrangler secret put`
// both land on `env` at runtime as plain strings.

export interface Env {
  DB: D1Database;
  BROWSER?: unknown;
  /**
   * Instance-wide feature toggle for account registration.
   * Treated as enabled unless explicitly set to a falsey value
   * ("false", "0", ""). Defaults to enabled when unset.
   */
  ALLOWED_REGISTRATION?: string;
}
