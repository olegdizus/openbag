---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0003"
title: "ADR-0003: Opaque session and OAuth tokens (not JWT/PASETO)"
status: "accepted"
date: "2026-06-10"
deciders: ["oleg"]
---

# ADR-0003: Opaque session and OAuth tokens (not JWT/PASETO)

## Context and Problem Statement

OpenBag issues two kinds of bearer credentials:

- **Browser session cookies** for the web UI (`SESSION_COOKIE = "session"`).
- **OAuth2 access and refresh tokens** for Wallabag clients, issued from
  `/oauth/v2/token` and stored in `oauth_access_tokens` /
  `oauth_refresh_tokens`.

Both need revocation (logout, security events, OAuth2 user-managed revocation
via the developer page), and both must remain forge-proof even if the database
is leaked. The Wallabag API and its clients expect opaque bearer strings —
Wallabag's own FOSOAuthServerBundle does not use JWT.

## Decision Drivers

- **Revocation** — logout and admin force-logout must work; delegated tokens
  cannot be unilaterally invalidated if they are self-verifying.
- **Wallabag client compat** — clients send the token verbatim as a Bearer
  string and do not parse its contents.
- **DB-leak resilience** — even a full read of the `sessions` table must not
  grant valid sessions.
- **Key management simplicity** — no signing keys to rotate, distribute, or
  protect.

## Considered Options

### Option A — Opaque random tokens, sha256 persisted (chosen)

Generate 256-bit opaque secrets (`randomHex`); persist only sha256(secret) as
`token_hash`. Lookup is `SELECT … FROM sessions WHERE token_hash = ?`. See
`worker/session.ts` and `worker/auth/features/tokens`.

### Option B — Signed JWTs

Self-verifying JWTs with short TTL and a refresh-token rotation flow. Revocation
requires a separate allow-list/deny-list lookup.

### Option C — PASETO v4

Like JWT with fewer algorithm foot-guns, but still self-verifying.

### Option D — Opaque tokens stored in plaintext

Opaque but with the raw value stored verbatim.

## Decision Outcome

**Option A.** All tokens — sessions and OAuth2 access/refresh — are 256-bit
opaque random strings. The DB stores only `sha256(token)` as `token_hash`.
Every lookup hashes the incoming token and queries the hash.

- Session cookie attributes: `HttpOnly; Secure; SameSite=Strict; Path=/;
  Max-Age=2592000` (30 days). No `Domain` attribute (same-origin only).
- OAuth2 token response shape exactly matches `SPEC.md` §6.3 (Wallabag compat).

## Pros and Cons of the Options

### Option A

- **Good**, because revocation is trivial: `DELETE FROM sessions WHERE
  token_hash = ?` (cf. `revokeSession` in `worker/session.ts`).
- **Good**, because a DB leak does not yield any usable token; only hashes.
- **Good**, because there are no signing keys to manage or rotate.
- **Good**, because the wire format is the same that Wallabag/FOSUserBundle
  produces — clients do not care.
- **Bad**, because every authenticated request does one DB lookup; mitigated
  by D1 sub-millisecond latency within a Worker.
- **Bad**, because issuing and lookup both do a `crypto.subtle.digest`
  operation. Negligible CPU.

### Option B (JWT)

- **Good**, because requests can be validated without a DB lookup.
- **Bad**, because logout becomes advisory — the JWT is still self-valid.
  A revocation list reintroduces the DB lookup we were trying to avoid.
- **Bad**, because signing keys are a new operational surface (rotation,
  compromise handling).
- **Bad**, because clients would see `eyJ…` and possibly parse it — we lose
  opaqueness.

### Option C (PASETO)

- **Good**, because it removes JWT algorithm-misconfiguration foot-guns.
- **Bad**, because the self-validating + revocation trade-off is identical to
  JWT.
- **Bad**, because new ecosystem dep with no upside over Option A here.

### Option D (plaintext storage)

- **Good**, because lookup needs no hashing.
- **Bad**, because any DB read exposure grants live sessions — a hard fail of
  the DB-leak driver. Rejected.

## Consequences

- **Positive:** logout is robust (`POST /api/auth/logout`, `POST
  /api/oauth/clients/:id/revoke`); no token is valid past that point.
- **Positive:** `worker/session.ts` `lookupSession`/`createSession`/
  `revokeSession` is the single source of truth for browser-session behaviour.
- **Positive:** the future browser-auth middleware
  ([ADR-0012](0012-separate-browserauth-and-api-auth-middleware.md)) reuses
  `lookupSession` directly.
- **Negative:** every request hits D1 — but Workers + D1 keep this cheap at
  expected scale.
- **Negative:** no way to inspect a token's claims locally; debugging must go
  through DB queries.
