// Shared data helpers for entries (ADR-0014). The API routes and the UI SSR
// pages both call these so both share one query path — same SQL, same
// enrichment, same Wallabag-compatible field shape.

import { D1Client } from "../db";
import { toHex } from "../crypto";
import { sanitizeEntryHtml, computeReadingTime } from "../sanitize";
import { fetchAndParse } from "../parser/fetcher";

export interface User {
  id: number;
  username: string;
}

export interface Entry {
  id: number;
  user_id: number;
  url: string;
  url_hash: string;
  origin_url: string | null;
  title: string;
  content: string | null;
  content_raw: string | null;
  domain_name: string | null;
  preview_picture: string | null;
  language: string | null;
  mimetype: string;
  authors: string | null;
  reading_time: number;
  is_archived: number;
  is_starred: number;
  is_not_parsed: number;
  is_public: number;
  public_uuid: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Attached by `enrichEntry`. */
  tags?: Tag[];
  user_name?: null;
  user_email?: null;
}

export interface Tag {
  id: number;
  label: string;
  slug: string;
}

export interface ListFilters {
  page?: number;
  perPage?: number;
  archive?: 0 | 1;
  starred?: 0 | 1;
  public?: 0 | 1;
  notParsed?: 0 | 1;
  domain?: string;
  tags?: string[];
  since?: number; // Unix seconds
  annotations?: boolean;
  sort?: "created" | "updated" | "archived";
  order?: "asc" | "desc";
  detail?: "full" | "metadata";
}

export interface EntryList {
  items: Entry[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

/** Hex of the URL bytes — stable dedup key. */
export function hashUrl(url: string): string {
  return toHex(new TextEncoder().encode(url));
}

export function parseTags(tags: unknown): string[] {
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (Array.isArray(tags)) return (tags as string[]).map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Find-or-create a tag — no error on collision. */
export async function upsertTag(
  dbc: D1Client,
  userId: number,
  label: string,
): Promise<Tag> {
  const slug = label.toLowerCase().replace(/\s+/g, "-");
  let tag = await dbc
    .one<Tag>("SELECT id, label, slug FROM tags WHERE user_id = ? AND slug = ?", [userId, slug])
    .catch(() => null);
  if (!tag) {
    await dbc.run("INSERT INTO tags (user_id, label, slug) VALUES (?, ?, ?)", [userId, label, slug]);
    const inserted = await dbc.one<{ id: number }>("SELECT last_insert_rowid() as id", []);
    tag = { id: inserted?.id ?? 0, label, slug };
  }
  return tag;
}

export async function attachTags(
  dbc: D1Client,
  userId: number,
  entryId: number,
  labels: string[],
): Promise<Tag[]> {
  const out: Tag[] = [];
  for (const label of labels) {
    const tag = await upsertTag(dbc, userId, label);
    await dbc.run("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)", [entryId, tag.id]);
    out.push(tag);
  }
  return out;
}

export async function getEntryTags(dbc: D1Client, entryId: number, userId: number): Promise<Tag[]> {
  return dbc.all<Tag>(
    "SELECT t.id, t.label, t.slug FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? AND t.user_id = ?",
    [entryId, userId],
  );
}

/** Wallabag contract: flags as 0/1 integers, not booleans. */
export async function enrichEntry(dbc: D1Client, entry: any, userId: number): Promise<Entry> {
  if (!entry) return entry;
  entry.tags = await getEntryTags(dbc, entry.id, userId);
  entry.is_archived = entry.is_archived ? 1 : 0;
  entry.is_starred = entry.is_starred ? 1 : 0;
  entry.is_public = entry.is_public ? 1 : 0;
  entry.is_not_parsed = entry.is_not_parsed ? 1 : 0;
  entry.user_name = null;
  entry.user_email = null;
  for (const key of ["created_at", "updated_at", "published_at"]) {
    if (entry[key] && typeof entry[key] === "string") {
      entry[key] = entry[key].replace(" ", "T") + "+00:00";
    }
  }
  return entry as Entry;
}

/** Lifted verbatim from the original `buildQuery` so list semantics stay identical. */
function buildWhere(userId: number, filters: ListFilters): { where: string; params: any[] } {
  const conditions: string[] = ["e.user_id = ?"];
  const params: any[] = [userId];

  if (filters.archive != null) {
    conditions.push("e.is_archived = ?");
    params.push(filters.archive);
  }
  if (filters.starred != null) {
    conditions.push("e.is_starred = ?");
    params.push(filters.starred);
  }
  if (filters.public != null) {
    conditions.push("e.is_public = ?");
    params.push(filters.public);
  }
  if (filters.notParsed != null) {
    conditions.push("e.is_not_parsed = ?");
    params.push(filters.notParsed);
  }
  if (filters.domain) {
    conditions.push("e.domain_name = ?");
    params.push(filters.domain);
  }
  if (filters.since && !isNaN(filters.since)) {
    const d = new Date(filters.since * 1000);
    if (!isNaN(d.getTime())) {
      conditions.push("e.updated_at > datetime(?)");
      params.push(d.toISOString().replace("T", " ").slice(0, 19));
    }
  }
  if (filters.annotations) {
    conditions.push("EXISTS (SELECT 1 FROM annotations a WHERE a.entry_id = e.id AND a.user_id = ?)");
    params.push(userId);
  }

  let where = " WHERE " + conditions.join(" AND ");

  if (filters.tags && filters.tags.length) {
    const tagSub = "SELECT entry_id FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE t.user_id = ? AND t.slug = ?";
    const tagClause = filters.tags.map(() => `e.id IN (${tagSub})`).join(" AND ");
    where += " AND " + tagClause;
    params.push(...filters.tags.map(() => userId));
  }

  return { where, params };
}

const SORT_MAP: Record<string, string> = {
  created: "e.created_at",
  updated: "e.updated_at",
  archived: "e.is_archived",
};

/** Same shape as the API `_embedded.items` (minus HAL links — API handler re-wraps them). */
export async function getEntries(env: any, userId: number, filters: ListFilters = {}): Promise<EntryList> {
  const dbc = new D1Client(env.DB);
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.max(1, filters.perPage ?? 30);
  const offset = (page - 1) * perPage;
  const detail = filters.detail ?? "full";
  const sortCol = SORT_MAP[filters.sort ?? "created"] ?? "e.created_at";
  const orderDir = (filters.order ?? "desc") === "asc" ? "ASC" : "DESC";

  const { where, params } = buildWhere(userId, filters);

  const totalRow = await dbc.one<{ total: number }>(`SELECT COUNT(*) as total FROM entries e${where}`, params);
  const items = await dbc.all<Entry>(
    `SELECT e.* FROM entries e${where} ORDER BY ${sortCol} ${orderDir} LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  const enriched: Entry[] = [];
  for (const e of items) {
    if (detail === "metadata") {
      const { content, content_raw, ...rest } = e as any;
      enriched.push({ ...rest, tags: [] });
    } else {
      enriched.push(await enrichEntry(dbc, e, userId));
    }
  }

  const total = totalRow?.total ?? 0;
  return {
    items: enriched,
    total,
    page,
    pages: Math.ceil(total / perPage) || 1,
    perPage,
  };
}

export async function getEntry(env: any, userId: number, id: number): Promise<Entry | null> {
  const dbc = new D1Client(env.DB);
  const row = await dbc.one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, userId]);
  return row ? enrichEntry(dbc, row, userId) : null;
}

export interface UpdateEntryPatch {
  title?: string;
  content?: string;
  archive?: boolean;
  starred?: boolean;
  is_archived?: boolean;
  is_starred?: boolean;
  public?: boolean;
  language?: string;
  authors?: string | string[];
  preview_picture?: string;
  published_at?: string;
  origin_url?: string;
  tags?: string[];
}

export async function updateEntry(
  env: any,
  userId: number,
  id: number,
  patch: UpdateEntryPatch,
): Promise<Entry | null> {
  const dbc = new D1Client(env.DB);
  const sets: string[] = [];
  const params: any[] = [];

  if (patch.title) { sets.push("title = ?"); params.push(patch.title); }
  if (patch.content != null) {
    const sanitized = sanitizeEntryHtml(String(patch.content));
    const raw = await dbc.one<{ content_raw: string | null }>("SELECT content_raw FROM entries WHERE id = ?", [id]);
    if (raw && raw.content_raw == null) {
      const current = await dbc.one<{ content: string | null }>("SELECT content FROM entries WHERE id = ?", [id]);
      sets.push("content_raw = ?");
      params.push(current?.content ?? "");
    }
    sets.push("content = ?"); params.push(sanitized);
    sets.push("is_not_parsed = 0");
    sets.push("reading_time = ?"); params.push(computeReadingTime(sanitized));
  }
  if (patch.language) { sets.push("language = ?"); params.push(patch.language); }
  if (patch.authors) {
    const a = Array.isArray(patch.authors) ? patch.authors.join(",") : patch.authors;
    sets.push("authors = ?"); params.push(a);
  }
  if (patch.preview_picture) { sets.push("preview_picture = ?"); params.push(patch.preview_picture); }
  if (patch.published_at) { sets.push("published_at = ?"); params.push(patch.published_at); }
  if (patch.origin_url) { sets.push("origin_url = ?"); params.push(patch.origin_url); }

  // `archive`/`starred` aliases from the Wallabag client vocabulary.
  if (patch.archive !== undefined) { sets.push("is_archived = ?"); params.push(patch.archive ? 1 : 0); }
  if (patch.starred !== undefined) { sets.push("is_starred = ?"); params.push(patch.starred ? 1 : 0); }
  if (patch.is_archived !== undefined) { sets.push("is_archived = ?"); params.push(patch.is_archived ? 1 : 0); }
  if (patch.is_starred !== undefined) { sets.push("is_starred = ?"); params.push(patch.is_starred ? 1 : 0); }
  if (patch.public !== undefined) {
    sets.push("is_public = ?"); params.push(patch.public ? 1 : 0);
    if (patch.public) {
      const existing = await dbc.one<{ public_uuid: string | null }>("SELECT public_uuid FROM entries WHERE id = ?", [id]);
      if (!existing?.public_uuid) { sets.push("public_uuid = ?"); params.push(crypto.randomUUID()); }
    } else {
      sets.push("public_uuid = NULL");
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    params.push(id, userId);
    await dbc.run(`UPDATE entries SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, params);
  }

  if (patch.tags) {
    await dbc.run("DELETE FROM entry_tags WHERE entry_id = ?", [id]);
    await attachTags(dbc, userId, id, patch.tags);
  }

  return getEntry(env, userId, id);
}

/** No-op (not an error) when the entry doesn't exist. */
export async function deleteEntry(env: any, userId: number, id: number): Promise<void> {
  const dbc = new D1Client(env.DB);
  await dbc.run("DELETE FROM entries WHERE id = ? AND user_id = ?", [id, userId]);
}

export interface CreateEntryInput {
  url: string;
  title?: string;
  content?: string;
  archive?: boolean;
  starred?: boolean;
  public?: boolean;
  language?: string;
  authors?: string | string[];
  preview_picture?: string;
  published_at?: string;
  origin_url?: string;
  tags?: string[];
}

/**
 * Sets `is_not_parsed = 1` when no content; caller owns the `waitUntil`
 * background re-parse. De-dupes by `url_hash` (returns the existing row).
 */
export async function createEntry(env: any, userId: number, input: CreateEntryInput): Promise<Entry> {
  const dbc = new D1Client(env.DB);
  const urlHash = hashUrl(input.url);

  const existing = await dbc.one<Entry>("SELECT * FROM entries WHERE user_id = ? AND url_hash = ?", [userId, urlHash]).catch(() => null);
  if (existing) {
    return updateEntry(env, userId, existing.id, input) as Promise<Entry>;
  }

  const isArchived = input.archive ? 1 : 0;
  const isStarred = input.starred ? 1 : 0;
  const authors = input.authors
    ? Array.isArray(input.authors) ? input.authors.join(",") : input.authors
    : null;
  let domainName: string | null = null;
  try { domainName = new URL(input.url).hostname; } catch { /* leave null */ }
  const sanitizedContent = input.content ? sanitizeEntryHtml(String(input.content)) : "";
  const readingTime = input.content ? computeReadingTime(sanitizedContent) : 0;

  await dbc.run(
    "INSERT INTO entries (user_id, url, url_hash, title, content, origin_url, domain_name, language, authors, preview_picture, published_at, mimetype, is_archived, is_starred, is_not_parsed, is_public, public_uuid, reading_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      userId, input.url, urlHash, input.title || input.url, sanitizedContent,
      input.origin_url || null, domainName,
      input.language || null, authors,
      input.preview_picture || null, input.published_at || null,
      "text/html", isArchived, isStarred,
      input.content ? 0 : 1,
      input.public ? 1 : 0,
      input.public ? crypto.randomUUID() : null,
      readingTime,
    ],
  );
  const idRow = await dbc.one<{ id: number }>("SELECT last_insert_rowid() as id", []);
  const id = idRow?.id ?? 0;

  if (input.tags) await attachTags(dbc, userId, id, input.tags);

  return (await getEntry(env, userId, id))!;
}

/**
 * Reset an entry's content to its original `content_raw` snapshot (taken on
 * first edit) and return the refreshed entry. Clears the snapshot afterwards.
 * Returns `{ code: 404 }` / `{ code: 409 }` when no row / no snapshot exists.
 */
export async function resetEntryContent(
  env: any,
  userId: number,
  id: number,
): Promise<Entry | { code: 404 | 409 }> {
  const dbc = new D1Client(env.DB);
  const current = await dbc.one<{ content_raw: string | null }>(
    "SELECT content_raw FROM entries WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!current) return { code: 404 };
  if (current.content_raw == null) return { code: 409 };
  const restored = sanitizeEntryHtml(current.content_raw);
  await dbc.run(
    `UPDATE entries
       SET content = ?, content_raw = NULL, reading_time = ?, is_not_parsed = 0, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [restored, computeReadingTime(restored), id, userId],
  );
  return (await getEntry(env, userId, id))!;
}

/**
 * Fetch content for an entry if it hasn't been parsed yet. Safe to call from
 * either an API route handler or a UI form-POST handler — both run on Workers
 * and use `c.executionCtx.waitUntil` to send this work to the background.
 *
 * Lifted verbatim from the original `entries/index.ts` so behavior is
 * identical. Marked `is_not_parsed = 0` to short-circuit retries on failure.
 */
export async function fetchContentIfNeeded(env: any, entryId: number): Promise<void> {
  const dbc = new D1Client(env.DB);
  try {
    const entry = await dbc.one<{ url: string; is_not_parsed: number }>(
      "SELECT url, is_not_parsed FROM entries WHERE id = ?",
      [entryId],
    );
    if (!entry || !entry.is_not_parsed) return;

    const parsed = await fetchAndParse(entry.url);
    // Prefer the parsed page title; if the fetcher couldn't find one, keep any
    // existing non-URL title. A title that just echoes the entry URL means no
    // human-readable title was supplied yet, so it's safe to overwrite.
    await dbc.run(
      `UPDATE entries SET
        title = COALESCE(NULLIF(?, ''), CASE WHEN title = url THEN '' ELSE title END, url),
        content = ?,
        domain_name = COALESCE(NULLIF(domain_name, ''), ?, domain_name),
        preview_picture = COALESCE(NULLIF(preview_picture, ''), ?, preview_picture),
        language = COALESCE(NULLIF(language, ''), ?, language),
        authors = COALESCE(NULLIF(authors, ''), ?, authors),
        reading_time = CASE WHEN reading_time = 0 THEN ? ELSE reading_time END,
        is_not_parsed = 0,
        updated_at = datetime('now')
      WHERE id = ?`,
      [parsed.title, parsed.content, parsed.domainName, parsed.previewPicture, parsed.language, parsed.authors, parsed.readingTime, entryId],
    );
    console.log(`Fetched content for entry ${entryId}: ${parsed.title || entry.url}`);
  } catch (err) {
    console.error(`Failed to fetch content for entry ${entryId}: ${(err as Error).message}`);
    // Mark as parsed to avoid infinite retries.
    await dbc.run("UPDATE entries SET is_not_parsed = 0 WHERE id = ?", [entryId]).catch(() => { });
  }
}
