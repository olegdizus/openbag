---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0009"
title: "ADR-0009: UI tech stack — Hono JSX SSR + Web Components (not Preact or HTMX)"
status: "accepted"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0009: UI tech stack — Hono JSX SSR + Web Components (not Preact or HTMX)

## Context and Problem Statement

The current `web-ui/` is a vanilla-JS collection of 8 HTML pages + 9 JS files
(~1250 lines total) that build DOM by string concatenation and bootstrap each
session with a `GET /api/auth/me` round-trip. It must grow into a real
wallabag+freshrss-compatible aggregator and a future offline-first PWA reader.
The team is React-fluent but prefers minimalistic, pragmatic approaches.

The migration must preserve strict progressive enhancement (every page works
without JS — see [ADR-0010](0010-progressive-enhancement-as-hard-requirement.md))
and must not change the JSON API contract (see
[ADR-0011](0011-json-only-api-no-content-negotiation.md)).

Available options in this stack:

- `hono` v4.7 is already installed; `hono/jsx` ships in-box for server-rendered
  HTML.
- No client bundler exists today (no vite/webpack/esbuild/rollup).
- `worker/sanitize.ts` is isomorphic-capable (pure string/regex).

## Decision Drivers

- **PWA trajectory** — the future reader needs client-side state for offline
  caching, background sync, push notifications. Any architecture that requires
  server round-trips for every interaction cannot become an offline PWA.
- **JSON API purity** — the aggregator clients (Wallabag mobile apps,
  FreshRSS, RSS readers) must keep fetching clean JSON from `/api/*`. Any
  framework that pushes HTML into `/api/*` breaks this
  ([ADR-0001](0001-wallabag-v2-api-compatibility.md),
  [ADR-0011](0011-json-only-api-no-content-negotiation.md)).
- **Progressive enhancement** — every interaction must submit a real
  `<form method=post action="/ui/...">` that the server handles, with JS only
  enhancing the experience.
- **Bundle / cold-start budget** — Workers pay for the JS that runs on the
  client; minimising client weight matters especially for the reader surface.
- **Team fluency** — React/Preact idioms are familiar; per-component
  statehooks are the cheapest path for islands that actually need state.
- **No new server dep** — `hono/jsx` already in the tree.

## Considered Options

### Option A — Hono JSX SSR + Web Components as islands (chosen)

The shell and read-only pages (entries list, entry reader, tags, settings
read view) render server-side via `hono/jsx`. Interactive islands
(filtering, forms, archive/star/delete, OAuth client CRUD, feed-token
buttons, WYSIWYG editor) are progressive-enhancement Web Components that
hydrate onto server-rendered markup. Client bundles produced by a single
new devDependency: `esbuild`.

### Option B — Preact SSR with selective hydration + islands

Same SSR shape, but islands are Preact components hydrated onto server HTML.
The full `/entry` page, or a future aggregator view, becomes a Preact app.

### Option C — HTMX as the primary UI layer + Preact islands only

HTMX drives 90% of the UI: lists, filtering, pagination, archive/star/delete,
settings, import. All PE-native (HTML fragments returned by endpoints).
Preact islands only for the WYSIWYG editor and a future PWA reader mode.

### Option D — Hono JSX SSR + Web Components + Preact island for the editor

Like Option A, but the `<entry-editor>` island is a Preact subtree rendered
via `@preact/custom-element`.

## Decision Outcome

**Option A.** Hono JSX SSR for the shell + read-only/form pages; vanilla Web
Components (no Lit initially; can add later if repetition justifies it) as
progressive-enhancement islands; a custom contentEditable editor built on
`Selection`/`Range` (NOT Preact — see [ADR-0015](0015-custom-contenteditable-editor-not-tiptap.md)).
A single new devDependency (`esbuild`) produces per-page client bundles.

No Preact, no React, no HTMX, no Vite.

## Pros and Cons of the Options

### Option A

- **Good**, because `hono/jsx` is already in `package.json`; no new server
  framework.
- **Good**, because vanilla Web Components compose natively with future PWA
  client state — the same `<entry-card>` element that enhances the SSR HTML
  today becomes the offline-capable card in the PWA, no rewrite.
- **Good**, because SSR-only pages ship zero client JS. Reader pages that
  only need server data pay nothing extra.
- **Good**, because Web Components compose cleanly with a future Preact
  island if one is warranted; the seam is `@preact/custom-element`. So
  Option D remains reachable as a follow-up without an ADR reversal.
- **Good**, because the JSON API stays pristine — Web Components consume
  `/api/*` over `fetch`, the server-rendered shell never needs to.
- **Bad**, because the team's React fluency is partially underused — Web
  Components' class + lifecycle is closer to React class components than to
  hooks.
- **Bad**, because optimistic updates, filtering, pushState need to be
  written manually per island (~30 lines each).
- **Bad**, because Web Components ship in browsers but lack the rich
  ecosystem of React/Preact (component libraries, devtools). Acceptable for
  this surface area.

### Option B (Preact SSR + hydration)

- **Good**, because teams fluent in React get matching ergonomics
  (`useState`, `useEffect`, JSX).
- **Good**, because Preact is the smallest React-compatible runtime (~3 KB
  gz) and supports streaming SSR out of the box.
- **Good**, because the future PWA reader is a natural Preact app from day
  one — no paradigm switch.
- **Bad**, because hydration fights strict PE. Hydrating a whole tree to
  "enhance" a few forms is wasteful; island-only hydration in Preact
  requires manual orchestration.
- **Bad**, because a hydration-driven SPA-ish UX on the entries list stops
  being strictly PE. The no-JS path becomes a degraded fallback, not a
  first-class citizen — contradicting [ADR-0010](0010-progressive-enhancement-as-hard-requirement.md).
- **Bad**, because the bundle story for a single reader page (Preact +
  hydrate client) is heavier than vanilla WCs for the same UX.

### Option C (HTMX + Preact islands)

- **Good**, because HTMX is PE-native: server returns HTML fragments, real
  forms, real links.
- **Good**, because declaring filtering and pagination is one tag
  (`hx-get`, `hx-push-url`).
- **Good**, because SSE/streaming for the future `/feed` aggregator is
  built in.
- **Bad**, because HTMX pollutes `/api/*` with HTML — the Wallabag JSON
  contract breaks unless we maintain a parallel `/fragments/*` set or
  content-negotiate every endpoint. Conflicts with
  [ADR-0001](0001-wallabag-v2-api-compatibility.md) +
  [ADR-0011](0011-json-only-api-no-content-negotiation.md).
- **Bad**, because HTMX is server-driven: it cannot read articles offline.
  The future PWA reader would have to throw out the HTMX shell and rewrite
  it in a stateful client. Worse than starting there.
- **Bad**, because the paradigm shift from React-fluent team to HTML
  attributes-driven hypermedia is ethanol and awkward.

### Option D (Hybrid: WCs everywhere, Preact for editor only)

- **Good**, because the editor is the single hardest piece of UI and React's
  state model genuinely helps there.
- **Good**, because the hybrid seam is clean: `@preact/custom-element` makes
  a Preact subtree literally a custom element.
- **Bad**, because adding a Preact runtime to the `/entry` page bundle (even
  code-split) adds maintenance complexity for one island.
- **Bad**, because the editor is well-bounded (toolbar + contentEditable);
  a custom WC can handle it without React — see
  [ADR-0015](0015-custom-contenteditable-editor-not-tiptap.md). The editor
  does not justify Preact.

## Consequences

- **Positive:** the entire reader/aggregator UI can be implemented with
  zero full-tree hydration. Strict PE holds — every page is fully
  functional with JS disabled.
- **Positive:** the `/api/*` surface stays pure JSON, never HTML. Web
  Components fetch JSON optimistically; mutations also go through the
  `/ui/*` server routes ([ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)).
- **Positive:** PWA becomes a future layer (service worker + manifest + a
  richer client island) without rewriting the shell. The WCs are the seam.
- **Negative:** islands that need optimistic updates must implement them
  manually in each custom element. A small shared client-utilities module
  (e.g. `web-ui/client/lib/api.ts`) avoids repetition.
- **Negative:** no Lit initially means hand-authoring
  `static observedAttributes`, `connectedCallback`, `attributeChangedCallback`.
  If repetition exceeds ~3–4 islands, revisit adding Lit (~5 KB).
- **Risk:** if the future aggregator view needs significant client state
  (sortable feeds, drag-and-drop), pure WCs may grow unwieldy. A follow-up
  ADR can introduce Preact for that one view (still as a custom element via
  `@preact/custom-element`) without rewriting the shell — Option D
  effectively.
- **Cross-reference:** editor framework decided at
  [ADR-0015](0015-custom-contenteditable-editor-not-tiptap.md); PE contract
  at [ADR-0010](0010-progressive-enhancement-as-hard-requirement.md); API
  purity at [ADR-0011](0011-json-only-api-no-content-negotiation.md);
  mutation routing at [ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md).
