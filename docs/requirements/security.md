# Security requirements

Session management, CSRF, sanitisation, OAuth secret handling, and
authentication boundary enforcement. Backed by
[ADR-0003](../adr/0003-opaque-tokens-not-jwt.md),
[ADR-0004](../adr/0004-oauth2-grant-types.md),
[ADR-0005](../adr/0005-fetched-content-sanitized-on-save.md), and
[ADR-0014](../adr/0014-ui-mutation-routes-under-ui-namespace.md).

## Stories

### SEC-001 — Session tokens are opaque and hash-stored

**As a** operator concerned about DB leaks,
**I want** session tokens stored only as sha256 hashes,

**so that** a database read does not yield any usable session.

**Acceptance criteria:**

- **Given** a successfully created session,
- **When** the `sessions` row is inspected,
- **Then** the `token_hash` column holds `sha256(raw_token)` and the raw
  token is not persisted anywhere.
- **Given** the entire `sessions` table contents,
- **When** an attacker tries to forge a valid cookie from those hashes,
- **Then** no `session=` cookie value derivable from the table passes
  `lookupSession`.

Backed by [ADR-0003](../adr/0003-opaque-tokens-not-jwt.md) and
`packages/core/src/session/index.ts:hashToken`.

### SEC-002 — Session cookie attributes are security-correct

**As a** operator,
**I want** session cookies to be invisible to JS and resistant to CSRF,

**so that** XSS cannot exfiltrate sessions and cross-site form POSTs are
blocked.

**Acceptance criteria:**

- **Given** any login or signup that issues a `session` cookie,
- **When** the response is inspected,
- **Then** `Set-Cookie` includes `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/`, and `Max-Age=2592000`, and excludes `Domain`.

Backed by `packages/core/src/session/index.ts:buildSessionCookie`;

[cross-ref API-CONTRACT-007](api-contract.md#api-contract-007--session-cookie-attributes-are-security-correct).

### SEC-003 — CSRF protection on `/ui/*` mutations

**As a** operator,
**I want** browser mutation endpoints to reject cross-site requests,

**so that** a malicious third-party page cannot submit actions on the
user's behalf.

**Acceptance criteria:**

- **Given** an authenticated browser submitting `POST /ui/settings`,
- **When** the request lacks a valid `csrf_token` field,
- **Then** the response is `403`.
- **When** the request is cross-site (no `SameSite=Strict` cookie match),
- **Then** the cookie is not sent and the request fails authentication.

Backed by [ADR-0014](../adr/0014-ui-mutation-routes-under-ui-namespace.md).

### SEC-004 — HTML sanitisation on save is enforced on every write path

**As a** reader,
**I want** every `entry.content` write to be sanitised,

**so that** no XSS payload reaches the reader, share page, or any future
render surface.

**Acceptance criteria:**

- **Given** any code path that updates `entry.content` (parser save,
  `PATCH /api/entries/{id} { content }`, content reset, future WC save),
- **When** the write is performed,
- **Then** `sanitizeEntryHtml(content)` runs before the value reaches the
  DB.
- **And** any try to skip the sanitiser is a CI/code-review failure.

Backed by [ADR-0005](../adr/0005-fetched-content-sanitized-on-save.md)
and `packages/core/src/sanitize/index.ts`.

### SEC-005 — OAuth2 client secrets never appear in SSR HTML

**As a** developer reviewing the codebase,
**I want** OAuth client secrets to never be rendered into pages visible
to anyone other than the owner,

**so that** secrets cannot leak via SSR rendering bugs.

**Acceptance criteria:**

- **Given** a user with OAuth clients,
- **When** `GET /developer`,
- **Then** the rendered HTML contains the secret only for clients owned
  by the logged-in user.
- **And** the share page (`/share/{uuid}`) and any public route never
  emit any OAuth secret.

Backed by [ADR-0004](../adr/0004-oauth2-grant-types.md).

### SEC-006 — Same-origin enforcement on `/api/auth/*` POSTs

**As a** operator,
**I want** `POST /api/auth/login`, `/signup`, `/logout` to enforce
same-origin,

**so that** CSRF cannot log users in or out via third-party pages.

**Acceptance criteria:**

- **Given** a `POST /api/auth/login` with an `Origin` header,
- **When** the `Origin` host differs from the request host,
- **Then** the response is `403`.
- **Given** a `POST /api/auth/login` without an `Origin` header (curl),
- **When** processed,
- **Then** the request is allowed (curl is a legitimate API client).

Backed by `packages/web-gui/src/actions.ts:requireSameOrigin`.

### SEC-007 — SSR routes never leak user-controlled HTML in attributes

**As a** code reviewer,
**I want** the SSR layer to escape all user-controlled strings,

**so that** attribute-injection XSS is impossible.

**Acceptance criteria:**

- **Given** any SSR page that renders a user-controlled value (entry
  title, tag label, username),
- **When** that value contains `"><script>alert(1)</script>`,
- **Then** the rendered HTML escapes the value (via JSX auto-escaping)
  and the payload does not break out of any attribute.
- **And** the only deliberate `dangerouslySetInnerHTML` usage is on
  already-sanitised `entry.content`.

### SEC-008 — Browser and API auth surfaces are separated

**As a** operator,
**I want** the browser SSR routes to use `browserAuthMiddleware` and the
JSON API routes to use `authMiddleware`,

**so that** a browser auth failure never returns a JSON 401 and an API
auth failure never returns a 302 redirect.

**Acceptance criteria:**

- **Given** a request to an SSR route (`/entries`, `/entry`, etc.) with
  an expired session,
- **When** the middleware runs,
- **Then** the response is `302 See Other` with `Location: /login?next=…`.
- **Given** a request to `/api/entries` with an expired token,
- **When** the middleware runs,
- **Then** the response is `401` with a JSON body
  `{ error: { code: 401, message: "Unauthorized" } }`.

Backed by [ADR-0012](../adr/0012-separate-browserauth-and-api-auth-middleware.md).

### SEC-009 — OAuth2 grant types are the Wallabag-compatible set

**As a** operator,
**I want** the OAuth2 grant types to match the Wallabag reference server,

**so that** client behaviour is predictable and matches the documented
Wallabag feature set.

**Acceptance criteria:**

- **Given** an OAuth client,
- **When** created via `/api/oauth/clients`,
- **Then** the four grants (`password`, `authorization_code`,
  `refresh_token`, `token`) are enabled by default.
- **And** the client ID is formatted as `{id}_{randomId}`.

Backed by [ADR-0004](../adr/0004-oauth2-grant-types.md) and
`SPEC.md` §6.

## Out of scope for this file

- TLS / HTTPS configuration is enforced by Cloudflare; not contractual at
  app level.
- D1 row-level security is out of scope; the application enforces
  user-scoping in every query.
