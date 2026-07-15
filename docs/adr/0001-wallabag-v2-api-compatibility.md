---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0001"
title: "ADR-0001: Wallabag v2 API compatibility as a non-negotiable contract"
status: "accepted"
date: "2026-06-10"
deciders: ["oleg"]
---

# ADR-0001: Wallabag v2 API compatibility as a non-negotiable contract

## Context and Problem Statement

OpenBag was started as an independent, from-scratch reimplementation of the
public Wallabag v2 API. The motivating goal is to run a read-it-later service on
Cloudflare Workers + D1 that is a **drop-in replacement** for a self-hosted
Wallabag instance: every official and third-party Wallabag client — mobile apps,
browser extensions, CLI tools, RSS readers using the Wallabag feed format — must
work without modification.

This contract predates the formal ADR practice in this repo and is encoded in
`SPEC.md` §1. It is captured here so that future proposals (e.g. content
negotiation for the browser UI) can be evaluated against an explicit
architectural commitment, not just an unwritten assumption.

See also `worker/api/index.ts` for the route surface and `SPEC.md` §8 for
the full endpoint catalogue.

## Decision Drivers

- **Client portability** — every Wallabag client must work unmodified. Any
  divergence from response shapes, status codes, or content types breaks a
  downstream we do not control.
- **Migration parity** — the original goal is to import an existing Wallabag
  database and have all existing clients continue to function.
- **Upstream reference surface** — the Wallabag API is documented externally;
  matching it gives us an unambiguous spec to conform to.

## Considered Options

### Option A — 1:1 wire-and-response compatibility (chosen)

Implement the Wallabag v2 API exactly as documented. Status codes, JSON shapes,
`_embedded`/`_links` (HATEOAS/HAL) envelopes, OAuth2 grant types, error body
conventions — all match upstream. `/api/*` is JSON-only; there is no `Accept`
content negotiation.

### Option B — "API-first reading app" with a Wallabag-flavoured compat layer

Design a clean modern API and expose a `/compat/wallabag/*` translation layer.

### Option C — Single-user home-API only (no Wallabag compat)

Skip the contract; build the API we want, ignore Wallabag clients.

## Decision Outcome

**Option A.** `/api/*` is the Wallabag v2 API. No translation layer, no
compatibility namespace. Response shapes match `SPEC.md` §8.3/§8.4 exactly.
`Accept: text/html` on `/api/*` MUST still return JSON — see
[ADR-0011](0011-json-only-api-no-content-negotiation.md).

## Pros and Cons of the Options

### Option A

- **Good**, because every Wallabag client works unmodified — zero user friction.
- **Good**, because the upstream API is our spec; less design work for the API.
- **Good**, because FreshRSS-style aggregator clients that consume the JSON API
  also work without negotiation.
- **Bad**, because some Wallabag response shapes are awkward (the singular
  `/api/tag/label?tag=…` DELETE endpoint, legacy `/list` vs `/lists` plural forms).
- **Bad**, because future UI work cannot lean on `/api/*` for HTML responses.

### Option B

- **Good**, because a clean modern API is easier to evolve.
- **Bad**, because every Wallabag client MUST be proxied — defeating the
  motivation.
- **Bad**, because the compat layer becomes its own divergence risk.

### Option C

- **Good**, because no awkward legacy shapes.
- **Bad**, because every Wallabag client breaks. Rejected — that is the whole
  reason OpenBag exists.

## Consequences

- **Positive:** future system choices are constrained by an explicit anchor. Any
  proposal that would change `/api/*` response shapes, status codes, or content
  types needs an ADR explicitly amending this one.
- **Positive:** the browser UI migration ([ADR-0011](0011-json-only-api-no-content-negotiation.md))
  has a clear answer for where mutations live: under `/ui/*`, not in `/api/*`.
- **Negative:** some awkward legacy paths (`/api/tag/label?tag=…`) must be
  preserved; refactors inside `/api/*` must respect the upstream shape.
- **Negative:** test coverage in `tests/integration/api-auth.test.ts` and
  `tests/integration/api-gaps.test.ts` doubles as a contract guard; any change
  there is meaningful.
