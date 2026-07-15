---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0015"
title: "ADR-0015: Custom contentEditable `<entry-editor>` WC (no TipTap/ProseMirror)"
status: "accepted"
date: "2026-07-13"
deciders: ["oleg"]
---

# ADR-0015: Custom contentEditable `<entry-editor>` WC (no TipTap/ProseMirror)

## Context and Problem Statement

The current `web-ui/js/entry.js` ships a WYSIWYG article editor built on
`document.execCommand` (bold, italic, underline, headings, blockquote, link).
`document.execCommand` is deprecated; browsers inconsistently support it;
future maintenance risk is real. The UI migration (see
[ADR-0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)) moves this
editor into a Web Component. The natural moment to replace the deprecated
engine is now.

## Decision Drivers

- **Bundle size** — the editor is one component on one page; per-page JS
  budget for the rest of the app is <20 KB gzipped (see
  `docs/requirements/performance.md`).
- **Minimalist-but-pragmatic** — team prefers small, owned code over
  imported heavy frameworks when the cost of ownership is bounded.
- **Sanitisation authority** — the server is already the HTML safety
  authority (see [ADR-0005](0005-fetched-content-sanitized-on-save.md)); the
  editor's output is re-sanitised on `PATCH /api/entries/{id} { content }`,
  so the editor itself does not need to defend against XSS in its own
  output (the server will strip anything dangerous anyway).
- **Toolbar parity** — the existing 7 commands (P, H2, H3, Blockquote, Bold,
  Italic, Underline, Link) cover the use cases; no tables, no images, no
  code blocks. A simpler editor than TipTap/ProseMirror.
- **Selection edge cases** — the hardest part of any contentEditable
  implementation is boundary-spanning selections
  (`<p>ab[cd</p><p>ef]gh</p>`). `Range.surroundContents` throws in those
  cases; a `TreeWalker`-based fallback is required. Both custom and
  TipTap-style solutions face this — going custom just means we own the
  fallback.

## Considered Options

### Option A — Custom `<entry-editor>` WC built on Selection/Range/TreeWalker (chosen)

A single `web-ui/client/elements/entry-editor.ts`, ~400–500 LOC. The
`contentEditable` div is initialised with the SSR-rendered, already-sanitised
article content. Toolbar buttons call vanilla DOM/Selection helpers:

- **Bold/Italic/Underline** — wrap selection in `<strong>` / `<em>` / `<u>`
  via `Range.surroundContents` with a `TreeWalker`-based fallback that
  handles cross-block selections.
- **P/H2/H3/Blockquote** — find the closest block ancestor inside the
  editor, swap it for a new element of the target tag, move children,
  restore selection.
- **Link** — `prompt()` for URL, `Range.surroundContents(<a href>)` or
  `Range.insertNode` on a collapsed selection.

Public API: `getContent(): string` returns `innerHTML`; `setContent(html)`,
`reset()`. Save/Discard buttons call these plus the API.

### Option B — TipTap (`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-link`)

TipTap is the modern headless rich-text framework, built on ProseMirror.

### Option C — Keep `document.execCommand`

Port the existing toolbar to the WC verbatim; do not change the editing
engine.

### Option D — Markdown textarea

Replace WYSIWYG with a `<textarea>` + Markdown rendering preview.

## Decision Outcome

**Option A.** A custom Web Component with no editing-engine dependency.
The 7-toolbar-command feature surface is small enough that ~400–500 LOC of
vanilla DOM/Selection/Range covers it. The server-side sanitisation on save
(see [ADR-0005](0005-fetched-content-sanitized-on-save.md)) is the HTML
safety authority — the editor can output any HTML, the server strips what
is unsafe.

The WC ships in the `/entry` page bundle (~10–15 KB gz estimated). It is
activated by the user clicking the "Edit content" action; the article body
is otherwise rendered server-side as plain HTML.

## Pros and Cons of the Options

### Option A

- **Good**, because zero new deps; the editor is owned, debuggable, and
  fully under project control.
- **Good**, because the editor bundle stays small (~10–15 KB gz) which
  keeps `/entry` JS budget intact (see
  `docs/requirements/performance.md`).
- **Good**, because the sanitiser-on-save authority covers any output —
  the editor does not need to enforce safety; less to get right.
- **Bad**, because we hand-roll boundary-spanning selection logic. Must
  handle `<p>ab[cd</p><p>ef]gh</p>` with TreeWalker splits. ~100 LOC of
  careful code; must be covered by regression tests (`tests/unit/` or a
  future `tests/e2e/`).
- **Bad**, because if requirements later grow (tables, images, code
  blocks), we face a real rewrite. Trade-off: minimalism over
  future-proofing.

### Option B (TipTap)

- **Good**, because batteries-included: tables, images, code blocks,
  collaborative editing extensions all exist.
- **Good**, because ProseMirror handles all the selection edge cases
  precisely.
- **Bad**, because ~80 KB gz — larger than the entire rest of the UI
  combined. Tripling `/entry` JS bundle.
- **Bad**, because adds three new runtime deps (`@tiptap/core`,
  `@tiptap/starter-kit`, `@tiptap/extension-link`) plus their transitive
  closure (`prosemirror-*`). Surface area for a feature set we are not
  shipping.
- **Bad**, because lazy-loading the editor bundle is a partial mitigation
  but TipTap's chunk is irreducibly large.

### Option C (keep execCommand)

- **Good**, because zero new code today.
- **Bad**, because `document.execCommand` is deprecated; behaviour
  differs between Chrome and Firefox for several commands. Future-proofing
  is exactly what we want from this migration.

### Option D (Markdown textarea)

- **Good**, because pure code, no contentEditable quirks.
- **Bad**, because losing WYSIWYG is a UX regression for users editing
  rich articles. The current feature set is WYSIWYG; preserving parity
  rules out this option.

## Consequences

- **Positive:** `/entry` page bundle stays small (~10–15 KB gz) even with
  the editor eagerly loaded. No need for code-splitting gymnastics.
- **Positive:** the WC's public API (`getContent()`, `setContent()`,
  `reset()`) is small and testable; a unit test can set content, apply a
  formatting command, and assert `getContent()`.
- **Positive:** the carveout on strict PE is well-bounded: the *editor*
  is the one JS-required thing in the UI; the entry *reader* page is full
  PE. Documented in `docs/requirements/progressive-enhancement.md`.
- **Negative:** selection-boundary handling is fragile. A regression test
  must cover `<p>ab[cd</p><p>ef]gh</p>` selections every time the editor
  is touched.
- **Risk:** if a future feature requires table support or richer
  formatting, the unfixable answer is "rewrite as TipTap". A new ADR can
  supersede this one at that point; that ADR's "Options considered" will
  restate this trade-off explicitly.
- **Cross-reference:** server-side `sanitizeEntryHtml`
  (`worker/sanitize.ts`) is referenced for safety — the editor's
  output passes through it on save (see
  [ADR-0005](0005-fetched-content-sanitized-on-save.md)).
