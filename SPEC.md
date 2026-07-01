# OpenBag — Architectural Specification

> A fully Wallabag v2 API-compatible read-it-later service running on Cloudflare
> Workers + D1.
>
> Independent reimplementation. Not affiliated with, sponsored by, or endorsed
> by wallabag or Nicolas Lœuilet.

## 1. Project Goals

- **1:1 API compatibility** with Wallabag v2 — every official and third-party
  client (browser extensions, mobile apps, CLI tools) must work without
  modification.
- **Personal drop-in replacement** for a self-hosted Wallabag instance. Deploy
  on Cloudflare's free/paid tier with zero server management.
- **Drop-in migration** — ability to import an existing Wallabag database.

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Full-text search | SQLite FTS5 (trigram + unicode61 tokenizers) |
| API framework | Hono |
| Validation | Typia v13 (compile-time AST transforms) |
| Build pipeline | ttsc → Wrangler (esbuild) |
| Frontend UI | Native semantic HTML + server-rendered, progressive-enhancement JS |
| Headless browser | Cloudflare Browser Run |
| Background jobs | Cloudflare Cron Triggers + Queues |
| Image proxy | Cloudflare Cache API |
| Testing | Vitest + Playwright + compatibility test suite |
| Language | TypeScript (strict) |

## 3. Cloudflare Bindings

```jsonc
// wrangler.jsonc
{
  "name": "openbag",
  "main": "dist/worker.js",
  "compatibility_date": "2026-06-10",
  "assets": { "directory": "./packages/web/dist" },
  "d1_databases": [
    { "binding": "DB", "database_name": "openbag-db" }
  ],
  "queues": {
    "producers": ["ENTRY_REFETCH", "TOKEN_CLEANUP", "IMPORT"],
    "consumers": [
      { "queue": "entry-refetch", "max_batch_size": 10, "max_retries": 3 },
      { "queue": "token-cleanup", "max_batch_size": 50 },
      { "queue": "import", "max_batch_size": 5, "max_retries": 5 }
    ]
  },
  "browser": { "binding": "BROWSER" },
  "triggers": {
    "crons": ["0 * * * *", "0 3 * * *", "0 0 * * 0"]
  }
}
```

- **Hourly cron**: token cleanup, orphan tag removal
- **Daily cron (3 AM)**: refetch failed entries
- **Weekly cron (Sunday midnight)**: cleanup orphaned images, re-apply tagging
  rules

## 4. Project Structure

```text
openbag/
├── packages/
│   ├── core/                        # Shared foundation
│   │   └── src/
│   │       ├── db/                  # D1 client, query helpers, schema types
│   │       ├── queue/               # Queue producer/consumer helpers
│   │       ├── middleware/          # Auth, CORS, error handling, logging
│   │       └── types/               # Shared TypeScript types (typia-validated)
│   │
│   ├── auth/                        # OAuth2 server
│   │   └── src/features/
│   │       ├── clients/             # OAuth client CRUD
│   │       ├── tokens/              # Access/refresh token management
│   │       ├── grants/              # Password, authorization_code, refresh_token
│   │       └── users/               # User management
│   │
│   ├── parser/                      # Article fetching & content extraction
│   │   └── src/features/
│   │       ├── fetcher/             # URL fetching, HTTP handling
│   │       ├── html-rewriter/       # HTMLRewriter noise-stripping pre-pass
│   │       ├── readability/         # linkedom + @mozilla/readability extraction
│   │       ├── browser-fallback/    # Browser Run /content fallback
│   │       └── metadata/            # Title, author, preview image, language detection
│   │
│   ├── api/                         # Hono API routes (main Worker entry)
│   │   └── src/
│   │       ├── features/
│   │       │   ├── entries/         # Entry CRUD, reload, exists, export
│   │       │   ├── tags/            # Tag CRUD, entry tagging
│   │       │   ├── annotations/     # Annotation CRUD
│   │       │   ├── search/          # FTS5 search endpoint
│   │       │   ├── config/          # User config endpoint
│   │       │   ├── tagging-rules/   # Rule export/evaluation engine
│   │       │   ├── share/           # Public share link generation
│   │       │   ├── import/          # Import from Pocket, Wallabag, etc.
│   │       │   └── users/           # /api/user endpoint
│   │       └── index.ts             # Hono app + Worker fetch/scheduled handlers
│   │
│   └── web/                         # Server-rendered HTML management UI
│       └── src/
│           ├── features/
│           │   ├── auth/            # Login page, session handling
│           │   ├── developer/       # OAuth client management pages
│           │   ├── settings/        # User config pages
│           │   ├── entries/         # Basic article list/detail views
│           │   └── share/           # Public share page rendering
│           ├── templates/           # HTML layout helper
│           └── assets/              # (Reserved) static asset sources
│
│   # Static assets (CSS, progressive-enhancement JS) live in
│   # packages/web/public/ and are served via the wrangler `assets` binding.
│
├── migrations/                      # D1 SQL migrations
│   ├── 0001_initial_schema.sql
│   ├── 0002_fts5_indexes.sql
│   └── 0003_seed_user.sql
│
├── tests/
│   ├── unit/                        # Per-package unit tests
│   ├── integration/                 # API request/response integration tests
│   ├── e2e/                         # Playwright tests against dev deployment
│   └── compat/                      # Wallabag response shape compatibility tests
│
├── wrangler.jsonc
├── tsconfig.json
├── ttconfig.json                    # ttsc config for typia transforms
└── package.json                     # Root workspace config
```

## 5. Build Pipeline

Typia v13 uses a Go-based AST transformer invoked via `ttsc`. The build must
compile TypeScript through `ttsc` before Wrangler bundles the output.

```jsonc
// ttconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist-ttsc"
  },
  "ttsc": {
    "plugin": { "transform": "typia/lib/transform" }
  }
}
```

```jsonc
// package.json scripts
{
  "scripts": {
    "build": "ttsc && wrangler deploy --dry-run",
    "dev": "ttsc --watch & wrangler dev",
    "deploy": "ttsc && wrangler deploy",
    "deploy:dev": "ttsc && wrangler deploy --env dev",
    "test": "vitest",
    "test:e2e": "playwright test",
    "db:migrate": "wrangler d1 migrations apply DB",
    "db:migrate:local": "wrangler d1 migrations apply DB --local"
  }
}
```

Flow: `ttsc` (transforms `typia.*<T>()` calls → inline validators) →
`dist-ttsc/` → Wrangler esbuild bundles → `dist/worker.js`.

## 6. Authentication — Full OAuth2

### 6.1 Supported Grant Types

| Grant Type | Flow | Use Case |
|---|---|---|
| `password` | Client sends username+password → token | Wallabag mobile apps, CLI tools |
| `authorization_code` | Browser redirect flow | Third-party web apps |
| `refresh_token` | Exchange refresh token → new access token | All clients for token renewal |
| `token` | Implicit grant (legacy) | Old browser-based clients |

### 6.2 Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/oauth/v2/token` | POST | Issue/refresh tokens |
| `/oauth/v2/auth` | GET | Authorization page (auth code flow) |
| `/developer` | GET | List OAuth clients (web UI) |
| `/developer/client/create` | GET/POST | Create OAuth client (web UI) |
| `/developer/client/delete/{id}` | POST | Delete OAuth client (web UI) |

### 6.3 Token Format

Opaque tokens (not JWT). Stored in D1 with expiration. This matches Wallabag's
FOSOAuthServerBundle behavior.

Response shape:

```json
{
  "access_token": "ZGJmNTA2MDdmYTdmNWFiZjcxOWY3MWYyYzkyZDdlNWIzOTU4NWY3NTU1MDFjOTdhMTk2MGI3YjY1ZmI2NzM5MA",
  "expires_in": 3600,
  "refresh_token": "OTNlZGE5OTJjNWQwYzc2NDI5ZGE5MDg3ZTNjNmNkYTY0ZWZhZDVhNDBkZTc1ZTNiMmQ0MjQ0OThlNTFjNTQyMQ",
  "scope": null,
  "token_type": "bearer"
}
```

### 6.4 Client ID Format

`{id}_{randomId}` — e.g.,
`1_3o53gl30vhgk0c8ks4cocww08o84448osgo40wgw4gwkoo8skc`. Matches Wallabag's
format exactly.

### 6.5 Allowed Grant Types Per Client

`token`, `authorization_code`, `password`, `refresh_token` — all enabled by
default on client creation, matching Wallabag's behavior.

## 7. Article Fetching & Parsing Pipeline

```text
URL
 │
 ├─► fetch(URL) ─► HTML response
 │                    │
 │                    ├─► HTMLRewriter pre-pass
 │                    │   Strip: <script>, <style>, <nav>, <footer>,
 │                    │   <header> (page-level), <iframe> (ads),
 │                    │   elements matching ad-related classes/IDs
 │                    │   (~60-80% HTML reduction, near-zero CPU)
 │                    │
 │                    ├─► linkedom (parse cleaned HTML → DOM)
 │                    │
 │                    ├─► @mozilla/readability (extract article)
 │                    │
 │                    ├─► Content quality check
 │                    │   ├── Sufficient? → Store article ✓
 │                    │   └── Empty/insufficient? → Fallback path ↓
 │                    │
 │                    └─► Browser Run fallback
 │                        env.BROWSER.quickAction("content", { url })
 │                        → Re-fetch with JS execution
 │                        → Repeat linkedom + Readability on rendered HTML
 │                        → Store article ✓
 │
 └─► Extract metadata: title, authors, domain_name, preview_picture,
     language, reading_time, mimetype
```

### 7.1 HTMLRewriter Pre-Pass Rules

**Always strip** (safe — Readability would discard anyway):

- `<script>`, `<noscript>`, `<style>`, `<link rel="stylesheet">`
- `<nav>`, `<footer>`, `<aside>` (non-content landmarks)
- `<iframe>` (ads, social widgets — preserve video embeds)
- Elements with classes/IDs matching: `ad-`, `adsense`, `sponsor`, `banner`,
  `social-`, `share-`, `popup`, `modal`, `cookie`, `newsletter`, `sidebar`

**Always preserve** (Readability needs these):

- `<article>`, `<main>`, `<div>`, `<p>`, `<h1>`-`<h6>`
- `<blockquote>`, `<figure>`, `<img>`, `<video>`
- `<ul>`, `<ol>`, `<li>`, `<a>`

**Conservative by design** — when in doubt, leave it in and let Readability
decide.

### 7.2 Content Quality Threshold

After Readability extraction, check:

- `textContent` length > 200 characters
- `title` is non-empty
- If both pass → accept; otherwise → trigger Browser Run fallback

## 8. API Endpoints — Full Compatibility

### 8.1 Entries

| Endpoint | Method | Description |
|---|---|---|
| `/api/entries` | GET | List entries (filtered, sorted, paginated) |
| `/api/entries` | POST | Create entry (fetch & parse URL) |
| `/api/entries/{entry}` | GET | Get single entry |
| `/api/entries/{entry}` | DELETE | Delete entry |
| `/api/entries/{entry}` | PATCH | Update entry properties |
| `/api/entries/{entry}/export` | GET | Export entry in format |
| `/api/entries/{entry}/reload` | GET | Re-fetch & re-parse entry |
| `/api/entries/{entry}/tags` | POST | Add tags to entry |
| `/api/entries/{entry}/tags/{tag}` | DELETE | Remove tag from entry |
| `/api/entries/exists` | GET | Check if entry exists by URL |
| `/api/entries/list` | GET | Deprecated list endpoint |
| `/api/entries/lists` | GET | Deprecated lists endpoint |
| `/api/entries/tags/list` | GET | Tags for entries list |
| `/api/entries/tags/lists` | GET | Tags for entries lists |

### 8.2 Entry List Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `archive` | integer (0,1) | 0 | Filter by archived status |
| `starred` | integer (0,1) | 0 | Filter by starred status |
| `sort` | string | `created` | Sort field: `created`, `updated`, `archived` |
| `order` | string | `desc` | Sort order: `asc`, `desc` |
| `page` | integer | 1 | Page number |
| `perPage` | integer | 30 | Results per page |
| `tags` | string | — | Comma-separated tags (AND match) |
| `since` | integer | 0 | Timestamp for updated entries |
| `public` | integer (0,1) | 0 | Filter by public link |
| `detail` | string | `full` | `full` (include content) or `metadata` |
| `domain_name` | string | — | Filter by domain |
| `annotations` | integer (0,1) | — | Filter by annotation presence |

### 8.3 Entry Response Shape

```json
{
  "_links": {
    "self": { "href": "/api/entries/1" }
  },
  "id": 1,
  "title": "Article Title",
  "url": "https://example.com/article",
  "origin_url": "https://referrer.com/page",
  "content": "<p>Full article HTML...</p>",
  "created_at": "2016-04-05T09:07:54+0000",
  "updated_at": "2016-04-05T09:07:54+0000",
  "published_at": "2016-04-05T08:00:00+0000",
  "is_archived": 0,
  "is_starred": 0,
  "is_public": 0,
  "domain_name": "example.com",
  "language": "en",
  "mimetype": "text/html",
  "preview_picture": "https://example.com/image.jpg",
  "reading_time": 5,
  "tags": [
    { "id": 1, "label": "tech", "slug": "tech" }
  ],
  "annotations": [],
  "authors": "Author Name"
}
```

### 8.4 Collection Response Shape (HATEOAS/HAL)

```json
{
  "_embedded": {
    "items": [ ...entries... ]
  },
  "_links": {
    "self": { "href": "/api/entries?page=1&perPage=30" },
    "first": { "href": "/api/entries?page=1&perPage=30" },
    "last": { "href": "/api/entries?page=5&perPage=30" },
    "next": { "href": "/api/entries?page=2&perPage=30" }
  },
  "limit": 30,
  "page": 1,
  "pages": 5,
  "total": 142
}
```

The `_links` pagination URLs must preserve all filter query parameters (archive,
starred, tags, since, domain_name, etc.).

### 8.5 Tags

| Endpoint | Method | Description |
|---|---|---|
| `/api/tags` | GET | List all tags |
| `/api/tags` | DELETE | Delete a tag (by query param) |
| `/api/tags/{tag}` | DELETE | Delete tag by ID |
| `/api/tag/label` | GET | Get tag by label |
| `/api/tags/label` | GET | Get tags by labels |

### 8.6 Annotations

| Endpoint | Method | Description |
|---|---|---|
| `/api/annotations/{entry}` | GET | List annotations for entry |
| `/api/annotations/{entry}` | POST | Create annotation |
| `/api/annotations/{annotation}` | PUT | Update annotation |
| `/api/annotations/{annotation}` | DELETE | Delete annotation |

Annotation shape:

```json
{
  "id": "abc123",
  "text": "Highlight comment",
  "quote": "The annotated text from the article",
  "ranges": [
    { "start": "/p[1]", "end": "/p[1]", "startOffset": 10, "endOffset": 50 }
  ]
}
```

### 8.7 Config

| Endpoint | Method | Description |
|---|---|---|
| `/api/config` | GET | Get user configuration |
| `/api/config` | PUT/PATCH | Update user configuration |

### 8.8 Search

| Endpoint | Method | Description |
|---|---|---|
| `/api/search` | GET | Search entries by term |

Query params: `term`, `page`, `perPage`. Searches across title, content, url,
and annotation text. Returns same collection shape as `/api/entries`.

### 8.9 Tagging Rules

| Endpoint | Method | Description |
|---|---|---|
| `/api/taggingrule/export` | GET | Export all tagging rules as JSON |

Tagging rules use an expression language with these allowed variables and
operators:

**Variables**: `title`, `url`, `isArchived`, `isStarred`, `content`, `language`,
`mimetype`, `readingTime`, `domainName`

**Operators**: `>`, `<`, `>=`, `<=`, `=`, `is`, `!=`, `and`, `not`, `or`,
`matches`, `notmatches`

Example rule: `domainName matches "*youtube*" and title notmatches "*music*"` →
tags: `video,entertainment`

Rules are evaluated automatically when new entries are saved.

### 8.10 Users

| Endpoint | Method | Description |
|---|---|---|
| `/api/user` | GET | Get current user info |

### 8.11 Other

| Endpoint | Method | Description |
|---|---|---|
| `/api/info` | GET | Instance info |
| `/api/version` | GET | API version (returns `"2.x"`) |

### 8.12 Public Share

| Route | Method | Description |
|---|---|---|
| `/share/{uuid}` | GET | Public article view (no auth) |

Returns server-rendered HTML with article title, content, OG meta tags, and link
to original URL.

## 9. Export Formats

| Format | Implementation |
|---|---|
| `txt` | In-Worker: strip HTML tags, plain text |
| `csv` | In-Worker: serialize fields to CSV |
| `json` | In-Worker: JSON serialize entry |
| `xml` | In-Worker: XML serialize entry |
| `markdown` | In-Worker: HTML → Markdown conversion |
| `pdf` | Browser Run: `env.BROWSER.quickAction("pdf", { url })` |
| `epub` | In-Worker: `epub-gen-memory` library (in-memory ZIP) |

## 10. Import Sources

Import is a web UI feature (standard HTML file upload form). Processing is
enqueued to Cloudflare Queues.

Supported sources:

- Wallabag v1, Wallabag v2 (JSON export)
- Pocket (CSV/HTML export)
- Instapaper (CSV export)
- Pinboard (JSON export)
- Readability (JSON export)
- Firefox bookmarks (HTML)
- Chrome bookmarks (HTML)
- Delicious, Shaarli, Omnivore, Elcurator

Import flow: Upload file → parse format → enqueue individual entries → Queue
consumer: check for duplicates, fetch & parse, store.

## 11. Image Proxy

When an entry has proxied images:

1. Rewrite image URLs in stored HTML to point to
   `/api/entries/{id}/images/{hash}`
2. On request: check Cache API for cached image
3. Cache miss: fetch original image, store in Cache API, serve
4. Cache hit: serve directly from cache

No persistent storage — images persist in CDN cache until evicted by LRU.

## 12. Full-Text Search (FTS5)

### 12.1 Dual Index Strategy

**Trigram index** — for substring matching (Wallabag `LIKE %term%` parity):

```sql
CREATE VIRTUAL TABLE entries_fts_trigram USING fts5(
  title, content, url,
  tokenize='trigram',
  content='entries',
  content_rowid='id'
);
```

**Unicode61 index** — for word-level search with prefix matching:

```sql
CREATE VIRTUAL TABLE entries_fts_words USING fts5(
  title, content, url,
  tokenize='unicode61',
  content='entries',
  content_rowid='id'
);
```

### 12.2 Search Strategy

- For queries ≥ 3 characters: use trigram index for substring matching
- For word-based queries: use unicode61 index with prefix operator
- Combine results, rank by BM25
- Also search annotations via a JOIN

### 12.3 Sync

Application-level sync: update FTS tables whenever entries are created,
modified, or deleted. Wrapped in the same D1 batch/transaction as the entry
mutation.

## 13. Database Schema (D1/SQLite)

Optimized for SQLite, not mirroring Wallabag's MySQL schema. All tables include
`user_id` for multi-user support.

### 13.1 Core Tables

```sql
-- Users
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,        -- bcrypt
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User config
CREATE TABLE user_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'baggy',
  items_per_page INTEGER DEFAULT 30,
  reading_speed INTEGER DEFAULT 200,  -- words per minute
  language TEXT DEFAULT 'en',
  action_mark_as_read INTEGER DEFAULT 0,
  list_mode INTEGER DEFAULT 0,
  display_thumbnails INTEGER DEFAULT 1,
  UNIQUE(user_id)
);

-- OAuth2 clients
CREATE TABLE oauth_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  random_id TEXT NOT NULL,
  secret TEXT NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT DEFAULT '[]',     -- JSON array
  allowed_grant_types TEXT DEFAULT '[]', -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_clients_user ON oauth_clients(user_id);
CREATE INDEX idx_oauth_clients_lookup ON oauth_clients(id, random_id);

-- OAuth2 access tokens
CREATE TABLE oauth_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_access_token ON oauth_access_tokens(token);
CREATE INDEX idx_oauth_access_token_expiry ON oauth_access_tokens(expires_at);

-- OAuth2 refresh tokens
CREATE TABLE oauth_refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_refresh_token ON oauth_refresh_tokens(token);

-- OAuth2 auth codes
CREATE TABLE oauth_auth_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  redirect_uri TEXT,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_auth_code ON oauth_auth_codes(token);

-- Entries
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,               -- SHA1 of url, for duplicate checking
  origin_url TEXT,
  title TEXT NOT NULL,
  content TEXT,                          -- Full article HTML
  content_raw TEXT,                      -- Original fetched HTML (before parsing)
  domain_name TEXT,
  preview_picture TEXT,
  language TEXT,
  mimetype TEXT DEFAULT 'text/html',
  authors TEXT,                          -- Comma-separated
  reading_time INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  is_not_parsed INTEGER DEFAULT 0,       -- 1 if parsing failed
  is_public INTEGER DEFAULT 0,
  public_uuid TEXT,                      -- For /share/{uuid} route
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entries_user ON entries(user_id);
CREATE INDEX idx_entries_user_archived ON entries(user_id, is_archived);
CREATE INDEX idx_entries_user_starred ON entries(user_id, is_starred);
CREATE INDEX idx_entries_user_created ON entries(user_id, created_at DESC);
CREATE INDEX idx_entries_user_updated ON entries(user_id, updated_at DESC);
CREATE INDEX idx_entries_url_hash ON entries(user_id, url_hash);
CREATE INDEX idx_entries_domain ON entries(user_id, domain_name);
CREATE INDEX idx_entries_public ON entries(public_uuid) WHERE is_public = 1;

-- Tags
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);
CREATE INDEX idx_tags_user ON tags(user_id);

-- Entry-Tags junction
CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);

-- Annotations
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,                   -- UUID
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  quote TEXT,
  ranges TEXT NOT NULL,                  -- JSON array of range objects
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_annotations_entry ON annotations(entry_id);

-- Tagging rules
CREATE TABLE tagging_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,                    -- RulerZ-compatible expression
  tags TEXT NOT NULL,                    -- Comma-separated tag labels
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tagging_rules_user ON tagging_rules(user_id);
```

### 13.2 FTS5 Virtual Tables

```sql
-- Trigram index for substring matching
CREATE VIRTUAL TABLE entries_fts_trigram USING fts5(
  title, content, url,
  tokenize='trigram',
  content='entries',
  content_rowid='id'
);

-- Word-level index for prefix matching
CREATE VIRTUAL TABLE entries_fts_words USING fts5(
  title, content, url,
  tokenize='unicode61',
  content='entries',
  content_rowid='id'
);
```

### 13.3 Timestamp Format

All timestamps stored as ISO 8601 strings: `YYYY-MM-DDTHH:MM:SS+0000` (matching
Wallabag's format).

## 14. Environments

| Environment | D1 Database | Domain | Purpose |
|---|---|---|---|
| `dev` | `openbag-db-dev` | `*.workers.dev` subdomain | Staging/testing |
| `production` | `openbag-db-prod` | Custom domain | Live service |

Secrets managed via `wrangler secret put`: `ADMIN_USERNAME`,
`ADMIN_PASSWORD_HASH`.

## 15. Testing Strategy

### 15.1 Unit Tests (Vitest)

- Run against local D1 via `@cloudflare/vitest-pool-workers`
- Test individual functions: parsing, tag rule evaluation, HTMLRewriter
  handlers, response shaping
- Typia validators tested with edge-case inputs

### 15.2 Integration Tests (Vitest)

- Full API request/response cycle against local D1
- Test every endpoint with various parameter combinations
- Verify HATEOAS pagination links, filter preservation, error responses
- Test OAuth2 grant flows end-to-end

### 15.3 E2E Tests (Playwright)

- Run against deployed dev environment
- Simulate real client behavior: authenticate → save URL → list entries → read →
  archive → tag → search
- Test web UI flows: login, OAuth client creation, settings

### 15.4 Compatibility Test Suite

- Dedicated `tests/compat/` directory
- Each test captures the exact JSON response shape Wallabag returns for every
  endpoint
- Validates field names, types, nullability, and nesting structure
- Catches regressions like missing fields, wrong types, or changed response
  shapes
- Reference responses captured from `app.wallabag.it/api` and Wallabag test
  fixtures

## 16. Error Handling

All API errors return JSON matching Wallabag's format:

```json
{
  "error": {
    "code": 404,
    "message": "Entry not found"
  }
}
```

HTTP status codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404
(not found), 405 (method not allowed), 500 (internal error).

## 17. Response Headers

All API responses include:

- `Content-Type: application/json`
- `Cache-Control: no-store, private`
- `Pragma: no-cache`

This matches Wallabag's behavior.

## 18. API Version

`GET /api/version` returns `2.x` (matching Wallabag's major API version).

## 19. Content-Type Negotiation

Wallabag supports `.{_format}` suffix on API URLs (e.g., `/api/entries.json`,
`/api/entries.xml`). All endpoints must handle both `Accept` header negotiation
and URL suffix format hints, defaulting to JSON.

## 20. Rate Limiting & Abuse Prevention

For personal use, explicit rate limiting is not critical. However:

- Cloudflare Workers platform limits provide inherent protection (10K
  subrequests/day free tier)
- OAuth token expiration (1 hour) limits stolen token impact
- D1 query limits prevent runaway queries
- Optional: Cloudflare WAF rules for brute-force protection on `/oauth/v2/token`
