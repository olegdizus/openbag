---
# These are optional metadata elements. Feel free to remove any of them.
status: "accepted"
date: 2026-07-13
decision-makers: oleg
---

# `/api/*` is JSON-only — no `Accept` content negotiation

> **Reinforced (2026-07-14).** With [ADR-0018](0018-core-and-split-into-separate-ui-and-api-workers.md),
> the API Worker serves only `/api/*`, `/oauth/*`, `/share/*` and the
> `web-gui` Worker serves only HTML routes. The API Worker cannot serve
> HTML even by accident; the `web-gui` Worker cannot serve Wallabag JSON
> even by accident. This is no longer just a route-handler convention —
> it is the deployment topology.

## Context and Problem Statement

The browser UI migration (see [ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md))
needs to read and mutate data. A natural-looking option is to make `/api/*`
content-negotiate: return JSON for `Accept: application/json` and HTML for
`Accept: text/html`. That would let a browser POST `/api/entries/123/archive`
and get a redirect, while a Wallabag mobile client POSTs the same URL and gets
JSON.

Superficially this is convenient — one URL, two media types. In practice it is
a breeding ground for bugs and an active risk to the Wallabag/FreshRSS JSON
contract (see [ADR-0001](0001-wallabag-v2-api-compatibility.md)).

## Decision Drivers

- **Wallabag client contract** — every Wallabag mobile app, CLI, and browser
  extension sends requests with the browser's default `Accept: */*` or
  `Accept: text/html` headers. If `/api/*` suddenly returns HTML for those,
  every client breaks.
- **Wallabag server contract** — Wallabag's reference server itself handles
  these URLs; clients must not be biased toward our specific server.
- **Test surface** — `tests/integration/api-auth.test.ts` and
  `tests/integration/api-gaps.test.ts` already pin JSON response shapes; we
  must not require them to also pin HTML branches.
- **Conceptual clarity** — JSON is data; HTML is documents. Mixing them
  inside one URL collapses two clean concepts into one confused surface.

## Considered Options

### Option A — `/api/*` JSON-only; UI mutations go through `/ui/*` (chosen)

JSON API never returns HTML. UI mutates via new Hono routes under `/ui/*`
that accept `application/x-www-form-urlencoded` or `multipart/form-data`,
mutate via shared data helpers (see
[ADR-0013](0013-shared-data-helpers-between-ui-and-api.md)), and return
`303 See Other` redirects back to the page.

### Option B — Content negotiation by `Accept` header

`/api/entries` returns JSON for `Accept: application/json`, HTML for `Accept:
text/html`. POST handlers do the same dual dance.

### Option C — URL-namespace split: `/api/*` stays JSON; new `/web-api/*` for HTML

Like Option A but with the form-POST endpoints mounted under `/web-api/*`
instead of `/ui/*`. Cosmetic.

### Option D — Same URL, dual-purpose via `?format=json|html`

Query-string parameter selects response format.

## Decision Outcome

**Option A.** `/api/*` is JSON-only, unconditionally. Server-rendered HTML
pages live at clean URLs (`/entries`, `/settings`, etc.). Form-POST mutations
live under `/ui/*` (POST `/ui/settings`, POST `/ui/import/single`, etc. — see
[ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)).
Web Components that want optimistic updates call `/api/*` via `fetch` (same
JSON contract Wallabag clients use) and re-render client-side from the
response.

The existing `/share/{uuid}` HTML route is unaffected — it does not live
under `/api/*`.

## Pros and Cons of the Options

### Option A

- **Good**, because the contract is trivial to test:
  `curl -H "Accept: text/html" /api/entries` MUST return JSON. One assertion.
- **Good**, because all Wallabag/FreshRSS clients work unchanged regardless
  of headers they send.
- **Good**, because the Hono `/api/*` router (`worker/api/index.ts`) is
  untouched — no risk to the integration tests that guard it.
- **Good**, because content negotiation does not leak into shared data
  helpers ([ADR-0013](0013-shared-data-helpers-between-ui-and-api.md)).
- **Bad**, because the server has more endpoints to maintain: every form
  needs a `/ui/*` counterpart. Acceptable cost (~8 endpoints, see
  [ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)).
- **Bad**, because a Web Component that wants optimistic UX has to call
  `/api/*` and update client-side, rather than letting the server return
  the next HTML. This is not extra work in practice — WCs have to handle
  the response either way.

### Option B (Accept content negotiation)

- **Good**, because fewer URL namespaces.
- **Bad**, because Wallabag clients send `Accept: */*` (curl-style) or
  `Accept: text/html` (browsers); expecting clients to send
  `Accept: application/json` is fragile.
- **Bad**, because every API handler grows an HTML branch that must be
  kept visually and behaviourally in sync with the SSR renderer. Drift
  risk is high.
- **Bad**, because testing doubles — every endpoint needs JSON and HTML
  contract tests. The current integration tests cover JSON only.

### Option C (URL-namespace split)

- **Good**, because separation is explicit.
- **Bad**, because `/web-api/*` is longer and conveys no extra meaning
  over `/ui/*`. Rejected as cosmetic.

### Option D (`?format=json|html`)

- **Good**, because explicit and overridable.
- **Bad**, because clients often mutate query strings unexpectedly; a
  stale `&format=html` cached in a client URL could break JSON responses.
- **Bad**, because content negotiation by header is the correct HTTP
  pattern; going against it adds learning cost.

## Consequences

- **Positive:** the JSON contract is enforced by a single integration test
  asserting `Accept: text/html` requests still return JSON. The test belongs
  in `tests/integration/` and is described in
  `docs/requirements/api-contract.md`.
- **Positive:** future Wallabag client quirks (Accept headers, content
  types) cannot accidentally trigger HTML responses.
- **Positive:** the boundary "API = data, UI = documents" stays clean; new
  contributors do not need to learn which URLs return which shape.
- **Negative:** every UI mutation is implemented twice — once as a JSON
  endpoint under `/api/*` (for Wallabag clients) and once as a form-POST
  endpoint under `/ui/*` (for browser submits). Both call the same shared
  helper ([ADR-0013](0013-shared-data-helpers-between-ui-and-api.md)), so
  the duplication is structural, not behavioural.
- **Cross-reference:** the existing `/share/{uuid}` HTML route in
  `worker/api/features/share/index.ts` is grandfathered — it predates
  this ADR and is not under `/api/*`. Do not add new HTML-returning routes
  under `/api/*`.
