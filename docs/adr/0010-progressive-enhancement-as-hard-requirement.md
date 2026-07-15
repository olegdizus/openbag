---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0010"
title: "ADR-0010: Progressive enhancement as a hard requirement"
status: "accepted"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0010: Progressive enhancement as a hard requirement

## Context and Problem Statement

The migrated web UI must run on a wide variety of clients: search-engine
crawlers, RSS readers' in-app browsers, accessibility tools, slow mobile
connections, locked-down corporate browsers, and Tor. Supporting "JS disabled"
(or "JS broken") is a legitimacy claim, not a graceful-degradation footnote.

The current `web-ui/js/*.js` is a client-only rendering layer — it builds
every table and form by string concatenation after a `GET /api/auth/me`
round-trip. With JS disabled, the entire app is a blank page.

## Decision Drivers

- **Reader surface** — read-later readers benefit users with limited
  bandwidth or restrictive environments. PE is part of the product.
- **Smoke testability** — if no-JS works, then the HTML contract is well
  defined; JS enhancements layer onto a working baseline. This is the
  inverse of an SPA, where "remove JS" breaks everything.
- **Robustness** — server-side rendering means a JS error in any one
  island cannot take down the entire page; the worst case is that one
  island degrades to its server baseline.
- **Wallabag client parity** — Wallabag's own web UI is server-rendered
  PHP/Symfony; users coming from Wallabag expect the same behaviour.

## Considered Options

### Option A — PE as a hard requirement (chosen)

Every page is fully functional with JS disabled. Strict rules:

1. Every destructive or mutating action is a real `<form method=post
   action="/ui/...">` to a server route that mutates and redirects
   ([ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)).
2. Every navigation is a real `<a href="/real/url">`. URL params drive
   filters and pagination; no `pushState`-only flows.
3. Server endpoints that back a browser flow return HTML pages
   (e.g. `GET /entries` returns the page, `POST /ui/settings` returns
   `303 See Other` to `/settings`).
4. Web Components are layered ON TOP of working markup; they intercept
   via `event.preventDefault()`, optimistically update, and roll back on
   error.

JS adds: optimistic updates, pushState filtering, toasts, an editor, live
polling, etc. JS NEVER owns a behaviour.

### Option B — "Degrades gracefully" instead

Both paths work; the JS-off path is a fallback we test occasionally but
not a contract.

### Option C — Require JS for the whole app

Treat JS as a hard client dependency.

### Option D — PE for read paths, JS required for writes

Compromise: lists and reader pages work without JS; preferences, import,
and OAuth client CRUD require it.

## Decision Outcome

**Option A.** Strict PE for every page. The single accepted carveout is the
WYSIWYG *editor* in the entry page — see
[ADR-0015](0015-custom-contenteditable-editor-not-tiptap.md) — which requires
JS. The entry *reader* page is full PE; only the "Edit content" action is
JS-required, and that one action is reachable as a separate SSR form page
(`/entry/:id/edit`) if a no-JS edit path is later required.

## Pros and Cons of the Options

### Option A

- **Good**, because no-JS works for every page — crawlers see content,
  RSS-style readers see content, locked-down browsers work.
- **Good**, because the contract is testable: write an integration test
  that hits every page WITHOUT a JS runtime; assert the expected DOM
  markers. This becomes a guard against future regressions.
- **Good**, because every mutating endpoint under `/ui/*` is a clear
  server concern — content negotiation is not needed there, so
  [ADR-0011](0011-json-only-api-no-content-negotiation.md) holds.
- **Bad**, because every mutating form needs a server endpoint that
  handles the POST and redirects. Eight endpoints in
  ([ADR-0014](0014-ui-mutation-routes-under-ui-namespace.md)) is the
  total cost.
- **Bad**, because the editor carveout is a visible inconsistency. Mitigated
  by keeping the carveout to one action on one page.

### Option B

- **Good**, because lower discipline cost — no CSF arguments about JS-only
  islands.
- **Bad**, because "we'll test it sometimes" drifts to "we'll test it never".
  No-JS support silently rots. Rejected.

### Option C (JS required)

- **Good**, because the team can use modern SPA ergonomics everywhere.
- **Bad**, because it breaks reader users on restrictive networks — a core
  user base for a read-later product.
- **Bad**, because it forecloses Android TalkBack + JS-off accessibility
  tooling. Rejected.

### Option D (PE for reads, JS for writes)

- **Good**, because it focuses PE effort where users feel it (reads).
- **Bad**, because writes are where users express intent; a JS-required
  "save preferences" breaks the contract for sessionStorage-disabled
  browsers and corporate proxies.

## Consequences

- **Positive:** a test asserting "every SSR route returns 200 with the
  expected DOM markers when JS is not executed" is meaningful. Future
  integrations cannot silently regress.
- **Positive:** the WC bundles (`web-ui/c/*.js`) become truly optional for
  every page except `/entry` (where the editor is). Per-page client budget
  stays small (see performance requirements).
- **Positive:** the share page (`/share/{uuid}`) already exhibits this
  contract — it is server-rendered HTML by design.
- **Negative:** every mutating endpoint has an HTML-return requirement.
  Specifically, every `/ui/*` POST MUST end with a `303 See Other`
  redirect, never a JSON body. This is a deliberate API design choice that
  must be respected on every new form.
- **Negative:** an editor-specific carveout is documented in
  [ADR-0015](0015-custom-contenteditable-editor-not-tiptap.md) and tracked
  in `docs/requirements/progressive-enhancement.md`.
- **Risk:** if a future feature genuinely requires client JS (e.g. drag-
  and-drop reorder in a future aggregator view), it lands as a carveout
  in its own ADR amending this one.
