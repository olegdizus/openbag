# OpenBag documentation

This folder holds architecture decisions (ADRs) and system requirements that
are **load-bearing contracts** for the codebase. The README, SPEC, and code
comments answer "what is this?" — these documents answer **why is it this
way?** and **what must remain true?**

## Layout

```
docs/
  README.md                ← you are here
  adr/                     ← Architecture Decision Records (MADR format)
    0001-…md
    …
    0017-…
  requirements/            ← User-story requirements (RFC 2119)
    README.md
    ui-ssr.md
    progressive-enhancement.md
    api-contract.md
    performance.md
    security.md
```

## ADR catalogue

`ADR-NNNN-slug.md` — one decision per file, numbered monotonically. Once
written, an ADR is immutable; status moves from `Accepted` to `Superseded`
via a new ADR that explicitly amends it.

| # | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](adr/0001-wallabag-v2-api-compatibility.md) | Wallabag v2 API compatibility as a non-negotiable contract | Accepted | 2026-06-10 *(retroactive)* |
| [0002](adr/0002-d1-as-primary-database.md) | Cloudflare D1 as the primary database | Accepted | 2026-06-10 *(retroactive)* |
| [0003](adr/0003-opaque-tokens-not-jwt.md) | Opaque session and OAuth tokens (not JWT/PASETO) | Accepted | 2026-06-10 *(retroactive)* |
| [0004](adr/0004-oauth2-grant-types.md) | Supported OAuth2 grant types | Accepted | 2026-06-10 *(retroactive)* |
| [0005](adr/0005-fetched-content-sanitized-on-save.md) | Entry content is sanitised on save, not on render | Accepted | 2026-06-10 *(retroactive)* |
| [0006](adr/0006-hono-as-api-framework.md) | Hono as the HTTP framework | Accepted | 2026-06-10 *(retroactive)* |
| [0007](adr/0007-htmlrewriter-prefetch-then-parser-pipeline.md) | HTMLRewriter pre-pass fixes the parser pipeline | Accepted | 2026-06-10 *(retroactive)* |
| [0008](adr/0008-static-assets-via-workers-platform.md) | Static assets served by the Cloudflare platform, not by the Worker | Accepted *(partially superseded by 0017)* | 2026-06-10 *(retroactive)* |
| [0009](adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md) | UI tech stack — Hono JSX SSR + Web Components (not Preact or HTMX) | Accepted | 2026-07-13 |
| [0010](adr/0010-progressive-enhancement-as-hard-requirement.md) | Progressive enhancement as a hard requirement | Accepted | 2026-07-13 |
| [0011](adr/0011-json-only-api-no-content-negotiation.md) | `/api/*` is JSON-only — no `Accept` content negotiation | Accepted | 2026-07-13 |
| [0012](adr/0012-separate-browserauth-and-api-auth-middleware.md) | Separate `browserAuthMiddleware` for SSR, distinct from `authMiddleware` | Accepted | 2026-07-13 |
| [0013](adr/0013-shared-data-helpers-between-ui-and-api.md) | Shared data helpers used by both UI and API | Accepted | 2026-07-13 |
| [0014](adr/0014-ui-mutation-routes-under-ui-namespace.md) | UI mutations go through `/ui/*` form-POST routes | Accepted | 2026-07-13 |
| [0015](adr/0015-custom-contenteditable-editor-not-tiptap.md) | Custom contentEditable `<entry-editor>` WC (no TipTap/ProseMirror) | Accepted | 2026-07-13 |
| [0016](adr/0016-big-bang-ui-migration-cutover.md) | Big-bang UI migration cutover (no parallel old/new runs in prod) | Accepted | 2026-07-13 |
| [0017](adr/0017-drop-spa-fallback-asset-binding.md) | Drop SPA fallback in `wrangler.jsonc`; UI routes live in the Worker | Accepted *(supersedes part of 0008)* | 2026-07-13 |
| [0018](adr/0018-core-and-split-into-separate-ui-and-api-workers.md) | `core` package + separate UI Worker and API Worker | Accepted *(supersedes 0013; reinforces 0011 & 0012)* | 2026-07-14 |

## Requirements catalogue

User stories in `As a <role>, I want <goal>` format with at least one
`Given / When / Then` acceptance criterion per story.

| File | Area | Stories |
| --- | --- | --- |
| [`requirements/README.md`](requirements/README.md) | Index + traceability | — |
| [`requirements/ui-ssr.md`](requirements/ui-ssr.md) | Server-side rendered UI shell and pages | UI-SSR-001 … UI-SSR-010 |
| [`requirements/progressive-enhancement.md`](requirements/progressive-enhancement.md) | Strict PE: every interaction must work without JS | UI-PE-001 … UI-PE-010 |
| [`requirements/api-contract.md`](requirements/api-contract.md) | JSON API contract for Wallabag/FreshRSS clients | API-CONTRACT-001 … API-CONTRACT-009 |
| [`requirements/performance.md`](requirements/performance.md) | Latency, bundle, and cost budgets | PERF-001 … PERF-009 |
| [`requirements/security.md`](requirements/security.md) | Session, CSRF, sanitisation, OAuth secret handling | SEC-001 … SEC-009 |

## ADR format

[Markdown Any Decision Records (MADR)](https://adr.github.io/madr/) —
lightweight, standardised. Each ADR has these sections:

1. **Status** and **Date** (and `Supersedes`/`Superseded by` if applicable).
2. **Context** — the forces and constraints at decision time.
3. **Decision Drivers** — what we were optimising for.
4. **Considered Options** — the choices seriously evaluated (not strawmen).
5. **Decision** — which option we picked.
6. **Pros and Cons of the Options** — at least one pro and one con per
   option.

ADRs never change after writing; status moves only via a new ADR that
supersedes them.

## How to write a new ADR

1. Pick the next number (`0018-…`, `0019-…`, …). Never reuse a number.
2. Copy [`adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md`](adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)
   as a template — it is the most complete worked example.
3. Fill in Context, Decision Drivers, Considered Options (with at least 2
   non-chosen options), Decision, Pros/Cons, Consequences.
4. If the new ADR supersedes an existing one, set `Supersedes: ADR-NNNN`
   in the header of the new one and `Superseded by: ADR-NNNN` in the
   superseded one (do NOT delete or rewrite the old one — it is the
   historical record).
5. Update the catalogue table in this README.
6. Update `requirements/README.md`'s traceability table if the new ADR
   constrains any requirement.

## How to add or change a requirement

1. Append to the relevant file under `requirements/` with a new
   `<AREA>-NNN` ID (don't reuse IDs).
2. Provide at least one `Given / When / Then` acceptance criterion that
   is testable (an assertion in `tests/integration/` or `tests/unit/`).
3. Cross-reference any backing ADR; if no ADR exists for the decision
   behind the requirement, open a new one.
4. Update `requirements/README.md`'s `Stories` column count.

## Cross-references

ADRs and requirements cross-link using relative paths:
`(ADR-NNNN)[../adr/NNNN-slug.md]`. Verify both directions when adding a
new document.
