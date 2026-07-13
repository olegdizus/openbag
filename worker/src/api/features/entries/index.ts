import { Hono } from "hono";
import { D1Client, toHex } from "../../../index";
import { fetchAndParse, generateEpub } from "../../../parser";
import { sanitizeEntryHtml, computeReadingTime } from "../../../sanitize";

const db = (env: any) => new D1Client(env.DB);

function buildQuery(c: any, baseSql: string, baseParams: any[]): { sql: string; params: any[] } {
  const conditions: string[] = ["e.user_id = ?"];
  const params = [...baseParams];
  const user = c.get("user") || { id: 1 };
  params.push(user.id);

  const archive = c.req.query("archive");
  const starred = c.req.query("starred");
  const since = c.req.query("since");
  const publicOnly = c.req.query("public");
  const notParsed = c.req.query("notParsed");
  const domain = c.req.query("domain_name");
  const tags = c.req.query("tags");
  const annotations = c.req.query("annotations");

  if (archive != null && archive !== "") {
    conditions.push("e.is_archived = ?");
    params.push(archive === "1" ? 1 : 0);
  }
  if (starred != null && starred !== "") {
    conditions.push("e.is_starred = ?");
    params.push(starred === "1" ? 1 : 0);
  }
  if (since && since !== "" && !isNaN(parseInt(since))) {
    conditions.push("e.updated_at > datetime(?)");
    const d = new Date(parseInt(since) * 1000);
    if (!isNaN(d.getTime())) {
      params.push(d.toISOString().replace("T", " ").slice(0, 19));
    } else {
      conditions.pop();
    }
  }
  if (publicOnly != null && publicOnly !== "") {
    conditions.push("e.is_public = ?");
    params.push(publicOnly === "1" ? 1 : 0);
  }
  if (notParsed != null && notParsed !== "") {
    conditions.push("e.is_not_parsed = ?");
    params.push(notParsed === "1" ? 1 : 0);
  }
  if (domain) {
    conditions.push("e.domain_name = ?");
    params.push(domain);
  }
  if (annotations != null && annotations !== "") {
    conditions.push("EXISTS (SELECT 1 FROM annotations a WHERE a.entry_id = e.id AND a.user_id = ?)");
    params.push(user.id);
  }

  let sql = baseSql;
  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  if (tags) {
    const tagLabels = tags.split(",").map((t: string) => t.trim()).filter(Boolean);
    if (tagLabels.length) {
      const tagSub = "SELECT entry_id FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE t.user_id = ? AND t.slug = ?";
      const tagConditions = tagLabels.map(() => `e.id IN (${tagSub})`).join(" AND ");
      sql += " AND " + tagConditions;
      params.push(...tagLabels.map(() => user.id));
    }
  }

  return { sql, params };
}

function collectionResponse(c: any, items: any[], total: number, page: number, perPage: number) {
  const pages = Math.ceil(total / perPage) || 1;
  const q = new URL(c.req.url);
  const baseParams = new URLSearchParams(q.search);
  baseParams.set("page", page.toString());
  baseParams.set("perPage", perPage.toString());

  const makeHref = (p: number) => `/api/entries?${baseParams.toString().replace(/page=\d+/, `page=${p}`)}`;
  const links: Record<string, { href: string }> = { self: { href: makeHref(page) } };
  if (page > 1) links.first = { href: makeHref(1) };
  if (page < pages) links.last = { href: makeHref(pages) };
  if (page < pages) links.next = { href: makeHref(page + 1) };

  return {
    _embedded: { items },
    _links: links,
    limit: perPage,
    page,
    pages,
    total,
  };
}

/** Deterministic URL dedup key (hex of the URL bytes). */
function hashUrl(url: string): string {
  return toHex(new TextEncoder().encode(url));
}

/** Split a tags value (comma-string or array) into trimmed labels. */
function parseTags(tags: unknown): string[] {
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (Array.isArray(tags)) return (tags as string[]).map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Find or create a tag for a user; returns the tag row. */
async function upsertTag(dbc: any, userId: number, label: string): Promise<{ id: number; label: string; slug: string }> {
  const slug = label.toLowerCase().replace(/\s+/g, "-");
  let tag = await dbc.one("SELECT id, label, slug FROM tags WHERE user_id = ? AND slug = ?", [userId, slug]).catch(() => null);
  if (!tag) {
    await dbc.run("INSERT INTO tags (user_id, label, slug) VALUES (?, ?, ?)", [userId, label, slug]);
    tag = { id: (await dbc.one("SELECT last_insert_rowid() as id", [])).id, label, slug };
  }
  return tag;
}

/** Upsert each label and link it to the entry; returns the upserted tags. */
async function attachTags(dbc: any, userId: number, entryId: number, labels: string[]): Promise<{ id: number; label: string; slug: string }[]> {
  const out: { id: number; label: string; slug: string }[] = [];
  for (const label of labels) {
    const tag = await upsertTag(dbc, userId, label);
    await dbc.run("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)", [entryId, tag.id]);
    out.push(tag);
  }
  return out;
}

function epubResponse(epub: ArrayBuffer, id: number) {
  return new Response(epub, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="entry-${id}.epub"`,
    },
  });
}

async function getEntryTags(dbc: any, entryId: number, userId: number) {
  return dbc.all(
    "SELECT t.id, t.label, t.slug FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? AND t.user_id = ?",
    [entryId, userId]
  );
}

async function enrichEntry(dbc: any, entry: any, userId: number) {
  if (!entry) return entry;
  entry.tags = await getEntryTags(dbc, entry.id, userId);
  // Wallabag serializes these as booleans
  // Wallabag API returns integers (0/1), not booleans
  entry.is_archived = entry.is_archived ? 1 : 0;
  entry.is_starred = entry.is_starred ? 1 : 0;
  entry.is_public = entry.is_public ? 1 : 0;
  entry.is_not_parsed = entry.is_not_parsed ? 1 : 0;
  // Rename fields for Wallabag compat
  entry.user_name = null;
  entry.user_email = null;

  // Format datetimes as ISO 8601 (Wallabag clients expect this format)
  // D1 stores as "2026-06-10 15:10:58" → convert to "2026-06-10T15:10:58+00:00"
  for (const key of ["created_at", "updated_at", "published_at"]) {
    if (entry[key] && typeof entry[key] === "string") {
      entry[key] = entry[key].replace(" ", "T") + "+00:00";
    }
  }
  return entry;
}

/**
 * Fetch content for an entry if it hasn't been parsed yet.
 * Called inline after entry creation — returns quickly on failure.
 */
async function fetchContentIfNeeded(env: any, entryId: number): Promise<void> {
  try {
    const entry = await db(env).one<{ url: string; is_not_parsed: number }>(
      "SELECT url, is_not_parsed FROM entries WHERE id = ?", [entryId]
    );
    if (!entry || !entry.is_not_parsed) return;

    const parsed = await fetchAndParse(entry.url);
    // Prefer the parsed page title; if the fetcher couldn't find one, keep any
    // existing non-URL title. A title that just echoes the entry URL means no
    // human-readable title was supplied yet, so it's safe to overwrite.
    await db(env).run(
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
      [parsed.title, parsed.content, parsed.domainName, parsed.previewPicture, parsed.language, parsed.authors, parsed.readingTime, entryId]
    );
    console.log(`Fetched content for entry ${entryId}: ${parsed.title || entry.url}`);
  } catch (err) {
    console.error(`Failed to fetch content for entry ${entryId}: ${(err as Error).message}`);
    // Mark as parsed to avoid infinite retries
    await db(env).run("UPDATE entries SET is_not_parsed = 0 WHERE id = ?", [entryId]).catch(() => { });
  }
}

export function entryRoutes() {
  const app = new Hono();

  // GET /api/entries — list entries with sorting, filtering, pagination
  app.get("/", async (c) => {
    const user = c.get("user") || { id: 1 };
    const page = parseInt(c.req.query("page") || "1");
    const perPage = parseInt(c.req.query("perPage") || "30");
    const offset = (page - 1) * perPage;
    const detail = c.req.query("detail") || "full";
    const sort = c.req.query("sort") || "created";
    const order = c.req.query("order") || "desc";

    const sortMap: Record<string, string> = {
      created: "e.created_at",
      updated: "e.updated_at",
      archived: "e.is_archived",
    };
    const sortCol = sortMap[sort] || "e.created_at";
    const orderDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    const { sql, params } = buildQuery(c, "SELECT e.* FROM entries e", []);
    const countSql = sql.replace("SELECT e.*", "SELECT COUNT(*) as total");

    const totalRow = await db(c.env).one<{ total: number }>(countSql, params);
    const items = await db(c.env).all(sql + ` ORDER BY ${sortCol} ${orderDir} LIMIT ? OFFSET ?`, [...params, perPage, offset]);

    const enriched = [];
    for (const e of items) {
      if (detail === "metadata") {
        const { content, content_raw, ...rest } = e;
        enriched.push({ ...rest, tags: [] });
      } else {
        enriched.push(await enrichEntry(db(c.env), e, user.id));
      }
    }

    return c.json(collectionResponse(c, enriched, totalRow?.total ?? 0, page, perPage));
  });

  // GET /api/entries/exists — check if entries exist by URL
  app.get("/exists", async (c) => {
    const user = c.get("user") || { id: 1 };
    const urls = c.req.query("urls");
    const url = c.req.query("url");
    const hashedUrl = c.req.query("hashed_url");
    const hashedUrls = c.req.query("hashed_urls");
    const returnId = c.req.query("return_id");

    const allUrls: string[] = [];
    if (url) allUrls.push(url);
    if (urls) allUrls.push(...urls.split(","));

    if (allUrls.length === 0 && !hashedUrl && !hashedUrls) {
      return c.json({ error: "URL is empty" }, 400);
    }

    // Single URL — simple response
    if (allUrls.length === 1 && !hashedUrls) {
      const singleUrl = allUrls[0];
      const urlHash = hashUrl(singleUrl);
      const row = await db(c.env).one("SELECT id FROM entries WHERE user_id = ? AND url_hash = ?", [user.id, urlHash]).catch(() => null);
      if (returnId === "1" || returnId === "true") {
        return c.json(row ? { exists: true, id: row.id } : { exists: false });
      }
      return c.json({ exists: !!row });
    }

    // Multiple URLs — batch response
    const results: Record<string, any> = {};
    for (const u of allUrls) {
      const h = hashUrl(u);
      const row = await db(c.env).one("SELECT id FROM entries WHERE user_id = ? AND url_hash = ?", [user.id, h]).catch(() => null);
      if (returnId === "1" || returnId === "true") {
        results[u] = row ? row.id : null;
      } else {
        results[u] = !!row;
      }
    }
    return c.json(results);
  });

  // GET /api/entries/{id} — get single entry with tags
  app.get("/:id", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json(await enrichEntry(db(c.env), entry, user.id));
  });

  // POST /api/entries — create or update entry
  // Supports: url, title, content, tags, archive/starred, origin_url, language, authors, preview_picture, published_at, public
  app.post("/", async (c) => {
    const user = c.get("user") || { id: 1 };
    const body = await c.req.json().catch(() => ({}));
    const url = body.url as string;
    if (!url) return c.json({ error: "URL is required" }, 400);

    const urlHash = hashUrl(url);
    const title = body.title || url;

    // Check if entry already exists — return it if so
    const existing = await db(c.env).one("SELECT * FROM entries WHERE user_id = ? AND url_hash = ?", [user.id, urlHash]).catch(() => null);
    if (existing) {
      // Update existing entry with provided fields
      const sets: string[] = [];
      const params: any[] = [];
      if (body.title) { sets.push("title = ?"); params.push(body.title); }
      if (body.content) {
        // Sanitize + recompute reading time. Snapshot content_raw on first edit.
        const sanitized = sanitizeEntryHtml(String(body.content));
        const raw = await db(c.env).one("SELECT content_raw FROM entries WHERE id = ?", [existing.id]);
        if (raw && raw.content_raw === null) {
          sets.push("content_raw = ?"); params.push(existing.content ?? "");
        }
        sets.push("content = ?"); params.push(sanitized);
        sets.push("is_not_parsed = 0");
        sets.push("reading_time = ?"); params.push(computeReadingTime(sanitized));
      }
      if (body.language) { sets.push("language = ?"); params.push(body.language); }
      if (body.authors) { sets.push("authors = ?"); params.push(typeof body.authors === "string" ? body.authors : body.authors.join(",")); }
      if (body.preview_picture) { sets.push("preview_picture = ?"); params.push(body.preview_picture); }
      if (body.published_at) { sets.push("published_at = ?"); params.push(body.published_at); }
      if (body.origin_url) { sets.push("origin_url = ?"); params.push(body.origin_url); }
      if (body.archive !== undefined) { sets.push("is_archived = ?"); params.push(body.archive ? 1 : 0); }
      if (body.starred !== undefined) { sets.push("is_starred = ?"); params.push(body.starred ? 1 : 0); }
      if (body.public !== undefined) {
        sets.push("is_public = ?"); params.push(body.public ? 1 : 0);
        if (body.public && !existing.public_uuid) {
          sets.push("public_uuid = ?"); params.push(crypto.randomUUID());
        } else if (!body.public) {
          sets.push("public_uuid = NULL");
        }
      }
      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        params.push(existing.id);
        await db(c.env).run(`UPDATE entries SET ${sets.join(", ")} WHERE id = ?`, params);
      }
      // Handle tags
      if (body.tags) {
        await attachTags(db(c.env), user.id, existing.id, parseTags(body.tags));
      }
      const updated = await db(c.env).one("SELECT * FROM entries WHERE id = ?", [existing.id]);
      return c.json(await enrichEntry(db(c.env), updated, user.id));
    }

    // Create new entry
    const isArchived = body.archive ? 1 : 0;
    const isStarred = body.starred ? 1 : 0;
    const authors = body.authors ? (typeof body.authors === "string" ? body.authors : body.authors.join(",")) : null;
    const domainName = url ? new URL(url).hostname : null;
    const sanitizedContent = body.content ? sanitizeEntryHtml(String(body.content)) : "";
    const readingTime = body.content ? computeReadingTime(sanitizedContent) : 0;

    const result = await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, origin_url, domain_name, language, authors, preview_picture, published_at, mimetype, is_archived, is_starred, is_not_parsed, is_public, public_uuid, reading_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        user.id, url, urlHash, title, sanitizedContent,
        body.origin_url || null, domainName,
        body.language || null, authors,
        body.preview_picture || null, body.published_at || null,
        "text/html", isArchived, isStarred,
        body.content ? 0 : 1, // is_not_parsed
        body.public ? 1 : 0,
        body.public ? crypto.randomUUID() : null,
        readingTime,
      ]
    );
    const id = (await db(c.env).one("SELECT last_insert_rowid() as id", [])).id;

    // Handle tags
    if (body.tags) {
      await attachTags(db(c.env), user.id, id, parseTags(body.tags));
    }

    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ?", [id]);
    // Fetch content from the URL in the background (don't block the response)
    c.executionCtx.waitUntil(fetchContentIfNeeded(c.env, id));
    return c.json(await enrichEntry(db(c.env), entry, user.id), 201);
  });

  // POST /api/entries/lists — bulk create entries
  app.post("/lists", async (c) => {
    const user = c.get("user") || { id: 1 };
    const body = await c.req.json();
    const urls: string[] = body.urls || [];
    const results = [];
    for (const url of urls) {
      const urlHash = hashUrl(url);
      const existing = await db(c.env).one("SELECT id FROM entries WHERE user_id = ? AND url_hash = ?", [user.id, urlHash]).catch(() => null);
      if (existing) { results.push(existing); continue; }
      const domainName = url ? new URL(url).hostname : null;
      const result = await db(c.env).run(
        "INSERT INTO entries (user_id, url, url_hash, title, domain_name, mimetype, is_not_parsed) VALUES (?, ?, ?, ?, ?, 'text/html', 1)",
        [user.id, url, urlHash, url, domainName]
      );
      const id = (await db(c.env).one("SELECT last_insert_rowid() as id", [])).id;
      results.push({ id });
    }
    return c.json(results);
  });

  // DELETE /api/entries/list — bulk delete entries
  app.delete("/list", async (c) => {
    const user = c.get("user") || { id: 1 };
    const body = await c.req.json();
    const ids: number[] = body.ids || [];
    if (ids.length === 0) return c.json({ success: true });
    const placeholders = ids.map(() => "?").join(",");
    await db(c.env).run(`DELETE FROM entries WHERE id IN (${placeholders}) AND user_id = ?`, [...ids, user.id]);
    return c.json({ success: true });
  });

  // DELETE /api/entries/{id} — delete entry
  app.delete("/:id", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    await db(c.env).run("DELETE FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json({ success: true });
  });

  // PATCH /api/entries/{id} — update entry
  // Supports: title, content, tags (replace), archive, starred, origin_url, language, authors, preview_picture, published_at, public
  app.patch("/:id", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));

    const sets: string[] = [];
    const params: any[] = [];

    if (body.title) { sets.push("title = ?"); params.push(body.title); }
    if (body.content) {
      // Sanitize + recompute reading time. Snapshot content_raw on first edit.
      const sanitized = sanitizeEntryHtml(String(body.content));
      const raw = await db(c.env).one("SELECT content_raw FROM entries WHERE id = ?", [id]);
      if (raw && raw.content_raw === null) {
        sets.push("content_raw = ?");
        const current = await db(c.env).one("SELECT content FROM entries WHERE id = ?", [id]);
        params.push(current?.content ?? "");
      }
      sets.push("content = ?"); params.push(sanitized);
      sets.push("is_not_parsed = 0");
      sets.push("reading_time = ?"); params.push(computeReadingTime(sanitized));
    }
    if (body.language) { sets.push("language = ?"); params.push(body.language); }
    if (body.authors) { sets.push("authors = ?"); params.push(typeof body.authors === "string" ? body.authors : body.authors.join(",")); }
    if (body.preview_picture) { sets.push("preview_picture = ?"); params.push(body.preview_picture); }
    if (body.published_at) { sets.push("published_at = ?"); params.push(body.published_at); }
    if (body.origin_url) { sets.push("origin_url = ?"); params.push(body.origin_url); }
    if (body.archive !== undefined) { sets.push("is_archived = ?"); params.push(body.archive ? 1 : 0); }
    if (body.starred !== undefined) { sets.push("is_starred = ?"); params.push(body.starred ? 1 : 0); }
    if (body.is_archived !== undefined) { sets.push("is_archived = ?"); params.push(body.is_archived ? 1 : 0); }
    if (body.is_starred !== undefined) { sets.push("is_starred = ?"); params.push(body.is_starred ? 1 : 0); }
    if (body.public !== undefined) {
      sets.push("is_public = ?"); params.push(body.public ? 1 : 0);
      if (body.public) {
        const existing = await db(c.env).one("SELECT public_uuid FROM entries WHERE id = ?", [id]);
        if (!existing?.public_uuid) { sets.push("public_uuid = ?"); params.push(crypto.randomUUID()); }
      } else {
        sets.push("public_uuid = NULL");
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(id, user.id);
      await db(c.env).run(`UPDATE entries SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, params);
    }

    // Handle tags (PATCH replaces all tags on the entry)
    if (body.tags) {
      await db(c.env).run("DELETE FROM entry_tags WHERE entry_id = ?", [id]);
      await attachTags(db(c.env), user.id, id, parseTags(body.tags));
    }

    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json(await enrichEntry(db(c.env), entry, user.id));
  });

  // PATCH + GET /api/entries/{id}/reload — re-fetch entry (GET kept for client compat)
  const reloadEntry = async (c: any) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    await db(c.env).run("UPDATE entries SET is_not_parsed = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?", [id, user.id]);
    c.executionCtx.waitUntil(fetchContentIfNeeded(c.env, id));
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json(await enrichEntry(db(c.env), entry, user.id));
  };
  app.patch("/:id/reload", reloadEntry);
  app.get("/:id/reload", reloadEntry);

  // GET /api/entries/{id}/export — export entry in various formats
  app.get("/:id/export", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const format = c.req.query("format") || "json";
    const entry = await enrichEntry(db(c.env), await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]), user.id);
    switch (format) {
      case "json":
        return c.json(entry);
      case "txt": {
        const text = `${entry.title}\n\n${entry.content?.replace(/<[^>]*>/g, "") || ""}`;
        return c.text(text);
      }
      case "csv": {
        const row = [entry.id, entry.title, entry.url, entry.created_at, entry.is_archived, entry.is_starred].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
        return c.text(row, 200, { "Content-Type": "text/csv" });
      }
      case "xml": {
        const xml = `<?xml version="1.0"?><entry><id>${entry.id}</id><title>${entry.title}</title><url>${entry.url}</url></entry>`;
        return c.text(xml, 200, { "Content-Type": "application/xml" });
      }
      case "markdown": {
        const md = `# ${entry.title}\n\n${entry.content?.replace(/<[^>]*>/g, "") || ""}`;
        return c.text(md, 200, { "Content-Type": "text/markdown" });
      }
      case "epub": {
        const epub = await generateEpub(entry as any);
        return epubResponse(epub, id);
      }
      case "mobi":
        return c.json({ error: { code: 501, message: "MOBI export not yet supported" } }, 501);
      case "pdf":
        return c.json({ error: { code: 501, message: "PDF export not yet supported" } }, 501);
      default:
        return c.json({ error: { code: 400, message: "Unsupported format" } }, 400);
    }
  });

  // GET /api/entries/{id}/tags — list tags for an entry
  // EPUB export — used by Plop Reader and other e-reader clients
  // URL: /api/entries/{id}/export.epub
  app.get("/:id/export.epub", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one(
      "SELECT id, title, url, content, domain_name, authors, language, reading_time, preview_picture, created_at, updated_at FROM entries WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    if (!entry) {
      return c.json({ error: { code: 404, message: "Entry not found" } }, 404);
    }
    let epub: ArrayBuffer;
    try {
      epub = await generateEpub(entry as any);
    } catch (err) {
      console.error("EPUB generation failed:", err);
      epub = await generateEpub(entry as any, () =>
        Promise.resolve(new Response(null, { status: 404 }))
      );
    }
    return epubResponse(epub, id);
  });

  app.get("/:id/tags", async (c) => {
    const user = c.get("user") || { id: 1 };
    const entryId = parseInt(c.req.param("id"));
    const tags = await getEntryTags(db(c.env), entryId, user.id);
    return c.json({ items: tags });
  });

  // POST /api/entries/{id}/tags — add tags to an entry (append, not replace)
  app.post("/:id/tags", async (c) => {
    const user = c.get("user");
    const entryId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const addedTags = await attachTags(db(c.env), user.id, entryId, parseTags(body.tags));
    return c.json(addedTags);
  });

  // DELETE /api/entries/{entryId}/tags/{tagId} — remove tag from entry
  app.delete("/:entryId/tags/:tagId", async (c) => {
    const entryId = parseInt(c.req.param("entryId"));
    const tagId = parseInt(c.req.param("tagId"));
    await db(c.env).run("DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?", [entryId, tagId]);
    return c.json({ success: true });
  });

  // POST /api/entries/tags/lists — add tags to multiple entries
  app.post("/tags/lists", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    const entryIds: number[] = body.entries || [];
    const labels = parseTags(body.tags);
    for (const entryId of entryIds) {
      await attachTags(db(c.env), user.id, entryId, labels);
    }
    return c.json({ success: true });
  });

  // DELETE /api/entries/tags/list — remove tags from multiple entries
  app.delete("/tags/list", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    const entryIds: number[] = body.entries || [];
    const tagIds: number[] = body.tags || [];
    for (const entryId of entryIds) {
      for (const tagId of tagIds) {
        await db(c.env).run("DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?", [entryId, tagId]);
      }
    }
    return c.json({ success: true });
  });

  /**
   * POST /api/entries/{id}/content/reset — restore content from content_raw.
   *
   * Called by the editor's "discard changes" action. Restores the snapshot
   * captured the first time the user edits an entry's content. Re-sanitizes
   * and recomputes reading time. Clears content_raw afterwards (a single
   * restore per snapshot). Returns the updated entry.
   */
  app.post("/:id/content/reset", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const current = await db(c.env).one<{ content_raw: string | null }>(
      "SELECT content_raw FROM entries WHERE id = ? AND user_id = ?",
      [id, user.id],
    );
    if (!current) return c.json({ error: { code: 404, message: "Entry not found" } }, 404);
    if (current.content_raw == null) {
      return c.json({ error: { code: 409, message: "No original snapshot to restore" } }, 409);
    }
    const restored = sanitizeEntryHtml(current.content_raw);
    await db(c.env).run(
      `UPDATE entries
         SET content = ?, content_raw = NULL, reading_time = ?, is_not_parsed = 0, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
      [restored, computeReadingTime(restored), id, user.id],
    );
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json(await enrichEntry(db(c.env), entry, user.id));
  });

  return app;
}
