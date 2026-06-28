# Wallabag CF Worker

A fully [Wallabag](https://www.wallabag.org/) v2 API-compatible read-it-later
service running entirely on **Cloudflare Workers + D1**.

Every official and third-party Wallabag client — browser extensions, mobile
apps, CLI tools — works without modification. Deploy on Cloudflare's free/paid
tier with zero server management.

## Features

- **1:1 API compatibility** with Wallabag v2 — drop-in replacement for
  self-hosted instances
- **OAuth2 server** with `password`, `authorization_code`, `refresh_token`, and
  `token` grant types
- **Article parsing pipeline** — HTMLRewriter pre-pass → linkedom + Readability
  → Browser Run fallback
- **Full-text search** via SQLite FTS5 (trigram + unicode61 tokenizers)
- **HTMX management UI** for login, settings, OAuth clients, and article viewing
- **Import from 10+ sources** — Wallabag v1/v2, Pocket, Instapaper, Pinboard,
  Firefox/Chrome bookmarks, and more
- **Export to 7 formats** — TXT, CSV, JSON, XML, Markdown, PDF, EPUB
- **Tagging rules engine** — auto-tag entries using RulerZ-compatible
  expressions
- **Annotations** — highlight and comment on article passages
- **Public share links** — generate shareable URLs for saved articles
- **Background jobs** — Cron Triggers + Queues for entry refetching, token
  cleanup, and imports
- **Image proxy** via Cloudflare Cache API

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| API framework | [Hono](https://hono.dev/) |
| Validation | Typia (compile-time AST transforms) |
| Frontend | HTMX + server-rendered HTML |
| Headless browser | Cloudflare Browser Rendering |
| Background jobs | Cloudflare Cron Triggers + Queues |
| Testing | Vitest + Playwright |
| Language | TypeScript (strict) |

## Project Structure

```text
wallabag_cf_worker/
├── packages/
│   ├── core/         # Shared foundation — DB client, middleware, queue helpers, types
│   ├── auth/         # OAuth2 server — clients, tokens, grants, users
│   ├── parser/       # Article fetching & content extraction pipeline
│   ├── api/          # Hono API routes — entries, tags, annotations, search, etc.
│   └── web/          # HTMX management UI — auth, settings, developer, entries
├── migrations/       # D1 SQL migrations
├── src/
│   └── worker.ts     # Worker entry point (fetch + queue handlers)
└── tests/
    ├── unit/         # Per-package unit tests
    ├── integration/  # API request/response integration tests
    ├── e2e/          # Playwright tests against dev deployment
    └── compat/       # Wallabag response shape compatibility tests
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
  (`npm install -g wrangler`)
- A [Cloudflare account](https://dash.cloudflare.com/) with D1 access

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a D1 database

```bash
wrangler d1 create wallabag-db
```

Update the `database_id` in `wrangler.jsonc` with the ID from the output.

### 3. Run migrations

```bash
npm run db:migrate:local    # Local development
npm run db:migrate           # Production
```

### 4. Set admin credentials

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD_HASH
```

The password hash should be a bcrypt hash. You can generate one with:

```bash
npx bcrypt-cli <your-password>
```

### 5. Start development server

```bash
npm run dev
```

## API Endpoints

### Authentication (OAuth2)

| Endpoint | Method | Description |
|---|---|---|
| `/oauth/v2/token` | POST | Issue/refresh tokens |
| `/oauth/v2/auth` | GET | Authorization page (auth code flow) |

### Entries

| Endpoint | Method | Description |
|---|---|---|
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
|---|---|---|
| `/api/tags` | GET | List all tags |
| `/api/tags` | DELETE | Delete tag by query param |
| `/api/tags/{id}` | DELETE | Delete tag by ID |

### Other

| Endpoint | Method | Description |
|---|---|---|
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
|---|---|
| Server URL | `https://your-worker.workers.dev` |
| Client ID | Created via the developer UI at `/developer` |
| Client Secret | Shown on client creation |
| Username | Your username |
| Password | Your password |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local development server |
| `npm run build` | Type-check and build |
| `npm run deploy` | Deploy to production |
| `npm run deploy:dev` | Deploy to dev environment |
| `npm run test` | Run unit & integration tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run typecheck` | Type-check without building |
| `npm run db:migrate` | Apply migrations (production) |
| `npm run db:migrate:local` | Apply migrations (local) |

## Environments

| Environment | D1 Database | Purpose |
|---|---|---|
| `dev` | `wallabag-db-dev` | Staging/testing on `*.workers.dev` |
| `production` | `wallabag-db-prod` | Live service on custom domain |

## Architecture

### Article Parsing Pipeline

```text
URL → fetch → HTMLRewriter (strip noise) → linkedom + Readability → Store
                                                        ↓ (if content insufficient)
                                          Browser Rendering (JS execution) → Retry
```

### Background Jobs

| Schedule | Job |
|---|---|
| Hourly | Token cleanup, orphan tag removal |
| Daily (3 AM) | Refetch failed entries |
| Weekly (Sunday) | Cleanup orphaned images, re-apply tagging rules |

### Search

Dual FTS5 index strategy:

- **Trigram** — substring matching (`LIKE %term%` parity)
- **Unicode61** — word-level prefix matching

Results are combined and ranked by BM25.

## License

Private — All rights reserved.
