---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0014"
title: "ADR-0014: UI mutations go through `/ui/*` form-POST routes"
status: "accepted"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0014: UI mutations go through `/ui/*` form-POST routes

## Context and Problem Statement

Strict progressive enhancement ([ADR-0010](0010-progressive-enhancement-as-hard-requirement.md))
means every mutating browser action must submit a real `<form method=post
action="...">`. Where do those form POSTs go? The candidates are `/api/*`
(currently JSON-only per [ADR-0011](0011-json-only-api-no-content-negotiation.md)),
a new `/ui/*` namespace, or directly to Web Components that fetch JSON.

Today the wallabag-compat API does not even speak the verbs/shapes a form
favourably: most mutations are PATCH or DELETE with JSON bodies, which
vanilla HTML forms cannot produce without JS workarounds.

## Decision Drivers

- **Strict PE** — the no-JS form POST must work without fetch interception.
- **API purity** — `/api/*` must stay JSON-only per
  [ADR-0011](0011-json-only-api-no-content-negotiation.md).
- **Single mutation code path** — the actual write logic must be shared by
  the JSON API (for Wallabag clients) and the form routes (for browsers);
  see [ADR-0013](0013-shared-data-helpers-between-ui-and-api.md).
- **Browser-native form semantics** — `application/x-www-form-urlencoded`
  and `multipart/form-data`, `303 See Other` redirect after POST, no JSON
  parsing needed.

## Considered Options

### Option A — Mount `/ui/*` form-POST routes; mutate via shared helpers; redirect back (chosen)

Add Hono routes under `/ui/*` that accept form bodies, call the shared
data helpers to mutate, then return `303 See Other` to the page the user
should land on. Examples:

- `POST /ui/settings` → `updateConfig(env, user.id, body)` → `303 /settings`
- `POST /ui/import/single` → `createEntry(...)` → `303 /entry?id={id}`
  (or `303 /import?error=…` on failure)
- `POST /ui/import/bulk` → `createEntriesBulk(...)` → `303 /import?imported=N`
- `POST /ui/tags/delete` → `deleteTagByLabel(...)` → `303 /tags`
- `POST /ui/oauth/clients` → `createOAuthClient(...)` → `303 /developer`
- `POST /ui/oauth/clients/:id/delete` → `deleteOAuthClient(...)` → `303 /developer`
- `POST /ui/feed/token/rotate` → `rotateFeedToken(...)` → `303 /settings`
- `POST /ui/feed/token/revoke` → `revokeFeedToken(...)` → `303 /settings`

All routes are protected by `browserAuthMiddleware` (see
[ADR-0012](0012-separate-browserauth-and-api-auth-middleware.md)). CSRF is
covered by `SameSite=Strict` cookie (already set in
`worker/session.ts`) layered with a hidden `csrf_token` form field per
form for defense-in-depth.

### Option B — Reuse `/api/*` routes; Web Components `fetch` JSON directly

Forms are JS-intercepted client-side; the no-JS form action becomes
meaningless.

### Option C — Embed verbs inside `/api/*` as POST routes that accept form bodies AND JSON

`POST /api/entries/123/archive` accepts JSON for Wallabag clients and
`x-www-form-urlencoded` for browsers.

### Option D — New `/web-api/*` namespace for the form POSTs

Same as Option A but with a different prefix.

## Decision Outcome

**Option A.** A new `/ui/*` Hono sub-app in `worker/ui/server/actions.ts`
hosts every browser-mutation endpoint. Each endpoint:

1. Mounts `browserAuthMiddleware({ required: true })` — no UI mutation can
   happen unauthenticated.
2. Parses form fields from `c.req.formData()` or `c.req.urlencoded()`.
3. Calls the shared helper from `worker/api/features/*/queries.ts`
   (e.g. `updateConfig`, `createEntry`).
4. Returns `303 See Other` to the appropriate page (allowing the browser
   to repeat-after-POST without re-confirming).

Web Components layered on top intercept the same form's submit, call the
helper's JSON API twin (e.g. `PATCH /api/entries/:id`) for an optimistic
update, and prevent default.

## Pros and Cons of the Options

### Option A

- **Good**, because forms work without JS — strict PE holds.
- **Good**, because the same shared helpers back both `/api/*` JSON writes
  and `/ui/*` form writes — one behavioural source of truth
  ([ADR-0013](0013-shared-data-helpers-between-ui-and-api.md)).
- **Good**, because API purity holds: no form-body handling inside
  `/api/*`.
- **Good**, because `303 See Other` is the correct PRG (Post/Redirect/Get)
  pattern — back button and refresh do not re-submit.
- **Bad**, because the server has ~8 mutation endpoints to maintain that
  roughly mirror API endpoints.
- **Bad**, because CSRF tokens need issuing and verifying — defensive but
  adds a small wrapper.

### Option B (Components fetch directly)

- **Good**, because one endpoint per mutation.
- **Bad**, because strict PE collapses — without JS, the form does
  nothing. Violates [ADR-0010](0010-progressive-enhancement-as-hard-requirement.md).

### Option C (dual-purpose `/api/*`)

- **Good**, because one URL per mutation.
- **Bad**, because it contradicts
  [ADR-0011](0011-json-only-api-no-content-negotiation.md) at the verb
  layer. Form bodies and JSON bodies in one handler is a maintenance
  hazard.
- **Bad**, because `303 See Other` redirect semantics break Wallabag
  mobile apps that expect JSON responses.

### Option D (`/web-api/*` prefix)

- **Good**, because shorter than nothing else.
- **Bad**, because cosmetic only; `/ui/*` conveys more clearly "browser
  mutation surface". Rejected as no functional difference.

## Consequences

- **Positive:** the strict-PE contract is enforceable in a test: enumerate
  every `/ui/*` POST and verify it returns `303` with a valid `Location`.
- **Positive:** shared helpers
  ([ADR-0013](0013-shared-data-helpers-between-ui-and-api.md)) mean the
  server has one authoritative mutation path per resource — the form
  surface is a thin HTTP wrapper.
- **Positive:** the existing `/api/auth/login` and `/api/auth/signup`
  endpoints already set the session cookie via `Set-Cookie` and could be
  reused as `POST /ui/login` targets — but the migration opts for keeping
  them under `/api/auth/` (they are already used by the test suite and
  Wallabag clients) and just issuing the cookie there.
- **Negative:** future contributors must remember to add a `/ui/*` mirror
  for any new mutation that needs a browser form. Code review enforces
  this; no lint rule is introduced today.
- **Negative:** CSRF token handling adds a small per-form render cost
  (`crypto.randomUUID()` on SSR). Negligible but non-zero.
- **Cross-reference:** `/api/oauth/clients` already supports JSON POST
  from Wallabag clients; the `/ui/oauth/clients` endpoint will call the
  same `createOAuthClient` helper.
