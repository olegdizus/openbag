// Markup-safe primitives shared across every page.

import { raw } from "hono/utils/html";
import type { Child } from "hono/jsx";

/**
 * Markup-safe passthrough for already-sanitized HTML (e.g. entry content that
 * passed through `sanitizeEntryHtml` on save). This is the only escape hatch
 * for injecting untrusted HTML into JSX output — Hono JSX auto-escapes string
 * children; `rawHTML(html)` returns a `HTMLEscaped`-marked string that bypasses it.
 */
export function rawHTML(html: string | null | undefined) {
  if (!html) return raw("");
  return raw(html);
}

/**
 * Escape arbitrary text for insertion as text content or an attribute value
 * (event handlers, `data-*`, query strings embedded in `href`, etc). Mirrors
 * the logic in `web-ui/js/app.js`'s `esc()` helper.
 */
export function esc(s: unknown): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Format a D1-stored datetime ("YYYY-MM-DD HH:MM:SS" or already-ISO) as a
 * human-readable local-date string for display. Falls back to the raw input
 * when the date won't parse.
 */
export function fmtDateTime(stored: string | null | undefined): string {
  if (!stored) return "";
  const iso = stored.includes("T") ? stored : stored.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return stored;
  return d.toLocaleString();
}

/**
 * Build a `/path?query` preserving the current query string, overriding the
 * listed keys. Used by list-page pagination/filter links (Hono-side).
 */
export function withQuery(currentSearch: string, overrides: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams(currentSearch);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

/** No-op helper to materialize an arbitrary Child (dates, numbers, …) as JSX. */
export function str(c: Child): Child {
  return c;
}
