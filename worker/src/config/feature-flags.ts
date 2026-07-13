// Instance-wide feature flags sourced from Worker env vars (wrangler `vars`
// block, Cloudflare dashboard Variables, or `wrangler secret put`).

/**
 * True when account registration is permitted via the GUI/API.
 *
 * Reads `ALLOWED_REGISTRATION` from env. Defaults to enabled (true) when the
 * variable is unset, to preserve existing open-signup behavior. Treated as
 * disabled only when explicitly set to "false", "0", or "".
 *
 * `env` is typed loosely (`any`) because route handlers attach via untyped
 * Hono apps; runtime behavior is what matters here.
 */
export function isRegistrationEnabled(env: any): boolean {
  const raw = env?.ALLOWED_REGISTRATION;
  if (raw === undefined || raw === null) return true;
  const v = raw.trim().toLowerCase();
  return v !== "" && v !== "false" && v !== "0";
}
