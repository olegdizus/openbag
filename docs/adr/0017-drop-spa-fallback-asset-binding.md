---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0017"
title: "ADR-0017: Drop SPA fallback in `wrangler.jsonc`; UI routes live in the Worker"
status: "accepted"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0017: Drop SPA fallback in `wrangler.jsonc`; UI routes live in the Worker

> **Supersedes (partially).** The SPA fallback portion of
> [ADR-0008](0008-static-assets-via-workers-platform.md) is reversed by
> this ADR. The platform-serves-static-files principle in ADR-0008 stays.

## Context and Problem Statement

`wrangler.jsonc` currently ships:

```jsonc
"assets": {
  "directory": "./web-ui",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application"
}
```

This works for the pre-migration vanilla UI: a request to a clean URL like
`/entries` falls through to `/index.html`, which immediately meta-refreshes
to `/entries` (or the platform resolves `/entries` against `/entries.html` —
behaviour depends on Static Assets' internal heuristics).

With the SSR migration (see [ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)),
clean URLs (`/entries`, `/login`, `/entry`, `/settings`, etc.) become Worker
routes served by `hono/jsx`. The SPA fallback must NOT shadow those routes —
if it does, the user gets `index.html` (which still does a client-side
redirect loop) instead of the SSR-rendered entries page.

## Decision Drivers

- **Clean URLs owned by the Worker** — the new `uiApp` Hono instance must be
  the authority for `/entries`, `/login`, etc. The platform must NOT
  short-circuit them.
- **Preserve static asset serving** — `/css/app.css`, `/img/...`, and the
  future `/c/*.js` client bundles should still be served by the platform,
  not the Worker. Zero CPU cost for static.
- **Single source of truth for routing** — once the migration lands, the
  worker is the only router that understands non-file URLs.
- **Env type accuracy** — `ASSETS` is bound in `wrangler.jsonc` but
  `worker/types/env.ts` does not declare it. The migration uses the
  binding for fallback cases, so the type must be updated.

## Considered Options

### Option A — Drop SPA fallback, keep asset directory and binding (chosen)

In `wrangler.jsonc`:

```jsonc
"assets": {
  "directory": "./web-ui",
  "binding": "ASSETS",
  "not_found_handling": "none"
}
```

The new `uiApp` Hono instance is mounted in `worker/entrypoint.ts`
**before** `root.route("/", apiApp)`:

```ts
const root = new Hono();
root.route("/", uiApp);   // UI routes first
root.route("/", apiApp);  // JSON API second
```

`ASSETS: Fetcher` is added to the `Env` type in `worker/types/env.ts`
so future code can call `env.ASSETS.fetch(request)` if needed (e.g.
streaming a built bundle from outside the page-handler chain).

### Option B — Keep SPA fallback, mount UI routes under `/app/*`

New UI lives under `/app/entries`, `/app/login`, etc. The platform still
owns `/entries` etc.

### Option C — Keep SPA fallback but ensure `index.html` itself redirects to `/entries`

Make `index.html` a single line: `<meta http-equiv="refresh" content="0; url=/entries">`.
Existing pattern; the SSR route at `/entries` then renders.

### Option D — Drop static asset serving too; serve everything from the Worker

`env.ASSETS.fetch(request)` for every static file too.

## Decision Outcome

**Option A.** Replace SPA fallback with `"not_found_handling": "none"`.
The Worker's `uiApp` Hono instance is the authoritative router for clean
URLs. The `assets.directory` and `binding: ASSETS` themselves stay — `/css`,
`/img`, and the future built `/c/*.js` bundles remain platform-served.

`ASSETS: Fetcher` is added to `worker/types/env.ts`. This ADR
explicitly **supersedes the SPA-fallback decision** in
[ADR-0008](0008-static-assets-via-workers-platform.md). The platform-level
static serving portion of 0008 (the parts about `directory` and `binding`)
remains in force.

## Pros and Cons of the Options

### Option A

- **Good**, because clean URLs definitively belong to the Worker. No
  platform/Worker ambiguity.
- **Good**, because static files continue to cost zero Worker CPU.
- **Good**, because the routing mental model is single-source: the
  platform serves files that exist; everything else goes to the Worker.
- **Good**, because the `ASSETS: Fetcher` type addition unlocks future
  Worker-side asset access without further changes.
- **Bad**, because a typo in a URL that should resolve to a static file
  will now reach the Worker instead of just 404ing. Mitigation: keep
  `assets.directory` accurate; the platform still resolves real files
  first.

### Option B (`/app/*` namespace)

- **Good**, because no platform/Worker conflict.
- **Bad**, because ugly URLs and the migration plan
  ([ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md))
  expects clean `/entries`, `/login` etc. for SEO and shareability.
- **Bad**, because nav links, redirects, and share URLs all need rewrites.

### Option C (SPA fallback + redirecting index.html)

- **Good**, because no config change.
- **Bad**, because the SPA fallback will still resolve `/login` to
  `/login.html` if the file exists; we would have to delete `*.html`
  files before routing works — defeats the clean-URL guarantee.
- **Bad**, because the fallback semantics are platform-versioned; opaque
  comparison rules.

### Option D (serve all from Worker)

- **Good**, because the worker sees everything; easy to add CSP headers
  or auth-gated static files later.
- **Bad**, because every static asset burns Worker CPU; bad for cold
  starts and Worker usage costs.

## Consequences

- **Positive:** the SSR route handlers in `worker/ui/server/pages/*.tsx`
  can be confidently mounted at clean URLs without worrying that the
  platform will shadow them.
- **Positive:** the `Env` type gains `ASSETS: Fetcher`, enabling future
  SSR code to proxy or stream from the asset directory.
- **Positive:** this ADR explicitly supersedes the SPA-fallback portion
  of [ADR-0008](0008-static-assets-via-workers-platform.md). The
  platform-level static serving portions (directory, binding) remain in
  force.
- **Negative:** any deployed consumer of OpenBag that previously relied
  on a platform-served clean URL (e.g. `/foo` resolving to `/foo.html`)
  will 404 after cutover. Acceptable: the new UI owns that URL tree.
- **Negative:** a new static file accidentally placed in `web-ui/` with
  the same name as a route (e.g. `entries.html`) would silently be
  served by the platform at that URL. Mitigation: do not place `.html`
  files in `web-ui/` post-cutover; only `/css`, `/img`, and `/c`.
- **Risk:** explicit Worker routing for unknown paths via `not_found_handling:
  "none"` means an unknown URL reaches the worker and returns a Hono 404
  (JSON or HTML depending on the handler). Ensure the new UI renders a
  friendly 404 page for clean URLs.
- **Cross-reference:** [ADR-0008](0008-static-assets-via-workers-platform.md)
  historical record stands; this ADR's `Supersedes` field is "partial".
  The complete routing model is: platform → existing files; Worker →
  everything else.
