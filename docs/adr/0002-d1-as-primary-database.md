---
# MADR 4.0.0 entry. See docs/adr/template.md.
id: "ADR-0002"
title: "ADR-0002: Cloudflare D1 as the primary database"
status: "accepted"
date: "2026-06-10"
deciders: ["oleg"]
---

# ADR-0002: Cloudflare D1 as the primary database

## Context and Problem Statement

OpenBag needs persistent, relational storage for: users, entries (article
metadata + content), tags, annotations, OAuth2 clients/tokens/grants, sessions,
tagging rules, and user config. Wallabag's data model is inherently relational
(entries ↔ tags is many-to-many; entries belong to users; sessions reference
users). Full-text search on article content is required for the
`GET /api/entries.json?q=…` search endpoint (Wallabag client feature).

The deployment target is Cloudflare Workers. Worker-level storage options are:
D1 (SQLite), KV (eventually-consistent key-value), R2 (object storage),
Durable Objects (per-key strongly consistent state), and Vectorize (vectors).

## Decision Drivers

- **Relational joins** — required by the data model.
- **Full-text search** — required by `/api/entries?q=…` and the future
  in-app search.
- **Single-region latency** — Workers run anywhere; storage should be queryable
  from any Worker invocation without fan-out coordination.
- **Single authoritative source of truth** — entries and metadata are the
  canonical data of the system; eventually-consistent stores (KV) are a poor
  fit.

## Considered Options

### Option A — Cloudflare D1 (single SQLite database) (chosen)

One D1 database binding (`DB`) per Worker deployment. Schema lives in
`worker/schema.sql` as a single authoritative file (no migrations directory —
the schema is reset-able, not incrementally evolved in this repo today).
Search uses SQLite FTS5 with `trigram` + `unicode61` tokenizers.

### Option B — KV with denormalised indices

Store entries by id; maintain denormalised tag indices; client-side joins.

### Option C — D1 plus R2 for entry HTML

D1 for metadata, R2 blobs for the article body (sometimes 100+ KB).

### Option D — Turso / libSQL outside Cloudflare

Hosted SQLite with replica reads.

## Decision Outcome

**Option A.** Single D1 database, FTS5 (`trigram` + `unicode61`) for search.
No R2 blob split — article content lives in the D1 row. No external DB.

## Pros and Cons of the Options

### Option A

- **Good**, because D1 is Workers-native: zero external hops, no extra billing
  surface, runs alongside the Worker.
- **Good**, because FTS5 trigram handles Unicode and substring queries; no
  separate search infra.
- **Good**, because SQL ACID semantics match the relational data model.
- **Bad**, because SQLite has a single writer at a time — large bulk imports
  can contend. Mitigated by queue-consumer batching
  (`wrangler.jsonc` queues).
- **Bad**, because there is no migrations framework today; schema evolution
  requires care. See `worker/schema.sql` for the single authoritative file.

### Option B (KV)

- **Good**, because reads are cheap and globally distributed.
- **Bad**, because joins must be denormalised manually; tag filtering becomes
  expensive as entry counts grow.
- **Bad**, because eventual consistency makes session/create flows racy.
- **Bad**, because no FTS — search would need a separate service.

### Option C (D1 + R2)

- **Good**, because moving large entry bodies out of D1 keeps query rows small.
- **Bad**, because every entry read becomes two I/O calls; complicates
  pagination query costs.
- **Bad**, because body content is needed at list time for snippets. Not worth
  the indirection at the current scale.

### Option D (Turso)

- **Good**, because replicas give read-locality across regions.
- **Bad**, because it is external to Cloudflare; adds latency, billing, and
  operational surface.
- **Bad**, because Cloudflare-native is a project value.

## Consequences

- **Positive:** schema is centrally readable in `worker/schema.sql`; any
  contributor can reconstruct the data model in one file.
- **Positive:** search is co-located with content; no syncing.
- **Negative:** schema evolution is manual. If migrations become a pain, an
  ADR should adopt `wrangler d1 migrations` with a directory.
- **Negative:** single-writer constraint forces queue batching for bulk
  imports (already implemented in the import-queue consumer).
- **Risk:** if a single-DB-per-deployment becomes a multi-tenant concern,
  revisit sharding strategy.
