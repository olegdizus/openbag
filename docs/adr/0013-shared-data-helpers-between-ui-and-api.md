---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0013"
title: "ADR-0013: Shared data helpers used by both UI and API"
status: "superseded by ADR-0018"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0013: Shared data helpers used by both UI and API

> **Superseded (2026-07-14) by
> [ADR-0018](0018-core-and-split-into-separate-ui-and-api-workers.md).**
> The principle — single source of truth for data-access logic, shared by
> UI and API — is preserved and strengthened there. The helpers move from
> `worker/api/features/*-queries.ts` into a `packages/core` workspace
> package, and the UI and API shells split into two separate Workers
> importing the same `core`. The remainder of this ADR is kept as
> historical record.

## Context and Problem Statement

Both the JSON API (`/api/*`) and the new SSR UI pages (`/entries`, `/entry`,
`/tags`, `/settings`, `/developer`, `/import`) need to read entry, tag, config,
feed-token, and OAuth client data. Today every query is inlined into a route
handler inside `worker/api/features/*/index.ts`. The SSR migration would
otherwise be tempted to call `/api/entries` over an internal `fetch()` to
reuse the existing query logic, paying an in-Worker hop on every page render.

There is also a known bug being fixed by this migration: today the `/tags`
web page derives its tag list from `/api/entries?page=1&perPage=200` because
there is no `GET /api/tags` endpoint (see `web-ui/js/tags.js` source
comment). On users with >200 entries, the tag set is silently truncated.

## Decision Drivers

- **One source of truth** — any read query (entries filtering, tag group-by,
  config get) must have exactly one implementation; otherwise SSR and API
  drift.
- **Performance** — SSR pages must not pay an internal HTTP hop per render.
- **Testability** — shared helpers are unit-testable independently of the
  HTTP layer.
- **Bug fix opportunity** — `GET /api/tags` needs to exist; this is the
  natural moment to land it.
- **Wallabag contract** — adding `GET /api/tags` does not change existing
  Wallabag clients; it adds an endpoint Wallabag itself ships.

## Considered Options

### Option A — Extract query helpers into per-feature `queries.ts` modules (chosen)

For each feature in `worker/api/features/*/index.ts`, pull the query logic
into a sibling file (e.g. `worker/api/features/entries/queries.ts`
exporting `getEntries(env, filters)`, `getEntry(env, id)`,
`createEntry(env, userId, body)`, etc.). Both the API route handlers and the
UI handlers import the helpers. No HTTP hop on SSR renders.

New helpers introduced:

- `getTags(env, userId)` — group-by over `tags` + `entry_tags`, no 200-row
  cap. Backs the new `GET /api/tags` endpoint and the SSR `/tags` page.

### Option B — SSR handlers call `/api/*` internally

SSR handlers do `await fetch("https://self/api/entries?…" + headers)`. Conceptually
inline, operationally expensive.

### Option C — Hand-roll the SQL again inside SSR handlers

Duplicate every query in the UI layer.

### Option D — Move all SQL into a shared `worker/db/queries.ts`

One giant module of query functions.

## Decision Outcome

**Option A.** Per-feature `queries.ts` modules, co-located with the
existing feature folders. Both UI and API import the helpers. The API
route handlers are refactored to delegate to the helpers (a pure
movement refactor — no behavioural change to the JSON contract).

`getTags(env, userId)` is added; it backs both the new `GET /api/tags`
endpoint and the SSR `/tags` page.

The naming convention is `getX`, `createX`, `updateX`, `deleteX` matching
the underlying resource.

## Pros and Cons of the Options

### Option A

- **Good**, because one SQL implementation per read; UI and API cannot
  drift.
- **Good**, because helpers are pure functions of `(env, ...args)` — unit
  testable in isolation, no Hono context needed.
- **Good**, because no HTTP hop on SSR renders — direct DB call inside the
  same Worker invocation.
- **Good**, because `getTags` introduction fixes the 200-row truncation
  bug regardless of which caller uses it.
- **Bad**, because the refactor touches every feature module; small risk
  of behavioural drift in the API path. Mitigation: the integration tests
  in `tests/integration/api-gaps.test.ts` are unchanged and guard the
  contract; CI is the safety net.

### Option B (internal fetch)

- **Good**, because no code is refactored today.
- **Bad**, because every SSR page render pays an internal request lifecycle
  cost — Worker → subrequest → Worker → DB. Doubles latency for no
  benefit.
- **Bad**, because the SSR handler must manually build a Request and pass
  cookies, headers, etc. The plumbing is fiddly on Workers.
- **Bad**, because logging middleware doubles up (one log per internal hop).

### Option C (duplicate SQL)

- **Good**, because UI changes do not touch API.
- **Bad**, because two SQL implementations per query will drift —
  especially for filtering and pagination.
- **Bad**, because every bug fix is done twice (or not done once).

### Option D (giant shared queries.ts)

- **Good**, because one place to look for SQL.
- **Bad**, because the file grows huge (every feature's queries mixed); hard
  to navigate.
- **Bad**, because it discourages feature ownership.

## Consequences

- **Positive:** SSR handler bodies become thin: parse query, call helper,
  render JSX. The pattern is uniform and easy to review.
- **Positive:** the new `GET /api/tags` endpoint is a one-liner around
  `getTags(env, user.id)` returning `{ _embedded: { items }, total }`.
- **Positive:** unit tests for the helpers (e.g.
  `tests/unit/entries-queries.test.ts`) can cover edge cases (pagination
  bounds, filter combinations, empty result) without spinning up a full
  HTTP/Miniflare test.
- **Negative:** the refactor inside `worker/api/features/*/index.ts` is
  a mandatory step before SSR pages can land. It must complete first in
  the migration plan.
- **Negative:** future contributors must remember to add a `queries.ts`
  for any feature whose logic is needed by UI. Code review enforces this;
  no compiler-enforced check is introduced.
- **Cross-reference:** [ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)
  defines the mutation surface that uses the same helpers for writes.
