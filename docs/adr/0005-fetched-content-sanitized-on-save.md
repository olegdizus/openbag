---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0005"
title: "ADR-0005: Entry content is sanitised on save, not on render"
status: "accepted"
date: "2026-06-10"
deciders: ["oleg"]
---

# ADR-0005: Entry content is sanitised on save, not on render

## Context and Problem Statement

OpenBag fetches, parses, and stores third-party article HTML. That HTML is
later rendered by three trust levels:

1. **The authenticated reader** — `GET /api/entries/{id}` returns `content`;
   the browser UI injects it into the page.
2. **The public share page** — `GET /share/{uuid}` renders `entry.content`
   server-side into a full HTML document (see `worker/api/features/share/index.ts`).
3. **Future PWA/reader mode** offline views.

If untrusted HTML reaches any render surface, a script-injection or
script-execution vulnerability is plausible._sanitisation must therefore
happen exactly once, in a place that protects every render surface, including
those we add later.

## Decision Drivers

- **Single authority** — there must be one place that defines "safe". Multiple
  sanitise points drift apart; missing one is a CVE.
- **Performance** — repeated re-sanitisation on every render of an entry we
  might read several times is wasteful, especially for the share page where
  the same body may be fetched repeatedly.
- **Trust boundary clarity** — the Worker is the security boundary, not the
  browser DOM.
- **Editor integration** — the future WYSIWYG editor may produce any HTML;
  whatever the editor emits must pass through the same authority on save.

## Considered Options

### Option A — Sanitise on save (chosen)

`sanitizeEntryHtml(content)` runs once when the entry is created (parser
output) and on any subsequent content update (`PATCH /api/entries/{id}
{ content }`, content-reset handlers). The stored `content` column is
authoritatively safe; readers and the share page render it raw via
`innerHTML` / `dangerouslySetInnerHTML` without further scrubbing. Reading-time
estimation (`computeReadingTime`) is co-located.

### Option B — Sanitise on render

Pass stored content through a sanitiser inside every endpoint that returns
HTML.

### Option C — Sanitise in the browser before insertion

Trust the server; let the browser DOMPurify-equivalent clean on insert.

### Option D — Server-authoritative + client defense-in-depth

Sanitise on save AND on every render/insert (belt-and-braces).

## Decision Outcome

**Option A.** Sanitisation lives in `worker/sanitize.ts` and runs at every
write path that sets `entry.content`. The implementation is pure string/regex
and uses no DOM, so it is fast and runtime-portable (it is isomorphic-capable —
see "Consequences"). Render code (reader, `/share/{uuid}` HTML builder, editor
output) MUST treat `entry.content` as safe-to-render-raw.

## Pros and Cons of the Options

### Option A

- **Good**, because there is one security chokepoint. Easy to audit.
- **Good**, because sanitising once at save avoids re-paying the cost on every
  read of a popular entry.
- **Good**, because `sanitizeEntryHtml` is now a single function to test:
  `tests/unit/sanitize.test.ts` covers tag/attribute lists, event handlers,
  URL allowlists, style allowlists, and bad-input safety.
- **Good**, because the share path (`/share/{uuid}`) cannot trust any client,
  so server-side authority is the only viable location.
- **Bad**, because if `sanitizeEntryHtml` has a bug, every rendered entry
  exposes it. Mitigated by the unit test suite.
- **Bad**, because pre-migration entries (imported from a Wallabag database)
  are not guaranteed to have been through this sanitiser — see "Consequences".

### Option B (render-time)

- **Good**, because every render is independently safe.
- **Bad**, because it pays the cost on every read; for an entry viewed 50
  times, that is 50× the work.
- **Bad**, because the share page is server-rendered HTML, where there is no
  difference in cost from Option A but added complexity in the render path.

### Option C (browser-only)

- **Good**, because it pushes cost to the client.
- **Bad**, because the share page is server-side — there is no browser
  sanitiser to lean on. Rejected.
- **Bad**, because any API client that fetches and renders `content`
  (Wallabag mobile apps, RSS readers) bypasses our sanitiser entirely.

### Option D (both)

- **Good**, because belt-and-braces.
- **Bad**, because two implementations drift. Adds review surface without
  adding a meaningful boundary in this codebase.

## Consequences

- **Positive:** every consumer of `entry.content` can use `innerHTML` /
  `dangerouslySetInnerHTML` without an additional scrub. The future Hono JSX
  reader page ([ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md))
  and the WYSIWYG editor save path ([ADR-0015](0015-custom-contenteditable-editor-not-tiptap.md))
  both rely on this.
- **Positive:** `worker/api/features/share/index.ts` builds share HTML
  by interpolating `entry.content` into a `<article>` — safe by this ADR.
- **Risk:** entries imported from an existing Wallabag database may have
  bypassed `sanitizeEntryHtml`. Recommendation: a migration-time one-shot
  re-sanitise script for any imported `content`. Not resolved in this ADR.
- **Risk:** `sanitizeEntryHtml` is currently a single regex/string pipeline. A
  parser-based alternative (linkedom or DOMPurify-on-worker) would be safer at
  the cost of bundle/runtime. Track `tests/unit/sanitize.test.ts` regressions.
- **Operational note:** any new write path that mutates `entry.content` MUST
  run `sanitizeEntryHtml` — code review is responsible for enforcing this; we
  do not add a DB trigger today.
