---
# These are optional metadata elements. Feel free to remove any of them.
status: "accepted"
date: 2026-06-10
decision-makers: oleg
---

# Hono as the HTTP framework

## Context and Problem Statement

OpenBag has ~80 API routes (`/api/entries`, `/api/tags`, `/oauth/v2/token`,
`/share/{uuid}`, the public feed endpoints, etc.) plus the future browser-UI
route tree. We need an HTTP framework that: runs natively on Cloudflare
Workers, has middleware composition for cross-cutting concerns (auth, CORS,
logging, error handling), keeps the worker bundle small, and stays
productive as the route count grows.

Routes must be cleanly composable: feature-owned sub-apps (`entriesRoutes()`,
`tagRoutes()`, `oauthRoutes()`, ...) mounted into a root Hono instance.

## Decision Drivers

- **Workers-native** — must use `Request`/`Response` web standards; no Node
  polyfills.
- **Middleware ergonomics** — auth, CORS, error wrapper, logging all need to
  apply consistently across many routes.
- **Bundle size** — Workers have a 1 MB compressed startup limit; framework
  weight matters on cold starts.
- **TypeScript DX** — strict typing and inference on context, params, body.
- **JSX capability** — server-rendered UI is a future direction; built-in JSX
  support would save us a second dependency.

## Considered Options

### Option A — Hono (chosen)

`hono` v4.7. Already in `package.json`. Sub-app mounting, typed context,
first-class Cloudflare Workers adapter, built-in `hono/jsx` for server-side
rendered HTML.

### Option B — itty-router

Tiny (~1 KB), Workers-native, but lighter on middleware ergonomics and JSX.

### Option C — Plain `Request` handler

Write the router and middleware by hand on top of the Worker `fetch` event.

### Option D — Express-equivalent on a Node compat shim

`express` or `@hono/node-server`-style stack via Workers' Node.js compat.

## Decision Outcome

**Option A — Hono.** A single `Hono` root instance is built in
`worker/entrypoint.ts` and `root.route("/", apiApp)` mounts the API router
exported by `worker/api/index.ts`. Each feature mounts its own sub-app
(`app.route("/entries", entryRoutes())`).

Middleware is applied in two scopes:

- **Global** in `worker/api/index.ts` — `corsMiddleware`,
  `loggingMiddleware`, `errorMiddleware`.
- **Per-protected-tree** — `authMiddleware` is mounted inside the protected
  sub-app (`const api = new Hono(); api.use("*", authMiddleware())`) rather
  than globally.

Hono JSX is available for any future server-rendered HTML route and becomes
the basis of the UI migration — see [ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md).

## Pros and Cons of the Options

### Option A — Hono

- **Good**, because it is already in the dependency tree (`hono ^4.7` in
  `package.json`); no new runtime deps.
- **Good**, because `hono/jsx` ships in-box — this becomes the SSR layer
  without a second framework ([ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)).
- **Good**, because middleware ordering and per-app `use("*", ...)` lets us
  apply `authMiddleware` only inside the protected `/api` sub-app, leaving
  public routes (health, info, share, OAuth) unguarded.
- **Bad**, because Hono JSX is less feature-rich than React/Preact for
  client-side concerns. Mitigated by Web Components for islands.

### Option B — itty-router

- **Good**, because ~1 KB and extremely fast.
- **Bad**, because middleware composition is more manual; CORS + logging +
  error wrappers across 80 routes would be more boilerplate than Hono.
- **Bad**, because no built-in JSX.

### Option C — Plain handler

- **Good**, because zero dependencies.
- **Bad**, because we would rebuild routing, params, type-safe body parsing,
  sub-app composition, and an error wrapper for ~80 routes. Rejected as bad
  cost/benefit.

### Option D — Express via Node compat

- **Good**, because familiar ecosystem.
- **Bad**, because Workers' Node compat shim adds bundle weight and inhibits
  cold-start cost.
- **Bad**, because non-native primitives risk Worker-specific runtime gaps.

## Consequences

- **Positive:** a new UI route tree can be mounted as a sibling Hono app:
  `root.route("/", uiApp)` before `root.route("/", apiApp)`, preserving the
  API surface exactly. This is what [ADR-0017](0017-drop-spa-fallback-asset-binding.md)
  prescribes.
- **Positive:** the future browser-auth middleware
  ([ADR-0012](0012-separate-browserauth-and-api-auth-middleware.md)) mirrors
  the `authMiddleware()` shape and the `c.set("user", { id, username })`
  convention.
- **Positive:** `c.html(...)` is available for any HTML route (the existing
  `/share/{uuid}` and `/oauth/v2/auth` already use it; the migration's
  `<EntriesPage/>` etc. will use it via `hono/jsx`).
- **Negative:** middleware ordering must be explicit; `corsMiddleware` and
  `loggingMiddleware` are mounted globally and may need adjustment if future
  routes require different CORS policies.
- **Negative:** Hono's typing system is opted into via `new Hono<{ Bindings:
  Env; Variables: { user: ... } }>()`. The current code uses `c: any` in
  many handlers; tightening to typed context across the codebase is
  deferred — but the future `uiApp` should adopt the typed form from the
  start.
