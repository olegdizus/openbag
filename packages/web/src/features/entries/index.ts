import { Hono } from "hono";
import { D1Client } from "@openbag/core";
import { fetchAndParse } from "@openbag/parser";
import { layout, escapeHtml } from "../../templates/layout";
import { sanitizeEntryHtml, computeReadingTime } from "../../sanitize";

const db = (env: any) => new D1Client(env.DB);

async function fetchEntryContent(env: any, entryId: number): Promise<void> {
  try {
    const entry = await db(env).one<{ url: string; is_not_parsed: number }>(
      "SELECT url, is_not_parsed FROM entries WHERE id = ?", [entryId]
    );
    if (!entry || !entry.is_not_parsed) return;

    const parsed = await fetchAndParse(entry.url);
    await db(env).run(
      `UPDATE entries SET
        title = COALESCE(NULLIF(title, ''), ?, title),
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
    console.log(`Fetched content for entry ${entryId}: ${parsed.title}`);
  } catch (err) {
    console.error(`Failed to fetch content for entry ${entryId}: ${(err as Error).message}`);
    await db(env).run("UPDATE entries SET is_not_parsed = 0 WHERE id = ?", [entryId]).catch(() => {});
  }
}

type Entry = {
  id: number;
  title: string;
  url: string;
  content: string | null;
  content_raw: string | null;
  created_at: string;
  is_archived: number;
  is_starred: number;
  is_not_parsed: number;
};

function isXhr(c: any): boolean {
  return c.req.header("X-Requested-With") === "XMLHttpRequest";
}

function nextUrl(c: any, fallback: string): string {
  const n = c.req.query("next");
  return n && n.startsWith("/") ? n : fallback;
}

function renderRow(e: Entry): string {
  const id = e.id;
  const archived = !!e.is_archived;
  const starred = !!e.is_starred;
  return `        <tr id="entry-row-${id}">
          <td><a href="/entries/${id}">${escapeHtml(e.title || e.url)}</a></td>
          <td class="actions">
            <form method="post" action="/entries/${id}/archive?next=/entries&view=list"
                  data-enhance data-target="entry-row-${id}">
              <button type="submit" class="btn-toggle" name="archive" value="${archived ? "0" : "1"}">${archived ? "Unarchive" : "Archive"}</button>
            </form>
            <form method="post" action="/entries/${id}/star?next=/entries&view=list"
                  data-enhance data-target="entry-row-${id}">
              <button type="submit" class="btn-star${starred ? " is-on" : ""}" title="${starred ? "Unstar" : "Star"}">${starred ? "★" : "☆"}</button>
            </form>
            <form method="post" action="/entries/${id}/delete?next=/entries&view=list"
                  data-enhance data-target="entry-row-${id}" data-confirm="Delete this entry?">
              <button type="submit" class="btn-danger">✕</button>
            </form>
          </td>
          <td>${archived ? "Yes" : "No"}</td>
          <td>${starred ? "Yes" : "No"}</td>
          <td>${escapeHtml(e.created_at)}</td>
        </tr>`;
}

function renderActions(e: Entry): string {
  const id = e.id;
  const archived = !!e.is_archived;
  const starred = !!e.is_starred;
  return `            <div class="actions" id="entry-actions-${id}">
              <form method="post" action="/entries/${id}/archive?next=/entries/${id}&view=detail"
                    data-enhance data-target="entry-actions-${id}">
                <button type="submit" class="btn-toggle">${archived ? "Unarchive" : "Archive"}</button>
              </form>
              <form method="post" action="/entries/${id}/star?next=/entries/${id}&view=detail"
                    data-enhance data-target="entry-actions-${id}">
                <button type="submit" class="btn-star${starred ? " is-on" : ""}">${starred ? "★ Unstar" : "☆ Star"}</button>
              </form>
              <form method="post" action="/entries/${id}/delete?next=/entries&view=detail"
                    onsubmit="return confirm('Delete this entry?')">
                <button type="submit" class="btn-danger">Delete</button>
              </form>
            </div>`;
}

export function entryWebRoutes() {
  const app = new Hono();

  function renderContentDiv(content: string, hasRaw: boolean, entryId?: number): string {
    const dataId = entryId != null ? ` data-entry-id="${entryId}"` : "";
    return `<div id="entry-content" data-has-raw="${hasRaw ? "1" : "0"}"${dataId}>${content}</div>`;
  }


  app.get("/", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const page = parseInt(c.req.query("page") || "1");
    const perPage = 20;
    const offset = (page - 1) * perPage;

    const totalRow = await db(c.env).one<{ total: number }>(
      "SELECT COUNT(*) as total FROM entries WHERE user_id = ?",
      [user.id]
    );
    const entries = await db(c.env).all(
      "SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [user.id, perPage, offset]
    ) as Entry[];

    const rows = entries.map(renderRow).join("\n") || `        <tr><td colspan="5" class="text-muted">No entries yet</td></tr>`;
    const totalPages = Math.max(1, Math.ceil((totalRow?.total ?? 0) / perPage));
    const importedName = c.req.query("imported");
    const importAlert = importedName
      ? `      <div class="alert alert-success" role="status">Imported <strong>${escapeHtml(importedName)}</strong> (${c.req.query("size") || "?"} KB). Entries will appear as parsing completes.</div>\n`
      : "";

    return c.html(layout({
      title: "Entries",
      user,
      body: `${importAlert}      <h1>Entries</h1>
      <p><a href="/entries/new">+ Add entry</a></p>
      <table>
        <thead>
          <tr><th scope="col">Title</th><th scope="col">Actions</th><th scope="col">Archived</th><th scope="col">Starred</th><th scope="col">Created</th></tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
      <nav class="pagination" aria-label="Pagination">
        ${page > 1 ? `<a href="/entries?page=${page - 1}" rel="prev">Previous</a>` : '<span class="text-muted">Previous</span>'}
        <span class="current">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="/entries?page=${page + 1}" rel="next">Next</a>` : '<span class="text-muted">Next</span>'}
      </nav>`,
    }));
  });

  app.get("/new", (c) => {
    const user = c.get("user") as { id: number; username: string };
    return c.html(layout({
      title: "Add Entry",
      user,
      body: `      <h1>Add Entry</h1>
      <form method="post" action="/entries">
        <fieldset>
          <label for="en-url">URL</label>
          <input id="en-url" type="url" name="url" required placeholder="https://example.com/article"/>
        </fieldset>
        <fieldset>
          <label for="en-title">Title (optional)</label>
          <input id="en-title" type="text" name="title" placeholder="Article title"/>
        </fieldset>
        <button type="submit">Save</button>
      </form>`,
    }));
  });

  app.post("/", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const body = await c.req.parseBody();
    const url = typeof body.url === "string" ? body.url : "";
    const title = typeof body.title === "string" ? body.title : "";

    if (!url) {
      return c.html(layout({
        title: "Add Entry",
        user,
        body: `      <div class="alert alert-error" role="alert">URL required.</div>
      <p><a href="/entries/new">Back</a></p>`,
      }), 400);
    }

    const urlHash = Array.from(new TextEncoder().encode(url)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const result = await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, is_not_parsed) VALUES (?, ?, ?, ?, ?, 1)",
      [user.id, url, urlHash, title || url, ""]
    );
    const id = result.lastRowId;
    if (id) {
      c.executionCtx.waitUntil(fetchEntryContent(c.env, id));
    }
    return c.redirect(`/entries/${id}`, 302);
  });

  app.get("/:id", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one<Entry>("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]).catch(() => null);
    if (!entry) return c.text("Not found", 404);

    const tags = await db(c.env).all(
      "SELECT t.label FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? AND t.user_id = ?",
      [id, user.id]
    ).catch(() => []) as { label: string }[];

    const archived = !!entry.is_archived;
    const starred = !!entry.is_starred;
    const titleSaved = c.req.query("title_saved") === "1";
    const titleAlert = titleSaved ? `          <div class="alert alert-success" role="status">Title updated.</div>\n` : "";
    const contentSaved = c.req.query("content_saved") === "1";
    const contentAlert = contentSaved ? `          <div class="alert alert-success" role="status">Content updated.</div>\n` : "";
    const hasRaw = entry.content_raw != null;
    const isFetching = !entry.content;
    const fallback = '<p class="entry-fetching">Fetching content…</p>';
    const contentHtml = entry.content || fallback;
    const canEdit = !!entry.content;
    const scripts: string[] = [];
    if (isFetching) scripts.push("/entry-poll.js");
    if (canEdit) scripts.push("/editor.js");

    if (isFetching && entry.is_not_parsed) {
      c.executionCtx.waitUntil(fetchEntryContent(c.env, id));
    }

    return c.html(layout({
      title: entry.title || `Entry ${id}`,
      user,
      scripts: scripts.length > 0 ? scripts : undefined,
      body: `      <article class="entry">
        <header>
          <h1>${escapeHtml(entry.title)}
            <details class="title-edit">
              <summary>Edit title</summary>
              <form method="post" action="/entries/${id}/title?next=/entries/${id}&title_saved=1">
                <input type="text" name="title" value="${escapeHtml(entry.title)}" required aria-label="Title"/>
                <button type="submit">Save</button>
              </form>
            </details>
          </h1>
          <p class="entry-meta">
            <a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a> · ${escapeHtml(entry.created_at)}
            ${archived ? " · Archived" : ""}${starred ? " · Starred" : ""}
          </p>
        </header>
${titleAlert}${contentAlert}        ${renderActions(entry)}
        <div class="entry-tags">
          ${tags.map(t => `<span class="tag">${escapeHtml(t.label)}</span>`).join("")}
        </div>
        ${canEdit ? `        <div class="entry-edit-bar"><button type="button" id="entry-edit-btn" class="btn-edit" aria-label="Edit article content">✎ Edit content</button></div>\n` : ""}
        ${renderContentDiv(contentHtml, hasRaw, isFetching ? id : undefined)}
      </article>`,
    }));
  });

  app.get("/:id/status", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const row = await db(c.env).one<{ is_not_parsed: number; content: string | null }>(
      "SELECT is_not_parsed, content FROM entries WHERE id = ? AND user_id = ?", [id, user.id]
    ).catch(() => null);
    if (!row) return c.json({ ready: false }, 404);
    const ready = row.is_not_parsed === 0 && !!row.content;
    return c.json({ ready });
  });

  app.post("/:id/archive", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const cur = await db(c.env).one<Entry>("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!cur) return c.text("Not found", 404);
    await db(c.env).run(
      "UPDATE entries SET is_archived = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [cur.is_archived ? 0 : 1, id, user.id]
    );
    const entry = await db(c.env).one<Entry>("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!entry) return c.text("Not found", 404);
    if (isXhr(c)) {
      return c.html(c.req.query("view") === "detail" ? renderActions(entry) : renderRow(entry));
    }
    return c.redirect(nextUrl(c, "/entries"), 302);
  });

  app.post("/:id/star", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const cur = await db(c.env).one<Entry>("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!cur) return c.text("Not found", 404);
    await db(c.env).run(
      "UPDATE entries SET is_starred = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [cur.is_starred ? 0 : 1, id, user.id]
    );
    const entry = await db(c.env).one<Entry>("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!entry) return c.text("Not found", 404);
    if (isXhr(c)) {
      return c.html(c.req.query("view") === "detail" ? renderActions(entry) : renderRow(entry));
    }
    return c.redirect(nextUrl(c, "/entries"), 302);
  });

  app.post("/:id/title", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const entry = await db(c.env).one<Entry>("SELECT id, title FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!entry) return c.text("Not found", 404);
    if (!title) {
      return c.redirect(`/entries/${id}`, 302);
    }
    await db(c.env).run(
      "UPDATE entries SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [title, id, user.id]
    );
    const qs = c.req.query("title_saved") === "1" ? "?title_saved=1" : "";
    return c.redirect(`${nextUrl(c, `/entries/${id}`)}${qs}`, 302);
  });

  app.post("/:id/content", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const body = await c.req.parseBody();
    const incoming = typeof body.content === "string" ? body.content : "";
    const entry = await db(c.env).one<Entry>(
      "SELECT id, content, content_raw FROM entries WHERE id = ? AND user_id = ?",
      [id, user.id],
    ).catch(() => null);
    if (!entry) return c.text("Not found", 404);

    const clean = sanitizeEntryHtml(incoming);
    const readingTime = computeReadingTime(clean);
    const firstEdit = entry.content_raw == null && !!entry.content;
    if (firstEdit) {
      await db(c.env).run(
        "UPDATE entries SET content = ?, content_raw = ?, reading_time = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [clean, entry.content, readingTime, id, user.id],
      );
    } else {
      await db(c.env).run(
        "UPDATE entries SET content = ?, reading_time = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [clean, readingTime, id, user.id],
      );
    }

    if (isXhr(c)) {
      return c.html(renderContentDiv(clean, true));
    }
    const qs = c.req.query("content_saved") === "1" ? "?content_saved=1" : "";
    return c.redirect(`/entries/${id}${qs}`, 302);
  });

  app.post("/:id/content/reset", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one<Entry>(
      "SELECT id, content_raw FROM entries WHERE id = ? AND user_id = ?",
      [id, user.id],
    ).catch(() => null);
    if (!entry) return c.text("Not found", 404);
    if (entry.content_raw == null) return c.text("No original saved", 400);

    const restored = entry.content_raw;
    const readingTime = computeReadingTime(restored);
    await db(c.env).run(
      "UPDATE entries SET content = ?, reading_time = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [restored, readingTime, id, user.id],
    );

    if (isXhr(c)) {
      return c.html(renderContentDiv(restored, true));
    }
    return c.redirect(`/entries/${id}`, 302);
  });

  app.post("/:id/delete", async (c) => {
    const user = c.get("user") as { id: number; username: string };
    const id = parseInt(c.req.param("id"));
    await db(c.env).run("DELETE FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (isXhr(c)) {
      return c.html("");
    }
    return c.redirect(nextUrl(c, "/entries"), 302);
  });

  return app;
}
