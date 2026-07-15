---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0008"
title: "ADR-0008: Static assets served by the Cloudflare platform, not by the Worker"
status: "accepted"
date: "2026-06-10"
deciders: ["oleg"]
---

# ADR-0008: Static assets served by the Cloudflare platform, not by the Worker

> **Partially superseded (2026-07-13).** The SPA fallback portion of this
> ADR is superseded by
> [ADR-0017](0017-drop-spa-fallback-asset-binding.md). The platform-serves-static-files
> principle remains in force.

## Context and Problem Statement

The `web-ui/` directory ships static HTML, CSS, and vanilla JS files for the
browser interface (8 HTML pages, 9 JS files, 1 CSS file totalling ~1250 lines
as of mid-2026). Cloudflare Workers provides two mechanisms for serving these:

1. The platform-level `assets` block in `wrangler.jsonc` — Cloudflare's edge
   serves files directly, never invoking the Worker for static requests.
2. The `ASSETS` Fetcher binding — Worker code calls `env.ASSETS.fetch(req)` to
   proxy a request to the static directory.

Choosing between them is a routing decision: which layer decides "is this a
static file, an API call, or a 404"?

## Decision Drivers

- **Performance** — static files should never burn Worker CPU.
- **Operational simplicity** — fewer Worker code paths that can break.
- **Migration headroom** — the upcoming SSR migration
  ([ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)) will
  re-route the page URLs through the Worker; whatever we decide here must not
  preclude that.
- **Existing routing behaviour** — pre-migration, page URLs like `/entries`
  are served by the platform as `/entries.html`; the Worker only sees
  `/api/*`, `/oauth/*`, `/share/*`.

## Considered Options

### Option A — Platform-level asset serving with SPA fallback (chosen for the pre-migration era)

In `wrangler.jsonc`:

```jsonc
"assets": {
  "directory": "./web-ui",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application"
}
```

Static files are served by the platform. Unknown paths (`/entries`, `/login`)
fall through to `index.html` — that is how `/entries` (no `.html`) resolves
to `/entries.html` today. The `ASSETS` binding is declared but is not called
from anywhere in `worker/**` (verified by grep).

### Option B — `ASSETS` binding fetched explicitly from the Worker

The Worker is the single router; `env.ASSETS.fetch(request)` is called for
static paths.

### Option C — `not_found_handling: "none"`

The platform serves files when they exist; otherwise the request always
reaches the Worker.

## Decision (as adopted pre-migration)

**Option A.** Cloudflare's platform handles static asset serving entirely.
`binding: ASSETS` is reserved for future use but unused today. The SPA
fallback rule makes clean URLs (`/entries`) serve `/entries.html` without
Worker involvement.

## Pros and Cons of the Options

### Option A

- **Good**, because static files cost zero Worker CPU.
- **Good**, because no Worker code path for static serving means fewer
  failure modes.
- **Good**, because clean URLs work transparently against `/foo.html`.
- **Bad**, because the SPA fallback (`not_found_handling:
  "single-page-application"`) means ANY unknown path serves `index.html`
  rather than reaching the Worker — a poor choice once the Worker owns the
  URL tree (see [ADR-0017](0017-drop-spa-fallback-asset-binding.md)).

### Option B

- **Good**, because every request is observable from Worker code.
- **Bad**, because every static asset pays Worker CPU cost — defeats the
  purpose of the platform optimisation.

### Option C

- **Good**, because static files go to the platform and everything else to
  the Worker — a clean rule.
- **Bad**, because pre-migration the browser UI relied on clean-URL →
  `*.html` resolution that Option A's SPA fallback provided.

## Consequences

- **Positive (pre-migration):** the Worker never sees a request for
  `/entries`, `/login`, `/css/app.css`, or `/js/api.js`. CSP headers, if added
  later, would need to be configured at the platform assets level or moved
  into Worker-owned routes.
- **Positive (pre-migration):** the `ASSETS` binding is forward-compatible —
  we can opt into explicit Worker proxying (Option B) without a config
  semantics change.
- **Negative (pre-migration):** the `Env` type in
  `worker/types/env.ts` does not declare `ASSETS: Fetcher`. Anyone who
  wants to call it must add the type first.
- **Supersession:** with the SSR migration, clean URL routes (`/entries`,
  `/login`, etc.) move into the Worker via a new `uiApp` Hono instance. The
  SPA fallback now actively shadows real SSR routes. [ADR-0017](0017-drop-spa-fallback-asset-binding.md)
  supersedes the SPA-fallback portion of this decision; the platform-level
  static serving (`assets.directory`, `binding: ASSETS`) is retained for
  `/css/`, `/img/`, and the future `/c/*.js` bundles.
