---
# These are optional metadata elements. Feel free to remove any of them.
status: "accepted"
date: 2026-06-10
decision-makers: oleg
---

# HTMLRewriter pre-pass fixes the parser pipeline

## Context and Problem Statement

OpenBag fetches arbitrary third-party URLs, extracts article content, and
stores the result as `entry.content` (later rendered, see
[ADR-0005](0005-fetched-content-sanitized-on-save.md)). The pipeline must run
inside Workers' CPU budget, must handle ad-heavy or magazine-style pages that
confuse Readability, and must produce content Rich Text for ~95% of fetched
URLs without resorting to a headless browser.

The naive chain — `fetch(url)` → `linkedom` parse → `@mozilla/readability`
extract — succeeds on clean articles but fails badly on pages where:

- Readability gets distracted by nav/footer/sidebars/comments/Rich ads;
- Large ad-share HTML wastes linkedom CPU time before Readability discards
  it anyway;
- Modern pages ship content via JS (no static HTML in the response).

## Decision Drivers

- **CPU budget** — Workers have a default 30 s CPU limit; trade programs for
  less work per fetch.
- **Readability accuracy** — Readability makes good block decisions when
  noise landmass is removed first.
- **Fall-through semantics** — there must be a graceful path for pages that
  require JS rendering (Cloudflare Browser Rendering binding).
- **Test coverage** — `tests/unit/parser-footnotes.test.ts` and
  `tests/unit/parser-title.test.ts` capture regressions; the pipeline design
  must let those continue to pass.

## Considered Options

### Option A — HTMLRewriter pre-pass → linkedom → Readability → optional Browser Rendering (chosen)

Tagged in `SPEC.md` §7. The HTMLRewriter stage streams the fetched HTML and
removes obvious non-content elements (`<script>`, `<style>`, `<nav>`,
`<footer>`, `aside`, ad-classed elements, etc.). The result feeds linkedom,
then Readability, then a content-quality threshold. Insufficient output
triggers `env.BROWSER.quickAction("content", { url })` and re-runs the
linkedom + Readability stages on the rendered HTML.

### Option B — Readability alone

Skip the pre-pass; trust Readability's noise handling.

### Option C — Server-side cheerio

Parse with `cheerio`, run jQuery-like selectors to remove noise, then
Readability.

### Option D — Browser Rendering for every fetch

Always run headless.

## Decision Outcome

**Option A.** The four-stage pipeline from `SPEC.md` §7:

1. `fetch(url)` → raw HTML
2. **HTMLRewriter pre-pass** — strip elements and classes from the streaming
   response before it ever lands in a DOM. ~60–80% HTML reduction at
   near-zero CPU.
3. linkedom parses the cleaned HTML; Readability extracts from the parsed
   DOM.
4. Quality threshold (`textContent.length > 200` AND non-empty title).
   Insufficient → Cloudflare Browser Rendering (`env.BROWSER.quickAction("content",
   { url })`), re-run linkedom + Readability on the rendered DOM.

Element-level rules from `SPEC.md` §7.1 ("Always strip" and "Always preserve")
are conservative — when in doubt, leave the element in so Readability can
decide.

## Pros and Cons of the Options

### Option A

- **Good**, because HTMLRewriter streams; no full-buffer parse needed for the
  pre-pass.
- **Good**, because removing 60–80% of the HTML before linkedom drastically
  reduces CPU and memory pressure.
- **Good**, because it has measurable accuracy wins for noise-heavy sites
  (anecdotally across the existing test corpus).
- **Bad**, because HTMLRewriter is Workers-only — the parser is not
  Node-portable. Acceptable: OpenBag is Workers-only by design.
- **Bad**, because the ad-class wordlist needs maintenance as the web evolves.

### Option B (Readability alone)

- **Good**, because fewer moving parts.
- **Bad**, because Readability's noise handling is inconsistent on
  ad-heavy pages.
- **Bad**, because linkedom still pays the cost of parsing the full noisy DOM.

### Option C (cheerio)

- **Good**, because cheerio's selector ergonomics beat HTMLRewriter for
  removal rules.
- **Bad**, because cheerio introduces a second in-memory DOM (after linkedom)
  and a heavier Node-style dependency.
- **Bad**, because Chrome Workers surface for HTMLRewriter is free and faster
  for the streaming case.

### Option D (always-render)

- **Good**, because always-correct content extraction.
- **Bad**, because Browser Rendering is the most expensive resource per call;
  scaling across all fetches is uneconomic.
- **Bad**, because the per-fetch latency seconds — bad UX on the import flow.

## Consequences

- **Positive:** the migration of `web-ui` to SSR can render `entry.content`
  directly via `dangerouslySetInnerHTML` knowing the stored HTML is the
  output of Readability + sanitize-on-save (cf. [ADR-0005](0005-fetched-content-sanitized-on-save.md)).
- **Positive:** `tests/unit/parser-footnotes.test.ts` and
  `tests/unit/parser-title.test.ts` guard specific regressions (footnote
  paragraph repair, async-transformed `.text()` capture); future pipeline
  changes must keep them green.
- **Negative:** the wordlist in the strip-rules needs occasional curatorial
  work; the conservative policy means missed removals are tolerated over
  false-positive content removal.
- **Risk:** Browser Rendering is only invoked on Browser-Runtime-enabled
  deployments; the current `wrangler.jsonc` does not declare a `BROWSER`
  binding, so stage 4 is currently an aspirational fallback. Track enabling
  `browser` binding separately.
- **Cross-reference:** refetched feeds (`worker/queue/entry-refetch.ts`)
  reuse the same pipeline — keep the prep+parse+fallback logic in a single
  parser module (`worker/parser/index.ts`) so refetches behave
  identically to first import.
