// Feature flags read off `env`. Currently just the registration toggle.

/**
 * Instance-wide feature toggle for account registration. Treated as
 * enabled unless `ALLOWED_REGISTRATION` is explicitly a falsey value after
 * trimming (`"false"`, `"0"`, `""`, or whitespace-only). Defaults to
 * enabled when unset.
 */
export function isRegistrationEnabled(env: { ALLOWED_REGISTRATION?: string } | any): boolean {
  const raw = env?.ALLOWED_REGISTRATION;
  // Treat unset as enabled by default.
  if (raw == null) return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "");
}

