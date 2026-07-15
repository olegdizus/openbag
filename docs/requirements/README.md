# OpenBag requirements

User-story-style requirements for the OpenBag system, grouped by concern. Each
story follows `As a <role>, I want <goal>` with at least one
`Given / When / Then` acceptance criterion.

## Catalogue

| File | Area | Backing ADRs |
| ---- | ---- | ------------ |
| [`ui-ssr.md`](ui-ssr.md) | Server-side rendered UI shell and pages | [0009](../adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md), [0012](../adr/0012-separate-browserauth-and-api-auth-middleware.md), [0013](../adr/0013-shared-data-helpers-between-ui-and-api.md), [0016](../adr/0016-big-bang-ui-migration-cutover.md), [0017](../adr/0017-drop-spa-fallback-asset-binding.md) |
| [`progressive-enhancement.md`](progressive-enhancement.md) | Strict PE: every interaction must work without JS | [0010](../adr/0010-progressive-enhancement-as-hard-requirement.md), [0014](../adr/0014-ui-mutation-routes-under-ui-namespace.md), [0015](../adr/0015-custom-contenteditable-editor-not-tiptap.md) |
| [`api-contract.md`](api-contract.md) | The inviolable JSON API contract for Wallabag/FreshRSS clients | [0001](../adr/0001-wallabag-v2-api-compatibility.md), [0003](../adr/0003-opaque-tokens-not-jwt.md), [0004](../adr/0004-oauth2-grant-types.md), [0011](../adr/0011-json-only-api-no-content-negotiation.md) |
| [`performance.md`](performance.md) | Latency, bundle, and cost budgets | [0002](../adr/0002-d1-as-primary-database.md), [0007](../adr/0007-htmlrewriter-prefetch-then-parser-pipeline.md), [0009](../adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md), [0017](../adr/0017-drop-spa-fallback-asset-binding.md) |
| [`security.md`](security.md) | Session, CSRF, sanitisation, OAuth secret handling | [0003](../adr/0003-opaque-tokens-not-jwt.md), [0004](../adr/0004-oauth2-grant-types.md), [0005](../adr/0005-fetched-content-sanitized-on-save.md), [0014](../adr/0014-ui-mutation-routes-under-ui-namespace.md) |

## Conventions

- Each requirement has a stable ID, e.g. `UI-SSR-001`, that can be cited in
  PR titles and tests.
- Acceptance criteria are executable: prefer an `integration`/`unit` test
  file (`tests/integration/`, `tests/unit/`) that asserts the criterion.
- "MUST", "MUST NOT", "SHOULD" are RFC 2119 keywords.

## How requirements evolve

- Adding a requirement: append to the relevant file with a new ID.
- Removing/changing a requirement: open an ADR amending it; the ADR is the
  decision trace, the requirement is the live contract.
- Cross-references: use relative links to `../adr/NNNN-…`. Check both
  directions when adding an ADR (does any requirement need to cite it?).
