# OpenBag


A [Wallabag] v2 API-compatible read-it-later service running entirely on Cloudflare Workers + D1.

Every official and third-party Wallabag client — browser extensions, mobile apps, CLI tools — works without modification. Deploy on Cloudflare's free/paid tier with zero server management.

> **Not affiliated with, sponsored by, or endorsed by wallabag or Nicolas Lœuilet.**
> "Wallabag" is a trademark of its respective owners.
> OpenBag is an independent, from-scratch reimplementation of the public Wallabag v2 API.


## Features

- **1:1 API compatibility** with Wallabag v2 — drop-in replacement for self-hosted instances (independent implementation, no shared code)
- **OAuth2 server** with `password`, `authorization_code`, `refresh_token`, and `token` grant types
- **Article parsing pipeline** — HTMLRewriter pre-pass → linkedom + Readability → Browser Run fallback
- **Full-text search** via SQLite FTS5 (trigram + unicode61 tokenizers)
- **Web UI** — Hono JSX server-side rendering + progressive-enhancement Web Components; strict progressive enhancement (works without JS)
- **Import from 10+ sources** — Wallabag v1/v2, Pocket, Instapaper, Pinboard, Firefox/Chrome bookmarks, and more
- **Export to 7 formats** — TXT, CSV, JSON, XML, Markdown, PDF, EPUB
- **Tagging rules engine** — auto-tag entries using RulerZ-compatible expressions
- **Annotations** — highlight and comment on article passages
- **Public share links** — generate shareable URLs for saved articles
- **RSS/Atom feeds** — subscribe to your reading list from any feed reader (Reeder, Feedly, Miniflux); token-authed so RSS clients that can't send OAuth headers still work
- **Background jobs** — Cron Triggers + Queues for entry refetching, token cleanup, and imports
- **Image proxy** via Cloudflare Cache API


## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Cloudflare Workers (two — `openbag-api` + `openbag`) |
| Database | Cloudflare D1 (SQLite), single database shared by both Workers |
| HTTP framework | [Hono][hono] (one router per Worker) |
| Shared logic | `@openbag/core` workspace package (pure TypeScript) |
| Validation | Typia (compile-time AST transforms) |
| Frontend | Hono JSX SSR + Web Components |
| Headless browser | Cloudflare Browser Rendering (bound to the API Worker) |
| Background jobs | Cloudflare Cron Triggers + Queues (owned by the API Worker) |
| Testing | Vitest + Playwright |
| Language | TypeScript (strict) |


## Project Structure

```text
packages/
├── core/         # @openbag/core — shared foundation: types, queries, session, crypto,
│                 #                              sanitize, parser, auth primitives. Pure TS, no Hono.
├── api/          # @openbag/api — API Worker (openbag-api): /api/*, /oauth/*, /share/* (JSON-only)
│                 # Wallabag serializers, JSON envelopes; owns queues + cron + Browser Rendering
└── web-gui/      # @openbag/web-gui — UI Worker (openbag): /, /entries, /entry, /settings, /tags, …
                  # Hono JSX SSR + Web Components; /ui/* form-POST mutations; owns static assets
migrations/       # D1 SQL migrations (applied via the API Worker's wrangler.jsonc)
tests/
├── unit/         # Per-package unit tests
├── integration/  # API request/response integration tests (Wallabag JSON contract)
├── e2e/          # Playwright tests against dev deployment
└── compat/       # Wallabag response shape compatibility tests
```

> **Two Workers, one database, pnpm workspace.** OpenBag is split into two Cloudflare Workers sharing one D1 database via the
> `@openbag/core` workspace package. The UI Worker reads D1 directly through
> `core` — no subrequest cost on SSR. Cloudflare routes `/api/*`, `/oauth/*`,
> `/share/*` to `openbag-api` and `/*` to `openbag` on the apex domain.
>
> Cross-package imports use package aliases (`@openbag/core`), never relative paths:
> `api/` and `web-gui/` both declare `"@openbag/core": "workspace:*"` in their
> `package.json`, and the repo root's `pnpm-workspace.yaml` declares
> `packages: ["packages/*"]`. This keeps imports stable under file moves and
> lets IDE goto-definition work across packages.


## Prerequisites

- [Node.js][node-js] (v20+)
- A [Cloudflare account][cloudflare-account] with D1 access


## Setup


### 1. Install Dependencies

```bash
pnpm install
```


### 2. Create a D1 Database

```bash
wrangler d1 create openbag-db
```

Update the `database_id` in `wrangler.jsonc` with the ID from the output.


### 3. Run Migrations

```bash
pnpm db:migrate:local    # Local development
pnpm db:migrate           # Production
```


### 4. Provision the First User

Account creation via the web UI (`/signup`) is **disabled by default**
(fail-closed). Provision the first user out-of-band with the bundled script —
it runs locally and writes straight to D1 via `wrangler`, so the registration
flag cannot block it:

```shell
pnpm create-user -- --username admin --password 's3cret!' --email admin@example.com
# add --local to target the dev (miniflare) D1 instead of production
```

Passwords are hashed with PBKDF2-SHA256 (600k iterations, 16-byte random salt).
To enable self-service signup afterwards, set `ALLOWED_REGISTRATION` (see below).


### 5. Start Development Server

```bash
pnpm dev
```

The project runs two Cloudflare Workers (`openbag-api` +
`openbag`) sharing one D1 database. `pnpm dev` runs them
concurrently with separate `wrangler dev` processes under
`packages/api/wrangler.jsonc` and `packages/web-gui/wrangler.jsonc`.

The UI client bundles are built with esbuild (one per page). To rebuild
them automatically while editing `packages/web-gui/src/entrypoints/**`, run
in a second terminal:

```bash
pnpm watch:client
```

The web-gui Worker then serves freshly-bundled `/c/*.js` from
`packages/web-gui/public/c/` without a Worker redeploy.


## Registration & User Provisioning

Account creation via the web UI (`/signup`) is controlled by the `ALLOWED_REGISTRATION` environment variable. It is **fail-closed**: disabled unless explicitly enabled.

| Value | Behavior |
| --- | --- |
| unset, `false`, `0`, `""`, `no`, `off` | Registration **disabled** (default) — `/signup` returns 404, `/api/info` reports `allowed_registration: false`, and `createUser` refuses |
| `true`, `1`, `yes`, `on`, or any other affirmative string | Registration **enabled** |

> Defaulting to disabled closes the self-register → mint-OAuth-client →
> privilege-escalation chain. Provision users out-of-band with `pnpm create-user`.


### Toggling Registration

Set the variable without redeploying via either:

```bash
wrangler secret put ALLOWED_REGISTRATION     # then enter "false"
```

…or in the Cloudflare dashboard: **Workers & Pages → your Worker → Settings → Variables and Secrets → Add**.

Local dev: set `ALLOWED_REGISTRATION` in your `.dev.vars` file.


### Creating Users When Registration Is Disabled

Provision users out-of-band with the bundled script — it runs locally and writes straight to D1 via `wrangler`, so the registration flag cannot block it:

```bash
pnpm create-user -- --username alice --password 's3cret!' --email alice@example.com
# add --local to target the dev (miniflare) D1 instead of production
```


## API Endpoints


### Authentication (OAuth2)

| Endpoint | Description |
| -------- | ----------- |
| `/oauth/v2/token` | Issue/refresh tokens |
| `/oauth/v2/auth` | Authorization page (auth code flow) |


### Entries

| Endpoint | Method | Description |
| -------- | ------ | ----------- |
| `/api/entries` | GET | List entries (filtered, sorted, paginated) |
| `/api/entries` | POST | Save a new URL (fetch & parse) |
| `/api/entries/{id}` | GET | Get single entry |
| `/api/entries/{id}` | DELETE | Delete entry |
| `/api/entries/{id}` | PATCH | Update entry (archive, star, etc.) |
| `/api/entries/{id}/export` | GET | Export entry (txt, csv, json, xml, md, pdf, epub) |
| `/api/entries/{id}/reload` | GET | Re-fetch & re-parse entry |
| `/api/entries/exists` | GET | Check if URL is already saved |


### Tags

| Endpoint | Method | Description |
| -------- | ------ | ----------- |
| `/api/tags` | GET | List all tags |
| `/api/tags` | DELETE | Delete tag by query param |
| `/api/tags/{id}` | DELETE | Delete tag by ID |


### Other

| Endpoint | Method | Description |
| -------- | ------ | ----------- |
| `/api/annotations/{entry}` | GET/POST | List/create annotations |
| `/api/search` | GET | Full-text search |
| `/api/config` | GET/PUT | User configuration |
| `/api/user` | GET | Current user info |
| `/api/info` | GET | Instance info |
| `/api/version` | GET | API version |
| `/share/{uuid}` | GET | Public article view |


## Connecting Wallabag Clients

Configure your Wallabag client (mobile app, browser extension, etc.) with:

| Setting | Value |
| ------- | ----- |
| Server URL | `https://your-worker.workers.dev` |
| Client ID | Created via the developer UI at `/developer` |
| Client Secret | Shown on client creation |
| Username | Your username |
| Password | Your password |


## Scripts

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Start local development server |
| `pnpm build` | Type-check and build |
| `pnpm deploy` | Deploy to production |
| `pnpm deploy:dev` | Deploy to dev environment |
| `pnpm test` | Run unit & integration tests |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm typecheck` | Type-check without building |
| `pnpm db:migrate` | Apply migrations (production) |
| `pnpm db:migrate:local` | Apply migrations (local) |
| `pnpm create-user` | Provision a user out-of-band (bypasses registration flag) |


## Environments

| Environment | D1 Database | Purpose |
| ----------- | ----------- | ------- |
| `dev` | `openbag-db-dev` | Staging/testing on `*.workers.dev` |
| `production` | `openbag-db-prod` | Live service on custom domain |


## Architecture


### Article Parsing Pipeline

```text
URL → fetch → HTMLRewriter (strip noise) → linkedom + Readability → Store
                                                        ↓ (if content insufficient)
                                          Browser Rendering (JS execution) → Retry
```


### Background Jobs

| Schedule | Job |
| -------- | --- |
| Hourly | Token cleanup, orphan tag removal |
| Daily (3 AM) | Refetch failed entries |
| Weekly (Sunday) | Cleanup orphaned images, re-apply tagging rules |


### Search

Dual FTS5 index strategy:

- **Trigram** — substring matching (`LIKE %term%` parity)
- **Unicode61** — word-level prefix matching

Results are combined and ranked by BM25.

[Wallabag]: https://www.wallabag.org/
[hono]: https://hono.dev/
[node-js]: https://nodejs.org/
[cloudflare-account]: https://dash.cloudflare.com/
