---
# These are optional metadata elements. Feel free to remove any of them.
status: "accepted"
date: 2026-07-13
decision-makers: oleg
---

# Separate `browserAuthMiddleware` for SSR, distinct from `authMiddleware`

> **Reinforced (2026-07-14).** With [ADR-0018](0018-core-and-split-into-separate-ui-and-api-workers.md),
> `authMiddleware` and `browserAuthMiddleware` now live in different
> Workers entirely. The two middlewares can no longer be confused at
> dispatch — the routing topology guarantees each request reaches the
> correct one.

## Context and Problem Statement

Two Hono auth middlewares exist in the codebase today:

1. **`authMiddleware`** in `worker/middleware/auth.ts`. It accepts Bearer
   tokens (Wallabag clients), `?access_token` query param (read-only feeds),
   and the `session` cookie (browser), and resolves them to a user via
   `lookupSession(env, token)`. On failure it returns a JSON 401 — the
   correct behaviour for API consumers ([ADR-0001](0001-wallabag-v2-api-compatibility.md)).

2. **`sessionMiddleware`** in `worker/middleware/session.ts`. It reads
   the cookie as a *raw username*, queries `users WHERE username = ?`
   directly, and `c.redirect("/login", 302)`s on failure. This is the
   *legacy cookie scheme* — pre-`sessions` table, before the opaque-token
   hardening in `worker/session.ts`. It is not actually used in
   `api/index.ts` today (verified by grep).

The new SSR UI routes need cookie-based auth with **browser-friendly failure
behaviour** (302 redirect to `/login?next=…`) while reusing the modern
opaque-token session scheme.

## Decision Drivers

- **Browser UX** — a session-expiring user must land on `/login`, not see a
  JSON `{"error":{"code":401}}` blob.
- **Modern session scheme** — the secure `lookupSession` + sha256 hash
  approach in `worker/session.ts` is the only correct authority
  (see [ADR-0003](0003-opaque-tokens-not-jwt.md)).
- **Wallabag API purity** — `authMiddleware` is JSON-only and must remain so
  (see [ADR-0001](0001-wallabag-v2-api-compatibility.md)).
- **Code clarity** — a future contributor reading either middleware should
  not be confused about whether it serves browsers or API clients.
- **No silent wrong-session-cookie bug** — never reuse the legacy
  `worker/middleware/session.ts` that reads cookies as raw usernames;
  that path would silently fail to authenticate any user who has a modern
  session cookie.

## Considered Options

### Option A — New `browserAuthMiddleware` using `lookupSession` (chosen)

Create `worker/middleware/browser-auth.ts` exporting
`browserAuthMiddleware({ required = true })`. It:

- Reads the `session` cookie via the same regex used by `readSessionCookie`
  in `worker/api/features/auth/index.ts:41–45`.
- Calls `lookupSession(env, token)` from `worker/session.ts` to resolve
  the user.
- On success sets `c.set("user", { id, username })` (same shape as
  `authMiddleware`).
- On failure + `required: true` → `c.redirect("/login?next=" +
  encodeURIComponent(c.req.path), 302)`.
- On failure + `required: false` → passes through without setting `user`
  (used on `/` for the logged-in-vs-logged-out routing decision).

The existing `authMiddleware` stays JSON-only for `/api/*` and `/oauth/*`.

### Option B — Extend `authMiddleware` with `Accept: text/html` branch

Add a redirect-on-401 mode triggered by `Accept: text/html`.

### Option C — Reuse `sessionMiddleware`

Wire the legacy middleware directly.

### Option D — SSR routes internally `fetch("/api/auth/me")`

SSR handlers make an internal subrequest to the JSON `/api/auth/me` to
detect login.

## Decision Outcome

**Option A.** New `browserAuthMiddleware` in
`worker/middleware/browser-auth.ts`. `lookupSession` is the sole
session authority. The legacy `sessionMiddleware` in
`worker/middleware/session.ts` is left in place but unused — it must
NOT be wired into the new UI routes.

## Pros and Cons of the Options

### Option A

- **Good**, because each middleware has one clear client surface (browser
  vs API). No accidental wrong-failure-mode bugs.
- **Good**, because `lookupSession` is the modern, hardened path; the
  browser auth uses identical verification to the API auth. No chance of
  the session scheme diverging.
- **Good**, because `c.set("user", { id, username })` shape matches the
  API convention; UI handlers can read it the same way.
- **Bad**, because there is now cookie-reading code in two places
  (`authMiddleware` for the API path that still accepts cookie auth; new
  middleware for the browser path). Acceptable duplication for clarity.

### Option B (Accept-branch in `authMiddleware`)

- **Good**, because one middleware.
- **Bad**, because the Accept header is exactly what Wallabag mobile apps
  sometimes send weirdly. A misclassified request could silently redirect
  a client to `/login` HTML — breaking compat.
- **Bad**, because branches proliferate: `required`, `Accept`, redirect vs
  JSON, query-token path. A single function with too many modes is a
  maintenance hazard.

### Option C (reuse `sessionMiddleware`)

- **Good**, because zero new code.
- **Bad**, because it reads the cookie value as a username — the legacy,
  forgeable scheme. Any user with the modern `session=<32-byte-hex>`
  cookie would never authenticate. Hard reverse — the legacy middleware
  is essentially dead code and a trap for future contributors.

### Option D (internal `/api/auth/me` fetch)

- **Good**, because reuses the existing endpoint.
- **Bad**, because it adds an internal HTTP-ish hop per SSR request; on
  Workers this is wasteful and requires manual cookie-header plumbing.
- **Bad**, because `lookupSession` is already the function `/api/auth/me`
  calls internally; calling `/api/auth/me` from SSR is two layers of
  indirection above the direct call Option A makes.

## Consequences

- **Positive:** UI routes never accidentally return JSON 401s to browsers;
  API routes never accidentally 302-redirect to browsers, which would
  break Wallabag clients.
- **Positive:** the `Env` type acquires `ASSETS: Fetcher` in the same
  migration, so future Worker code can resolve static assets when needed
  (see [ADR-0017](0017-drop-spa-fallback-asset-binding.md)).
- **Negative:** the legacy `worker/middleware/session.ts` remains in
  the tree. Recommendation: deprecate with a top-of-file comment,
  scheduled for removal in a follow-up cleanup PR (NOT a goal of this ADR).
- **Negative:** every new UI route that wants the user must explicitly
  mount `browserAuthMiddleware()`. The default in the `/ui/*` namespace
  should be `required: true`; `/login`, `/signup`, and `/` use `required:
  false`.
- **Cross-reference:** `worker/session.ts` `lookupSession`,
  `buildSessionCookie`, `buildExpiredCookie` become the foundation for the
  `/login` SSR handler too — login form POSTs go to `/api/auth/login`
  (unchanged), but the redirect-after-login target is whatever `next` was
  on the query string.
