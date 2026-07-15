# Architecture Decision Records

This directory holds the Architecture Decision Records (ADRs) for OpenBag.
Each ADR captures the context, options considered, and rationale for a
significant technical decision.

## Format

**[MADR 4.0.0](https://github.com/adr/madr)** — Markdown Architectural Decision
Records. Each ADR begins with a YAML frontmatter block (`status`, `date`,
`deciders`, and optional `consulted` / `informed`), followed by the MADR
section set:

- **Context and Problem Statement** *(mandatory)*
- **Decision Drivers** *(optional)*
- **Considered Options** *(mandatory)*
- **Decision Outcome** *(mandatory)*, with optional `### Consequences` and
  `### Confirmation` subsections
- **Pros and Cons of the Options** *(optional but expected for non-trivial decisions)*
- **More Information** *(optional — links, related ADRs, follow-ups)*

The full skeleton lives in [`template.md`](template.md). Copy it as the
starting point for a new ADR.

### Status values

MADR defines a free-form `status:` string; OpenBag uses the following
vocabulary:

| Status                              | Meaning                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `proposed`                          | Drafted, not yet accepted.                                 |
| `accepted`                          | Decision taken; in force.                                  |
| `deprecated`                        | No longer relevant; no direct replacement.                 |
| `rejected`                          | Considered, not adopted.                                   |
| `superseded by ADR-NNNN`            | Replaced by a later ADR (link also given in a body blockquote). |

The OpenBag ADR set additionally carries the convention of a leading
`> **Reinforced (YYYY-MM-DD) by [ADR-NNNN].**` blockquote when a later ADR
strengthens (but does not replace) an earlier one. "Reinforced" is **not a
status** — the underlying status stays `accepted`. It is a textual note that
points the reader at a later decision that builds on this one. The reverse
direction carries a matching `> **Reinforces …**` blockquote in the newer ADR
where useful.

## Index

| ADR                                                                                                              | Title                                                                          | Status                  | Date       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------- | ---------- |
| [0001](0001-wallabag-v2-api-compatibility.md)                                                                    | Wallabag v2 API compatibility as a non-negotiable contract                     | accepted                | 2026-06-10 |
| [0002](0002-d1-as-primary-database.md)                                                                           | Cloudflare D1 as the primary database                                          | accepted                | 2026-06-10 |
| [0003](0003-opaque-tokens-not-jwt.md)                                                                            | Opaque session and OAuth tokens (not JWT/PASETO)                               | accepted                | 2026-06-10 |
| [0004](0004-oauth2-grant-types.md)                                                                               | Supported OAuth2 grant types                                                   | accepted                | 2026-06-10 |
| [0005](0005-fetched-content-sanitized-on-save.md)                                                                | Entry content is sanitised on save, not on render                              | accepted                | 2026-06-10 |
| [0006](0006-hono-as-api-framework.md)                                                                            | Hono as the HTTP framework                                                     | accepted                | 2026-06-10 |
| [0007](0007-htmlrewriter-prefetch-then-parser-pipeline.md)                                                       | HTMLRewriter pre-pass fixes the parser pipeline                                | accepted                | 2026-06-10 |
| [0008](0008-static-assets-via-workers-platform.md)                                                               | Static assets served by the Cloudflare platform, not by the Worker             | accepted *(partially superseded)* | 2026-06-10 |
| [0009](0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)                                                     | UI tech stack — Hono JSX SSR + Web Components (not Preact or HTMX)             | accepted                | 2026-07-13 |
| [0010](0010-progressive-enhancement-as-hard-requirement.md)                                                      | Progressive enhancement as a hard requirement                                  | accepted                | 2026-07-13 |
| [0011](0011-json-only-api-no-content-negotiation.md)                                                             | `/api/*` is JSON-only — no `Accept` content negotiation                        | accepted                | 2026-07-13 |
| [0012](0012-separate-browserauth-and-api-auth-middleware.md)                                                     | Separate `browserAuthMiddleware` for SSR, distinct from `authMiddleware`       | accepted                | 2026-07-13 |
| [0013](0013-shared-data-helpers-between-ui-and-api.md)                                                           | Shared data helpers used by both UI and API                                    | superseded by ADR-0018  | 2026-07-13 |
| [0014](0014-ui-mutation-routes-under-ui-namespace.md)                                                            | UI mutations go through `/ui/*` form-POST routes                               | accepted                | 2026-07-13 |
| [0015](0015-custom-contenteditable-editor-not-tiptap.md)                                                         | Custom contentEditable `<entry-editor>` WC (no TipTap/ProseMirror)             | accepted                | 2026-07-13 |
| [0016](0016-big-bang-ui-migration-cutover.md)                                                                    | Big-bang UI migration cutover (no parallel old/new runs in prod)               | accepted                | 2026-07-13 |
| [0017](0017-drop-spa-fallback-asset-binding.md)                                                                  | Drop SPA fallback in `wrangler.jsonc`; UI routes live in the Worker            | accepted                | 2026-07-13 |
| [0018](0018-core-and-split-into-separate-ui-and-api-workers.md)                                                  | `core` package + separate UI Worker and API Worker                             | accepted                | 2026-07-14 |

## Creating a new ADR

```sh
# Scaffold from the template (cli). Number = next free.
cp docs/adr/template.md docs/adr/$(printf '%04d' $(( $(ls docs/adr | grep -E '^[0-9]{4}' | sort | tail -1 | cut -c1-4) + 1 )) )-short-kebab-title.md
```

Or with `adr-tools` (`brew install adr-tools`):

```sh
ADR_TEMPLATE_DIR=docs adr new "short kebab title"
# then refine the section bodies against docs/adr/template.md
```

Workflow:

1. Copy `template.md` → `NNNN-short-kebab-title.md` (next free number).
2. Fill `Context and Problem Statement`, `Considered Options`, `Decision Outcome`.
3. Add `Decision Drivers` if forces are non-obvious; add `Pros and Cons of the
   Options` if more than one option was seriously considered.
4. Set frontmatter `status: "proposed"` while drafting, flip to `accepted`
   once the decision is taken.
5. Update the table above and add `## More Information` cross-links to
   related / reinforced / superseded ADRs.
6. Markdown-lint with `pnpm lint:docs` before committing.

## When to write an ADR

Write one when a decision is **architecturally significant**: a binding
technology choice, a security invariant with consequences, a public contract
shape, or a topology change. Skip ADRs for routine upgrades, bug fixes, and
refactors that do not change the set of options.

## Conventions specific to OpenBag

- **Numbering.** Four-digit zero-padded, monotonically increasing across
  the whole repo. Never renumber.
- **Filename.** `<NNNN>-<kebab-case-short-title>.md`. Always lower-case.
- **Permalinks.** Other documents (`SPEC.md`, `docs/requirements/*`, code
  comments) cite ADRs by filename. Do not move files once linked.
- **Cross-references in body.** Markdown link to the target file
  (`[ADR-0018](0018-…)`) is preferred over bare `ADR-0018` mentions; the
  linter checks this.
