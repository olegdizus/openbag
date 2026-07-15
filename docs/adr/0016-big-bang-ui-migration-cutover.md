---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0016"
title: "ADR-0016: Big-bang UI migration cutover (no parallel old/new runs in prod)"
status: "accepted"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0016: Big-bang UI migration cutover (no parallel old/new runs in prod)

## Context and Problem Statement

OpenBag is not in production. The migration from the vanilla-JS `web-ui/`
to Hono JSX SSR + Web Components (see
[ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)) can land
however we want. Three commonly-considered patterns are: big-bang cutover,
page-by-page behind a feature flag, and page-by-page by URL split.

## Decision Drivers

- **No production users** — there are no SLAs, no rollout coordination,
  no risk of breaking a customer.
- **Simplicity** — fewer parallel code paths to maintain during the
  transition; fewer "is this route on the old or new path?" questions.
- **Reviewer focus** — one cutover PR gets focused review; multiple
  partial states diffuse attention.
- **Migration plan determinism** — the migration plan (`/memories/session/plan.md`)
  targets a clean end state.

## Considered Options

### Option A — Big-bang cutover (chosen)

Build the new SSR UI in parallel in `worker/ui/`; status quo
`web-ui/*.{html,js}` keeps working untouched. One cutover PR:

1. Adds the new UI routes and components.
2. Flips `wrangler.jsonc` from `not_found_handling:
   "single-page-application"` to `none` (see
   [ADR-0017](0017-drop-spa-fallback-asset-binding.md)).
3. Wires `root.route("/", uiApp)` in `worker/entrypoint.ts` BEFORE
   `root.route("/", apiApp)`.
4. Deletes `web-ui/*.html` (8 files) and `web-ui/js/*.js` (9 files).

### Option B — Page-by-page behind a `UI_V2` wrangler var

Each page migrates individually. The flag decides whether to render the
new SSR page or fall through to the legacy HTML.

### Option C — Page-by-page by URL: clean URLs for new, `.html` URLs for old

`/entries` → new SSR; `/entries.html` → legacy static.

### Option D — Per-user opt-in beta flag

A user setting flips them onto the new UI before it is generally available.

## Decision Outcome

**Option A.** Build in parallel, cut over in one PR, delete legacy
`web-ui/*.{html,js}`. The end state is the only state in `main`.

## Pros and Cons of the Options

### Option A

- **Good**, because no flag plumbing, no URL namespace overlap, no
  "which UI is this user on?" question to debug.
- **Good**, because the diff is honest about the intent: this replaces,
  not augments.
- **Good**, because production-vs-staging flag drift is impossible when
  there is no flag.
- **Bad**, because partial progress sits on an unmerged feature branch
  until everything migrates. Acceptable when not in production.
- **Bad**, because cutover PR is large. Mitigation: commit the new UI in
  sub-PRs (`worker/ui/` first, then the cutover flip in a smaller
  follow-up PR).

### Option B (flag)

- **Good**, because each page migrates independently without blocking
  others.
- **Good**, because rollback is per-flag.
- **Bad**, because not in production: rollback matters less than
  simplicity. The flag adds a `vars` entry, a `getConfig` branch, a test
  path; none of it is needed pre-launch.
- **Bad**, because every page render has to check the flag, complicating
  the SSR handlers with conditional routing.

### Option C (URL split)

- **Good**, because no flag, no ambivalence — the URL is the source of
  truth.
- **Bad**, because nav links, redirects, and share URLs all need
  migration as each page flips. Adds coordination burden across pages.
- **Bad**, because `index.html`'s meta-refresh to `/entries` aliases
  `/entries` to the legacy path; nested site-wide inconsistency.

### Option D (opt-in)

- **Good**, because early adopters can self-select.
- **Bad**, because the user-config branch adds complexity to every SSR
  handler.
- **Bad**, because not in production — the opt-in is testing overhead
  without the safety benefit.

## Consequences

- **Positive:** `main` always reflects one coherent UI reality.
- **Positive:** no flag defaulting ("is `UI_V2` true on staging?"); no
  drift.
- **Positive:** the cutover PR also removes the SPA-fallback config (see
  [ADR-0017](0017-drop-spa-fallback-asset-binding.md)) and the legacy
  `/api/auth/me` round-trip in the JS shell, in one atomic change.
- **Negative:** any feature added to the legacy UI during migration
  must be re-implemented on the new UI before cutover. Mitigation: freeze
  the legacy UI with a "UIFrozen, see migration plan" commit note;
  refuse PRs that touch `web-ui/js/*.js` for features.
- **Negative:** if cutover blocks on the editor (Phase 4 in the
  migration plan), the rest of the migrated UI waits. Mitigation: ship
  the editor as a follow-up — temporarily, the cutover can land with a
  "JS required for edit" button that does nothing without JS, while the
  custom editor arrives in a subsequent PR.
- **Risk:** if post-cutover a serious regression is discovered, there is
  no flag to flip back. Mitigation: `git revert` the cutover commit; the
  legacy `web-ui/*.{html,js}` files are deleted but recoverable from
  history.
