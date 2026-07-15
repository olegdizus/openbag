# Performance requirements

Worker bundle sizes, cold-start latency, and per-page JS budgets. All
numbers are upper bounds; failures MUST be surfaced as failing tests or
build assertions.

Backed by [ADR-0002](../decisions/0002-d1-as-primary-database.md),
[ADR-0007](../decisions/0007-htmlrewriter-prefetch-then-parser-pipeline.md),
[ADR-0009](../decisions/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md),
and [ADR-0017](../decisions/0017-drop-spa-fallback-asset-binding.md).

## Stories

### PERF-001 — Worker cold start under 200 ms

**As a** user hitting a fresh Worker,
**I want** the cold-start cost to be small,

**so that** initial loads do not feel slow.

**Acceptance criteria:**

- **Given** a Worker that has been idle long enough to be evicted,
- **When** the first request arrives,
- **Then** the worker boots in under 200 ms wall-clock on the sampled
  Cloudflare edge node.
- **And** the Worker bundle stays well under the 1 MB compressed limit
  (target: `<500 KB` compressed).

### PERF-002 — Page TTFB under 50 ms (warm)

**As a** reader,
**I want** the first byte of `/entries` to arrive quickly,

**so that** the page feels responsive.

**Acceptance criteria:**

- **Given** a warm Worker invocation,
- **When** `GET /entries` for a user with 30 entries,
- **Then** Time-to-First-Byte is under 50 ms.
- **And** the response is complete `<500 ms` total.

Backed by [ADR-0002](../decisions/0002-d1-as-primary-database.md) (D1 sub-ms
query latency) and [ADR-0009](../decisions/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)
(no `/api/auth/me` round-trip).

### PERF-003 — No client fetch on first paint

**As a** reader on a slow network,
**I want** the page HTML to be self-contained,

**so that** there is no waterfall before useful content appears.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `GET /entries`,
- **Then** the response body contains every entry row and the user
  identity in the header.
- **And** no JS-driven `fetch("/api/auth/me")` or `fetch("/api/entries")`
  is initiated before Web Component hydration.

Backed by [ADR-0009](../decisions/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md).

### PERF-004 — Per-page client JS budget

**As a** reader on a metered mobile connection,
**I want** each page's client bundle to be small,

**so that** bandwidth usage does not dominate the experience.

**Acceptance criteria:**

- **Given** the migrated UI,
- **When** inspecting the JS served to each page,
- **Then** the per-page bundle (excludes the editor bundle) is under
  `20 KB` gzipped.
- **And** the `/entry` page bundle including the editor is under `15 KB`
  gzipped (custom contentEditable WC; no TipTap — see
  [ADR-0015](../decisions/0015-custom-contenteditable-editor-not-tiptap.md)).

### PERF-005 — Web Components lazy-activate, not lazy-load

**As a** reader,
**I want** WC scripts to load with the page but not block first paint,

**so that** enhancements appear quickly without slowing initial render.

**Acceptance criteria:**

- **Given** any authenticated page,
- **When** the page is parsed,
- **Then** the WC bundle is referenced via `<script src="/c/{page}.js"
  defer></script>` (or `async`) so it does not block HTML parsing.
- **And** the bundle defines custom elements without performing work at
  module top-level.

### PERF-006 — Static assets bypass the Worker

**As a** reader,
**I want** `/css/app.css` and `/c/*.js` to be served by the Cloudflare
platform without burning Worker CPU,

**so that** cold-start capacity is not wasted on static files.

**Acceptance criteria:**

- **Given** `wrangler.jsonc` with `not_found_handling: "none"`,
- **When** a request for `/css/app.css` arrives,
- **Then** the platform serves the file and the Worker is not invoked.

Backed by [ADR-0017](../decisions/0017-drop-spa-fallback-asset-binding.md).

### PERF-007 — Article import pipeline uses HTMLRewriter streaming

**As a** user importing an article,
**I want** the fetch pipeline to strip noise via HTMLRewriter on the
streaming response,

**so that** import latency stays low even for ad-heavy pages.

**Acceptance criteria:**

- **Given** a `POST /api/entries` with a typical article URL,
- **When** the pipeline runs,
- **Then** HTMLRewriter pre-pass removes 60–80% of the HTML bytes before
  linkedom parses the result.

Backed by [ADR-0007](../decisions/0007-htmlrewriter-prefetch-then-parser-pipeline.md).

### PERF-008 — D1 query count per request

**As a** reader,
**I want** each page render to issue as few D1 queries as practical,

**so that** Worker CPU time stays low and D1 read costs stay predictable.

**Acceptance criteria:**

- **Given** `/entries` SSR render,
- **When** the handler runs,
- **Then** the number of D1 queries is at most `2` (one auth lookup +
  one entries page query).
- **Given** `/entry?id=…` SSR render,
- **Then** the number of D1 queries is at most `3` (auth + entry +
  tags).

### PERF-009 — Cloudflare assets cache hit ratio

**As a** reader behind a CDN edge node,
**I want** static assets to hit the edge cache,

**so that** repeated loads are fast.

**Acceptance criteria:**

- **Given** a populated edge cache,
- **When** the same `/css/app.css` is requested twice,
- **Then** the second response is served from cache (`cf-cache-status:
  HIT`) and the Worker is not invoked.

## Out of scope for this file

- Specific UI interaction timings (debounce, animation) are WC-internal
  and not contractual here.
- Database query plans belong in `packages/core/src/db/` documentation.
