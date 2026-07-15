---
# These are optional metadata elements. Feel free to remove any of them.
status: "accepted"
date: 2026-07-14
decision-makers: oleg
---

# `core` package + separate UI Worker and API Worker

## Context and Problem Statement

OpenBag serves two genuinely different kinds of software from one Cloudflare
Worker today:

1. **The Wallabag v2 API** (`/api/*`, `/oauth/*`, `/share/*`) — an externally
   contracted JSON surface. Frozen shape, slow-changing, exercised by
   third-party clients that cannot be redeployed when we change something.
2. **The browser UI** (`/`, `/entries`, `/entry`, `/settings`, `/tags`,
   `/import`, `/developer`) — an HTML surface with no external contract.
   Churns constantly: copy, layout, and interaction changes are routine;
   the UI tech stack is the more likely of the two to evolve.

These two halves differ along axes that are not just cosmetic:

| Axis | API | UI |
| ---- | --- | -- |
| Population | Third-party clients | The maintainer |
| Reliability contract | Frozen JSON shape | No external contract |
| Change cadence | Glacial (driven by Wallabag) | High (driven by maintainer taste) |
| Correctness criteria | Bit-exact JSON | "Renders and works browsers-first" |
| Security model | Bearer token / `?access_token`, JSON anywhere | Same-origin cookie session, HTML |
| Tech trajectory | Hono-on-Workers forever | Multiple plausible futures |

[ADR-0013](0013-shared-data-helpers-between-ui-and-api.md) recognised that
data-access logic must be shared between the two halves. Its solution was to
tuck query helpers "as siblings" inside `worker/api/features/*-queries.ts`
and let the UI import them across folders. That works mechanically but does
not separate the halves: the API folder remains authoritative, the UI reaches
into it, and the boundary is enforced by convention only.

## Decision Drivers

- **Architectural honesty.** UI and API are different scenarios; the
  repository should say so, and the deployment topology should say so.
- **Security invariant isolation.** The API Worker ever only sees
  client-shaped requests; the UI Worker ever only sees browser-shaped
  requests. There is no topology in which a request can be misinterpreted
  as the other kind. This is the one architectural prize that is **not
  theoretical even at single-user scale.**
- **Independent release cadence.** UI ships multiple times per day without
  touching the API; API contract releases don't drag UI through CI; rollback
  is per-Worker.
- **Tech stack independence.** The UI's SSR/Hono JSX layer can be swapped
  without restructuring the API.
- **Visibility of contract surface.** What third-party code depends on (the
  `/api/*` JSON shape) lives in a different package from what nothing
  external depends on (HTML structure, JS bundles).
- **Performance.** UI Worker reads D1 directly via shared `core` helpers.
  No subrequest penalty for SSR.
- **Type safety.** Both Workers import the same `core` types at compile
  time. No codegen, no drift across a runtime seam.
- **Pnpm workspace aliases instead of relative paths.** Every cross-package
  import is `import { getEntry } from "@openbag/core"`, never
  `from "../../../../../packages/core/..."`. Refactors that move files inside
  a package don't touch callers. Greps-for-callers work. IDE jump-to-definition
  works.

## Considered Options

### Option A — `core` package + two Workers (`api`, `web-gui`)  *(chosen)*

Hoist the shared business logic — queries, session, crypto, sanitize, parser,
auth primitives, types — into a `packages/core` workspace package. Build two
Workers, each importing `core`:

- `packages/api` — `/api/*`, `/oauth/*`, `/share/*`. JSON-only
  ([ADR-0011](0011-json-only-api-no-content-negotiation.md)). Owns the
  Wallabag serializers. Binds D1. Cloudflare-routed to `/api/*`, `/oauth/*`,
  `/share/*` at the apex.
- `packages/web-gui` — `/`, `/entries`, `/entry`, `/settings`, … HTML SSR +
  form-POST `/ui/*` mutations
  ([ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)). Owns Hono JSX
  layouts, Web Components, static assets. Binds D1 (same `database_id` as
  `api`). Cloudflare-routed to `/*`.

Each Worker has its own `wrangler.jsonc`, deploy revision, log stream, and
subrequest budget. Both import `@openbag/core` at compile time.

### Option B — `core` package + monolithic Worker

Hoist a `core` package but compile both shells into one Worker. Same DAG
in shape; simpler ops.

### Option C — HTTP-mediated split (UI Worker calls API Worker)

Maximum logical separation — the UI Worker consumes the API Worker's JSON
contract via `fetch()` or a Service Binding. Every SSR render pays N
subrequests.

### Option D — Status quo (ADR-0013)

Leave the helpers under `worker/api/features/`. UI imports across folders.

## Decision Outcome

**Option A.** A pnpm workspace with three packages:

```text
packages/
├── core/      ← shared types, queries, session, crypto, sanitize, parser, auth primitives
│              NO Hono, NO HTTP, NO Workers runtime imports — pure TypeScript
├── api/       ← API Worker: Hono routers under /api, /oauth, /share
│              Wallabag serializers, JSON envelopes; binds D1; owns queue + cron consumers
└── web-gui/   ← UI Worker: Hono JSX SSR at /, /entries, /entry, /settings, …
               /ui/* form-POST mutations; static assets; binds D1 (same database_id)
```

Each of `api/` and `web-gui/` is a Cloudflare Worker with its own
`wrangler.jsonc`. Both bind the **same D1 database** by `database_id`;
isolation is at the code level, not the data level. The Cloudflare route
table directs `/api/*`, `/oauth/*`, `/share/*` to the `api` Worker and
`/*` to the `web-gui` Worker.

`@openbag/core` is a pure-TypeScript workspace package. Functions take
`env` and plain args, return plain objects. Both Workers consume it
identically.

### Workspace mechanics

A pnpm workspace at the repo root. Three packages, each with its own
`package.json`:

```yaml
# pnpm-workspace.yaml (replaces the current placeholder)
packages: ["packages/*"]
```

```json
// packages/core/package.json
{
  "name": "@openbag/core",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

```json
// packages/api/package.json (excerpt)
{
  "name": "@openbag/api",
  "private": true,
  "dependencies": {
    "@openbag/core": "workspace:*",
    "hono": "^4.7.0"
  }
}
```

```json
// packages/web-gui/package.json (excerpt)
{
  "name": "@openbag/web-gui",
  "private": true,
  "dependencies": {
    "@openbag/core": "workspace:*",
    "hono": "^4.7.0"
  }
}
```

Notes:

- The `"name"` of each Worker package (`@openbag/api`, `@openbag/web-gui`)
  exists for symmetry and for `pnpm --filter` targeting, not because anything
  imports them — Workers are leaves in the dependency DAG.
- `"workspace:*"` is pnpm's workspace protocol — `*` resolves to whatever
  version the local `packages/core` has. No version drift possible.
- `core`'s `"main"`/`"types"` point at `src/index.ts` directly. No build step
  for `core`; both Workers compile its TS via `ttsc` when they bundle. This
  keeps edit-compile-test loops tight. If `core` ever needs a build step
  (e.g. to emit ESM for an external consumer), wire it then.
- Cross-package imports are always by alias, never by relative path:

  ```ts
  // Inside packages/api/src/routes/entries.ts — good
  import { getEntry } from "@openbag/core";

  // Bad — never cross a package boundary with a relative path.
  import { getEntry } from "../../../../core/src/queries/entries";
  ```

  **Enforcement:** an ESLint `no-restricted-syntax` / `no-restricted-imports`
  rule blocks any import in `packages/api/` or `packages/web-gui/` whose
  source string crosses into another package's directory (`../core/`, etc.).
  Imports from `@openbag/core` are the only sanctioned channel.

[ADR-0013](0013-shared-data-helpers-between-ui-and-api.md)'s principle —
single source of truth for queries — is preserved and strengthened: the
helpers move from `worker/api/features/*-queries.ts` to
`packages/core/<domain>/`. Once the migration lands, ADR-0013 is
**Superseded** by this ADR.

## Pros and Cons of the Options

### Option A (chosen)

- **Good**, because two genuinely different scenarios become two different
  deployable things. The repository layout and the runtime topology both
  say so.
- **Good**, because auth middleware can no longer be confused about whether
  a request is browser-shaped or client-shaped — each Worker only ever sees
  one kind. Reinforces
  [ADR-0012](0012-separate-browserauth-and-api-auth-middleware.md) at the
  topology level rather than the convention level.
- **Good**, because UI ships independently of API (and vice versa). Rollback
  is per-Worker.
- **Good**, because **no subrequest cost on SSR** — the `web-gui` Worker
  reads D1 directly via `core`. Latency stays at one D1 hop per query, same
  as the monolith.
- **Good**, because end-to-end TypeScript types via the `core` package. No
  codegen.
- **Good**, because the API Worker's log stream contains purely Wallabag
  client traffic; the `web-gui` Worker's contains purely browser SSR.
- **Good**, because a future second consumer (mobile app dogfood, share
  extension Worker, admin batch Worker) plugs in without architectural
  change — it just imports `core` and binds D1.
- **Bad**, because local dev needs two `wrangler dev` processes pointing at
  a shared local D1 file. *Mitigation:* a `pnpm dev` script that runs
  both via `concurrently`, plus a documented `.wrangler/state` layout.
- **Bad**, because build/deploy is two steps instead of one. *Mitigation:*
  `pnpm build` / `pnpm deploy` orchestration at the workspace root.

### Option B (`core` + monolith)

- **Good**, because one dev server, one log stream, one rollback.
- **Good**, because compile-time atomicity — UI and API can never be on a
  different `core` version.
- **Bad**, because the security "browser-or-client?" decision point lives
  inside every request handler. Even with separate middleware
  ([ADR-0012](0012-separate-browserauth-and-api-auth-middleware.md)), one
  Worker still answers both shapes — the failure mode is "wrong middleware
  chosen", and it stays possible.
- **Bad**, because UI churn forces whole-Worker redeploy. The bundled JSON
  contract goes through CI on every copy tweak.
- **Bad**, because the architectural signal "this is one application"
  contradicts the architectural reality "this is two different scenarios."

### Option C (HTTP-mediated split)

- **Good**, because the JSON contract is dogfooded by the maintainer's own
  UI — every API gap is felt immediately.
- **Bad**, because every SSR render pays N subrequests and N× inner-Worker
  CPU. On Workers this is real millis and real budget (50 subrequests / req).
- **Bad**, because the UI Worker would have no DB; every read would be a
  service-binding call. The latency tax is recurring.
- **Bad**, because type drift across the HTTP seam requires codegen or
  manual sync — the very thing `core` exists to eliminate.

### Option D (status quo / ADR-0013)

- **Bad**, because the helpers live inside `worker/api/features/`, so the
  UI reaches into the API's guts. Organisationally the UI is not a peer;
  it is a guest in the API's house.
- **Bad**, because the deployment topology contradicts the architectural
  reality (two different scenarios deployed as one).

## Consequences

- One new pnpm workspace package `packages/core`. The existing `worker/` and
  `web-ui/` source is redistributed: business logic moves into `core`,
  HTTP-shaped code splits into `packages/api` and `packages/web-gui`.
- Two `wrangler.jsonc` files (`packages/api/wrangler.jsonc`,
  `packages/web-gui/wrangler.jsonc`). D1 `database_id` is shared.
- Cloudflare dashboard: two routes pointing at two Workers (`/api/*`,
  `/oauth/*`, `/share/*` → `api` Worker; `/*` → `web-gui` Worker).
- Queue consumers and cron triggers belong to the `api` Worker:
  `entry-refetch`, token-cleanup, import; hourly / daily / weekly crons.
  The `web-gui` Worker owns none of them.
- Local dev: `pnpm dev` runs both Workers concurrently, sharing one local
  D1 file. Documented in `README.md`.
- [ADR-0013](0013-shared-data-helpers-between-ui-and-api.md) helpers move
  into `packages/core/`; that ADR is superseded by this one.
- [ADR-0011](0011-json-only-api-no-content-negotiation.md) (JSON-only API)
  is strengthened — the API Worker cannot serve HTML even by accident; the
  `web-gui` Worker cannot serve Wallabag JSON even by accident.
- [ADR-0012](0012-separate-browserauth-and-api-auth-middleware.md)
  (separate `browserAuthMiddleware`) is reinforced — the two middlewares
  now live in different Workers entirely.
- ESLint `no-restricted-imports` rule enforces: `packages/api/**` may not
  import from `packages/web-gui/**` and vice versa; both may import from
  `packages/core/**` only.

## Open items

- Whether `packages/core` is later further split (e.g. `core/db`,
  `core/parser`, `core/auth`). Not decided here. Preferred path: start with
  one package, split later only if a clear internal boundary emerges.
- The `web-gui` Worker is the natural home for the `ASSETS` binding and the
  static files in `web-ui/public/`. The `api` Worker has no static assets.
