# API contract requirements

The Wallabag v2 + FreshRSS-compatible JSON API contract. This file defines
the behaviours the server MUST exhibit for any client — Wallabag mobile apps,
CLI tools, RSS readers — independent of the browser UI.

See [ADR-0001](../decisions/0001-wallabag-v2-api-compatibility.md),
[ADR-0003](../decisions/0003-opaque-tokens-not-jwt.md),
[ADR-0004](../decisions/0004-oauth2-grant-types.md), and
[ADR-0011](../decisions/0011-json-only-api-no-content-negotiation.md).

## Stories

### API-CONTRACT-001 — `/api/*` is JSON unconditionally

**As a** Wallabag mobile app,
**I want** to receive JSON from `/api/entries/{id}` regardless of the
`Accept` header I send,

**so that** my JSON parser does not choke on HTML.

**Acceptance criteria:**

- **Given** a valid Bearer token,
- **When** `GET /api/entries/123` with `Accept: text/html`,
- **Then** the response status is `200` and the `Content-Type` is
  `application/json`.
- **And** the response body is a JSON object with the Wallabag entry shape.

Backed by [ADR-0011](../decisions/0011-json-only-api-no-content-negotiation.md).

### API-CONTRACT-002 — Entry response shape matches Wallabag

**As a** Wallabag client,
**I want** the entry response to contain the same fields as the upstream
Wallabag server (

**so that** every existing client works unmodified.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `GET /api/entries/{id}`,
- **Then** the response contains `id`, `title`, `url`, `origin_url`,
  `content`, `created_at`, `updated_at`, `published_at`, `is_archived`,
  `is_starred`, `is_public`, `domain_name`, `language`, `mimetype`,
  `preview_picture`, `reading_time`, `tags`, `annotations`, `authors`.
- **And** date formats match Wallabag's `2026-04-05T09:07:54+0000` style.

Backed by [ADR-0001](../decisions/0001-wallabag-v2-api-compatibility.md) and
`SPEC.md` §8.3.

### API-CONTRACT-003 — Collection list shape matches Wallabag (HATEOAS/HAL)

**As a** Wallabag client,
**I want** `/api/entries` to return the `_embedded.items` envelope and
`_links` pagination links,

**so that** pagination and filtering work without client-specific
extensions.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `GET /api/entries?page=2&perPage=30&archive=0`,
- **Then** the response contains `_embedded.items`, `_links.self`,
  `_links.first`, `_links.last`, `_links.next` (or `_links.prev`), `limit`,
  `page`, `pages`, `total`.
- **And** the `_links` URLs preserve all filter query parameters.

Backed by `SPEC.md` §8.4.

### API-CONTRACT-004 — OAuth2: `password`, `authorization_code`, `refresh_token`, `token` grants

**As a** Wallabag mobile app,
**I want** to obtain an access token via the `password` grant,

**so that** my app works without a redirect flow.

**Acceptance criteria:**

- **Given** a user with valid credentials,
- **When** `POST /oauth/v2/token` with `grant_type=password` and the
  user's `username`/`password`,
- **Then** the response is `200` with `access_token`, `expires_in: 3600`,
  `refresh_token`, `scope: null`, `token_type: "bearer"`.
- **And** subsequent requests with `Authorization: Bearer {access_token}`
  authenticate correctly.

Backed by [ADR-0004](../decisions/0004-oauth2-grant-types.md) and `SPEC.md` §6.

### API-CONTRACT-005 — Token revocation is reliable

**As a** user,
**I want** my access and session tokens to become invalid the moment I
revoke them,

**so that** lost devices or compromised sessions are recoverable.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `POST /api/auth/logout`,
- **Then** the `session` row in the DB is deleted and future requests with
  the same cookie return `401`.
- **Given** an OAuth client owner,
- **When** they delete a client (via `/api/oauth/clients/{id}` or the
  `/ui/oauth/clients/{id}/delete` form route),
- **Then** the client's tokens are revoked.

Backed by [ADR-0003](../decisions/0003-opaque-tokens-not-jwt.md).

### API-CONTRACT-006 — `GET /api/tags` returns the full tag set

**As a** Wallabag client,
**I want** `GET /api/tags` to return every tag for the user (no row cap),

**so that** large libraries are not silently truncated.

**Acceptance criteria:**

- **Given** a user with more than 200 entries and more than 200 distinct
  tags,
- **When** `GET /api/tags`,
- **Then** the response contains every tag in `_embedded.items` with `id`,
  `label`, `slug`.

Backed by [ADR-0013](../decisions/0013-shared-data-helpers-between-ui-and-api.md).
This is a new endpoint added as part of the UI migration; previously the
browser `/tags` page derived tags from `/api/entries?perPage=200`.

### API-CONTRACT-007 — Session cookie attributes are security-correct

**As a** security-conscious user,
**I want** my `session` cookie to be `HttpOnly`, `Secure`, `SameSite=Strict`,
and have a 30-day `Max-Age`,

**so that** it is not exfiltratable by JS, sent on cross-site requests, or
held indefinitely.

**Acceptance criteria:**

- **Given** a successful login,
- **When** the response includes `Set-Cookie: session=…`,
- **Then** the cookie attributes are exactly
  `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` and no
  `Domain` attribute is set.

Backed by [ADR-0003](../decisions/0003-opaque-tokens-not-jwt.md) and
`packages/core/src/session/index.ts:buildSessionCookie`.

### API-CONTRACT-008 — CSRF does not break legitimate clients

**As a** Wallabag mobile app,
**I want** CORS and CSRF controls to not interfere with my JSON requests,

**so that** clients using Bearer tokens are unaffected by browser-only
defences.

**Acceptance criteria:**

- **Given** a request with `Authorization: Bearer …`,
- **When** the request mutates data via `/api/*` or `/oauth/*`,
- **Then** no `Origin`/CSRF token is required.
- **Given** a request to `/ui/*` (browser form mutation),
- **When** the request includes a `SameSite=Strict` cookie,
- **Then** the request succeeds.

Backed by [ADR-0014](../decisions/0014-ui-mutation-routes-under-ui-namespace.md).

### API-CONTRACT-009 — `.json` suffix is tolerated

**As a** legacy Wallabag client,
**I want** `GET /api/entries.json` to behave like `GET /api/entries`,

**so that** the Symfony `.{_format}` pattern does not break my workflow.

**Acceptance criteria:**

- **Given** any `/api/*.json` URL,
- **When** the Worker receives it,
- **Then** the `.json` suffix is stripped before routing and the response
  is identical to the suffix-less URL.

Backed by `packages/api/src/index.ts` (strip-`.json`-then-route); see ADR-0018 for the split.

## Out of scope for this file

- Session-cookie-issuing specifics (covered in
  [`security.md`](security.md)).
- Performance budgets are in [`performance.md`](performance.md).
- Browser-UI rendering concerns are in [`ui-ssr.md`](ui-ssr.md).
