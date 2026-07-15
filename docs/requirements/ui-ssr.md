# UI SSR requirements

Server-side rendered UI requirements for the migration from vanilla-JS
`packages/web-gui/` Hono JSX SSR + Web Components (see
[ADR-0009](../adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md)).

Because OpenBag is not in production, these requirements describe the
**target state** the migration lands on, not the current behaviour.

## Stories

### UI-SSR-001 — First-paint HTML contains the user identity

**As a** logged-in reader,
**I want** the page HTML to load fully on first request without a follow-up
fetch for who I am,
**so that** there is no flash of "logging in…" state and no extra round-trip.

**Acceptance criteria:**

- **Given** a logged-in user with a valid `session` cookie,
- **When** they `GET /entries`,
- **Then** the response HTML's `<header>` already contains the username in a
  `<span class="site-user">` element.
- **And** no client-side `GET /api/auth/me` round-trip is sent.

### UI-SSR-002 — Page shell renders consistently across all authenticated routes

**As a** reader navigating the app,
**I want** the header (brand, nav, user, logout) to look identical on every
authenticated page,
**so that** the navigation is predictable.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** they navigate to `/entries`, `/entry?id=…`, `/import`, `/settings`,
  `/tags`, `/developer`,
- **Then** each response contains a `<header class="site-header">` with the
  same nav links (Entries, Tags, Import, Settings, Developer) and the same
  `<span class="site-user">`.

Backed by [ADR-0009](../adr/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md).

### UI-SSR-003 — `/` redirects based on session

**As a** user landing on the root,
**I want** `/` to send me to the right place based on whether I am logged in,
**so that** I do not see a splash page.

**Acceptance criteria:**

- **Given** a valid session cookie,
- **When** `GET /`,
- **Then** the response status is `302` with `Location: /entries`.
- **Given** no session cookie,
- **When** `GET /`,
- **Then** the response status is `302` with `Location: /login`.

### UI-SSR-004 — Pages render entries server-side with full filter support

**As a** reader,
**I want** `/entries` to render the full filtered, paginated list server-side,

**so that** the page is usable immediately and crawlable.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `GET /entries?page=2&perPage=30&archive=0&starred=1&sort=created&order=desc`,
- **Then** the response is `200` HTML with a `<table>` of entries that match
  the filters.
- **And** the filter links (`All`, `Unread`, `Archived`, `Starred`, pagination
  `prev`/`next`) are plain `<a href="…">` elements with the right query
  parameters.
- **And** the table is populated by the shared `getEntries(env, filters)`
  helper (see [ADR-0013](../adr/0013-shared-data-helpers-between-ui-and-api.md)).

### UI-SSR-005 — `/entry` renders the article server-side

**As a** reader,
**I want** the entry page to render the article HTML on first paint,

**so that** the reader works without JS (modulo the editor carveout, see
[UI-PE-008](progressive-enhancement.md#ui-pe-008--the-editor-is-the-only-js-required-surface)).

**Acceptance criteria:**

- **Given** an entry with id `42`,
- **When** `GET /entry?id=42`,
- **Then** the response contains `<article>` with the title, metadata
  (URL, created_at, reading_time), tag chips, and sanitised content via
  `dangerouslySetInnerHTML` from `entry.content` (already sanitised on save
  per [ADR-0005](../adr/0005-fetched-content-sanitized-on-save.md)).

### UI-SSR-006 — `/login` and `/signup` render real forms

**As a** new or returning user,
**I want** the login page to render both the login and (if registration is
enabled) signup forms as real HTML forms,

**so that** submission works without JS.

**Acceptance criteria:**

- **Given** `ALLOWED_REGISTRATION=true` in wrangler vars,
- **When** `GET /login`,
- **Then** the response contains `<form method="post" action="/api/auth/login">`
  and `<form method="post" action="/api/auth/signup">`.
- **Given** `ALLOWED_REGISTRATION` missing or `false`,
- **When** `GET /login`,
- **Then** the response contains only the login form, with the signup section
  hidden server-side.

### UI-SSR-007 — `/settings` prefilled from server data

**As a** configuring user,
**I want** `/settings` to render with my current preferences and feed token
prefilled,

**so that** I can review and edit them without an initial fetch.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `GET /settings`,
- **Then** the `<form method="post" action="/ui/settings">` has `theme`,
  `items_per_page`, `reading_speed`, `language`, `action_mark_as_read`,
  `list_mode`, and `display_thumbnails` set from `getConfig(env, user.id)`.
- **And** the feed-token section displays the current token from
  `getFeedToken(env, user.id)`.

### UI-SSR-008 — `/developer` lists OAuth clients server-side

**As a** developer,
**I want** `/developer` to render my OAuth clients with credentials,

**so that** I can copy credentials into client apps without JS.

**Acceptance criteria:**

- **Given** a logged-in user,
- **When** `GET /developer`,
- **Then** the response contains one card per OAuth client from
  `getOAuthClients(env, user.id)` with Client ID formatted as
  `{id}_{random_id}`, secret, redirect URIs, grant types, and a delete form.

### UI-SSR-009 — `/tags` lists tags from the real endpoint

**As a** reader,
**I want** `/tags` to render all my tags from `getTags(env, user.id)`,

**so that** the list is not silently truncated at 200 entries.

**Acceptance criteria:**

- **Given** a user with more than 200 entries,
- **When** `GET /tags`,
- **Then** the response lists every tag (no 200-row cap), grouped by
  `label/slug` with counts, calling `getTags(env, user.id)` (see
  [ADR-0013](../adr/0013-shared-data-helpers-between-ui-and-api.md)).

### UI-SSR-010 — Static assets continue to be served by the platform

**As a** reader,
**I want** `/css/app.css`, `/img/...`, and the future `/c/*.js` bundles to
load fast,

**so that** the page is interactive quickly.

**Acceptance criteria:**

- **Given** the migrated `wrangler.jsonc` with `not_found_handling: "none"`,
- **When** `GET /css/app.css`,
- **Then** the platform serves the file directly without invoking the Worker.
- **And** the response does not pass through Hono.

Backed by [ADR-0017](../adr/0017-drop-spa-fallback-asset-binding.md).

## Out of scope for this file

- Interactive island behaviour (filtering via pushState, optimistic buttons,
  editor) is covered in [`progressive-enhancement.md`](progressive-enhancement.md).
- API response shapes are covered in [`api-contract.md`](api-contract.md).
- Performance budgets are covered in [`performance.md`](performance.md).
