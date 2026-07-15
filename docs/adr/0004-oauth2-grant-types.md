---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0004"
title: "ADR-0004: Supported OAuth2 grant types"
status: "accepted"
date: "2026-06-10"
deciders: ["oleg"]
---

# ADR-0004: Supported OAuth2 grant types

## Context and Problem Statement

Wallabag mobile apps, CLI tools, and browser extensions authenticate via OAuth2
access tokens issued by `/oauth/v2/token` (see `SPEC.md` §6.1, `worker/auth/routes.ts`,
`worker/auth/features/tokens`). Native Wallabag instances use the
`FOSOAuthServerBundle` and historically support four grant types; for true
drop-in compatibility the same set must be offered.

## Decision Drivers

- **Wallabag client compatibility** — the highest-priority goal per
  [ADR-0001](0001-wallabag-v2-api-compatibility.md). Mobile apps in particular
  use the `password` grant because they cannot reliably host redirect flows.
- **Key rotation / token renewal** — clients need `refresh_token` so that user
  action is not required every hour.
- **Third-party web integrations** — auth-code flow allows future integrations
  (e.g. sharing panels) without sharing the user's password.
- **Security posture** — modern OAuth2 guidance recommends PKCE for
  authorization-code and discourages implicit/token grant.

## Considered Options

### Option A — Match Wallabag's grant set verbatim (chosen)

Enable `password`, `authorization_code`, `refresh_token`, and legacy `token`
(implicit). Client ID format is `{id}_{randomId}` (e.g.
`1_3o53gl30vhgk0c8ks4cocww08o84448osgo40wgw4gwkoo8skc`). All four grants are
enabled by default on a newly created client.

### Option B — PKCE-only

Replace all four grants with `authorization_code` + PKCE.

### Option C — Drop the legacy `token` (implicit) grant

Keep `password`, `authorization_code`, `refresh_token`; disallow implicit.

## Decision Outcome

**Option A.** Mirror `FOSOAuthServerBundle`'s enabled grants. Token response
shape matches `SPEC.md` §6.3 exactly (`access_token`, `expires_in: 3600`,
`refresh_token`, `scope: null`, `token_type: "bearer"`). Client IDs follow the
Wallabag `{id}_{randomId}` format. All grants default-enabled on new clients.

## Pros and Cons of the Options

### Option A

- **Good**, because every Wallabag mobile app works without modification —
  `password` grant is what they ship with.
- **Good**, because legacy implicit `token` grant keeps very old browser
  extensions working.
- **Good**, because `refresh_token` is universal and unblocked.
- **Bad**, because `password` grant is deprecated by RFC 6749; modern guidance
  prefers PKCE. Mitigated by the compat-with-Wallabag constraint.
- **Bad**, because implicit `token` grant can leak tokens to URLs/history;
  considered legacy and risky.

### Option B (PKCE-only)

- **Good**, because it is the modern recommended flow; eliminates `password`
  grant security concerns.
- **Bad**, because it breaks every existing Wallabag mobile app, defeating the
  entire purpose per [ADR-0001](0001-wallabag-v2-api-compatibility.md).

### Option C (no implicit)

- **Good**, because implicit grant has well-known security flaws.
- **Bad**, because some legacy Wallabag browser extensions rely on it. Risk of
  invisible breakage.

## Consequences

- **Positive:** clients documented in `SPEC.md` §6.1 all work; `tests/integration/api-gaps.test.ts`
  guards OAuth client CRUD contracts.
- **Positive:** the developer page (UI list of clients) and the OAuth consent
  screen at `/oauth/v2/auth` (existing HTML route in `worker/auth/routes.ts`)
  reuse the same client rows.
- **Negative:** hosting a `password` grant means the Worker accepts
  username+password POSTs — must be segmented from CSRF (the
  `/ui/*` mutation routes will use cookie+CSRF, never the password grant).
- **Negative:** OAuth2 security reviewers will flag `password` and `token`
  grants. Future ADR may add restrictions per-client (e.g. allow-list `redirect_uri`,
  default-disable `token` grant for new clients) without breaking existing
  users.
