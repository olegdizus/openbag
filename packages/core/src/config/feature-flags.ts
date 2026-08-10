/**
 * Instance-wide feature toggle for account registration. Fail-closed:
 * treated as **disabled** unless explicitly enabled. An enable is an
 * affirmative value other than the falsey set below (`"true"`, `"1"`,
 * `"yes"`, …). Unset / empty / `"false"` / `"0"` → disabled.
 *
 * This is the inverse of the old default, which enabled registration when the
 * var was unset — that made the privilege-escalation chain (self-register →
 * mint a client) the out-of-the-box state. Fail-closed forces a conscious
 * opt-in (H4). Provision the first admin out-of-band via `pnpm create-user`.
 */
export function isRegistrationEnabled(env: { ALLOWED_REGISTRATION?: string } | any): boolean {
  const raw = env?.ALLOWED_REGISTRATION;
  if (raw == null) return false; // fail-closed when unset
  const v = String(raw).trim().toLowerCase();
  if (v === "" || v === "false" || v === "0" || v === "no" || v === "off") return false;
  return true;
}
