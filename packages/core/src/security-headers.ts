/**
 * Defense-in-depth response headers. Mounted first in both Workers so every
 * response (including error paths) carries them.
 *
 * CSP for the API Worker covers the unauthenticated HTML surfaces (`/share/:uuid`,
 * `/oauth/v2/auth`) where entry content / query params are rendered — no inline
 * scripts, no frames. For the UI Worker, `style-src 'unsafe-inline'` is required
 * because Hono JSX inlines a `<style>` block per page (layout.tsx); scripts are
 * external bundles under `/c/*.js` so `script-src 'self'` stays strict.
 */
export interface SecurityHeaderOptions {
  /** Full Content-Security-Policy value. Omit to skip CSP. */
  csp?: string;
}

export function securityHeaders(opts: SecurityHeaderOptions = {}) {
  const { csp } = opts;
  return async (c: any, next: () => Promise<void>) => {
    await next();
    // Set on the outbound response. Using `.header` is idempotent-safe with Hono.
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    // No framing anywhere — kills clickjacking on /share and the UI alike.
    c.header("X-Frame-Options", "DENY");
    if (csp) c.header("Content-Security-Policy", csp);
  };
}

/** Strict CSP for the JSON + simple-HTML API Worker (no inline styles/scripts). */
export const API_CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** CSP for the UI Worker — allows the per-page inline `<style>` block. */
export const UI_CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
