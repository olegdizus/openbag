import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const buttonStyles = `
  .actions { white-space: nowrap; }
  .actions button, .actions form { display: inline; margin-right: 4px; }
  .btn-toggle, .btn-star, .btn-danger, .btn-edit {
    padding: 2px 8px; font-size: 13px; cursor: pointer;
    border: 1px solid #d1d5db; background: #f9fafb; border-radius: 4px;
  }
  .btn-star.is-on { color: #f59e0b; border-color: #f59e0b; background: #fffbeb; }
  .btn-danger { color: #dc2626; border-color: #fecaca; background: #fef2f2; }
  .btn-danger:hover { background: #dc2626; color: white; }
  .btn-edit { font-size: 12px; margin-left: 8px; vertical-align: middle; }
  .title-edit { display: flex; gap: 8px; align-items: center; margin: 0 0 16px; }
  .title-edit input { flex: 1; padding: 6px; font-size: 18px; box-sizing: border-box; }
  .title-edit button { padding: 6px 12px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
  .btn-cancel { color: #2563eb; text-decoration: none; padding: 6px 4px; }
`;

function renderRow(e: any): string {
  const id = e.id;
  const archived = !!e.is_archived;
  const starred = !!e.is_starred;
  return `
      <tr id="entry-row-${id}">
        <td><a href="/entries/${id}">${escapeHtml(e.title || e.url)}</a></td>
        <td class="actions">
          <button class="btn-toggle" hx-post="/entries/${id}/archive?view=list" hx-target="#entry-row-${id}" hx-swap="outerHTML">${archived ? "Unarchive" : "Archive"}</button>
          <button class="btn-star ${starred ? "is-on" : ""}" hx-post="/entries/${id}/star?view=list" hx-target="#entry-row-${id}" hx-swap="outerHTML" title="${starred ? "Unstar" : "Star"}">${starred ? "★" : "☆"}</button>
          <button class="btn-danger" hx-post="/entries/${id}/delete?view=list" hx-target="#entry-row-${id}" hx-swap="outerHTML" hx-confirm="Delete this entry?">✕</button>
        </td>
        <td>${archived ? "Yes" : "No"}</td>
        <td>${starred ? "Yes" : "No"}</td>
        <td>${escapeHtml(e.created_at)}</td>
      </tr>`;
}

function renderActions(e: any): string {
  const id = e.id;
  const archived = !!e.is_archived;
  const starred = !!e.is_starred;
  return `
            <div class="actions" id="entry-actions-${id}">
              <button class="btn-toggle" hx-post="/entries/${id}/archive?view=detail" hx-target="#entry-actions-${id}" hx-swap="outerHTML">${archived ? "Unarchive" : "Archive"}</button>
              <button class="btn-star ${starred ? "is-on" : ""}" hx-post="/entries/${id}/star?view=detail" hx-target="#entry-actions-${id}" hx-swap="outerHTML">${starred ? "★ Unstar" : "☆ Star"}</button>
              <form method="post" action="/entries/${id}/delete" style="display:inline" onsubmit="return confirm('Delete this entry?')">
                <button type="submit" class="btn-danger">Delete</button>
              </form>
            </div>`;
}

function renderTitleDisplay(e: any): string {
  const id = e.id;
  return `            <div id="entry-title-${id}">
              <h1>${escapeHtml(e.title)}<button class="btn-edit" hx-get="/entries/${id}/edit-title" hx-target="#entry-title-${id}" hx-swap="outerHTML">Edit</button></h1>
            </div>`;
}

function renderTitleEditForm(e: any): string {
  const id = e.id;
  return `            <div id="entry-title-${id}">
              <form class="title-edit" hx-post="/entries/${id}/title" hx-target="#entry-title-${id}" hx-swap="outerHTML">
                <input type="text" name="title" value="${escapeHtml(e.title)}" required>
                <button type="submit">Save</button>
                <a class="btn-cancel" href="/entries/${id}" hx-get="/entries/${id}/title" hx-target="#entry-title-${id}" hx-swap="outerHTML">Cancel</a>
              </form>
            </div>`;
}

export function entryWebRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    const user = c.get("user");
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
    );

    const rows = entries.map(renderRow).join("");

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Entries</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
          <style>
            body { font-family: system-ui; max-width: 1000px; margin: 40px auto; padding: 20px; }
            nav { display: flex; gap: 16px; margin-bottom: 24px; }
            nav a { color: #2563eb; text-decoration: none; }
            table { width: 100%; border-collapse: collapse; }
            th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
            a { color: #2563eb; }
            ${buttonStyles}
          </style>
        </head>
        <body>
          <nav>
            <a href="/">Dashboard</a>
            <a href="/settings">Settings</a>
            <a href="/developer">Developer</a>
            <a href="/import">Import</a>
          </nav>
          <h1>Entries</h1>
          <p><a href="/entries/new">+ Add entry</a></p>
          <table>
            <thead><tr><th>Title</th><th>Actions</th><th>Archived</th><th>Starred</th><th>Created</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">No entries yet</td></tr>'}</tbody>
          </table>
          <div style="margin-top:16px">
            ${page > 1 ? `<a href="/entries?page=${page - 1}">Previous</a>` : ""}
            <span>Page ${page}</span>
            ${entries.length === perPage ? `<a href="/entries?page=${page + 1}">Next</a>` : ""}
          </div>
        </body>
      </html>
    `);
  });

  app.get("/new", (c) => c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>Add Entry</title>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
          nav { display: flex; gap: 16px; margin-bottom: 24px; }
          nav a { color: #2563eb; text-decoration: none; }
          input { width: 100%; padding: 8px; margin: 4px 0 12px; box-sizing: border-box; }
          button { padding: 10px 20px; background: #2563eb; color: white; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <nav>
          <a href="/">Dashboard</a>
          <a href="/entries">Entries</a>
          <a href="/settings">Settings</a>
          <a href="/developer">Developer</a>
          <a href="/import">Import</a>
        </nav>
        <h1>Add Entry</h1>
        <form method="post" action="/entries" hx-post="/entries" hx-target="body" hx-swap="outerHTML">
          <div>
            <label>URL</label>
            <input type="url" name="url" required placeholder="https://example.com/article"/>
          </div>
          <div>
            <label>Title (optional)</label>
            <input type="text" name="title" placeholder="Article title"/>
          </div>
          <button type="submit">Save</button>
        </form>
      </body>
    </html>
  `));

  app.post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const url = typeof body.url === "string" ? body.url : "";
    const title = typeof body.title === "string" ? body.title : "";

    if (!url) {
      return c.html('<h1>URL required</h1><a href="/entries/new">Back</a>', 400);
    }

    const urlHash = Array.from(new TextEncoder().encode(url)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const result = await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, is_not_parsed) VALUES (?, ?, ?, ?, ?, 1)",
      [user.id, url, urlHash, title || url, ""]
    );
    const id = result.lastRowId;
    return c.redirect(`/entries/${id}`, 302);
  });

  app.get("/:id", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]).catch(() => null);
    if (!entry) return c.text("Not found", 404);

    const tags = await db(c.env).all(
      "SELECT t.label FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? AND t.user_id = ?",
      [id, user.id]
    ).catch(() => []);

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>${escapeHtml(entry.title)}</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
          <style>
            body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
            nav { display: flex; gap: 16px; margin-bottom: 24px; }
            nav a { color: #2563eb; text-decoration: none; }
            .meta { color: #6b7280; font-size: 14px; margin-bottom: 16px; }
            article { line-height: 1.6; }
            .tags { margin: 12px 0; }
            .tag { background: #e5e7eb; padding: 2px 8px; border-radius: 4px; margin-right: 8px; }
            ${buttonStyles}
          </style>
        </head>
        <body>
          <nav>
            <a href="/">Dashboard</a>
            <a href="/entries">Entries</a>
            <a href="/settings">Settings</a>
            <a href="/developer">Developer</a>
            <a href="/import">Import</a>
          </nav>
          <article>
            ${renderTitleDisplay(entry)}
            <div class="meta">
              <a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a> · ${escapeHtml(entry.created_at)}
              ${entry.is_archived ? " · Archived" : ""}
              ${entry.is_starred ? " · Starred" : ""}
            </div>
            ${renderActions(entry)}
            <div class="tags">
              ${tags.map((t: any) => `<span class="tag">${escapeHtml(t.label)}</span>`).join("")}
            </div>
            <div>${entry.content || "<p>No content yet. Content will be fetched when the parser pipeline is installed.</p>"}</div>
          </article>
        </body>
      </html>
    `);
  });

  app.post("/:id/archive", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const cur = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!cur) return c.text("Not found", 404);
    await db(c.env).run(
      "UPDATE entries SET is_archived = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [cur.is_archived ? 0 : 1, id, user.id]
    );
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.html(c.req.query("view") === "detail" ? renderActions(entry) : renderRow(entry));
  });

  app.post("/:id/star", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const cur = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!cur) return c.text("Not found", 404);
    await db(c.env).run(
      "UPDATE entries SET is_starred = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [cur.is_starred ? 0 : 1, id, user.id]
    );
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.html(c.req.query("view") === "detail" ? renderActions(entry) : renderRow(entry));
  });

  app.get("/:id/title", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one("SELECT id, title FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!entry) return c.text("Not found", 404);
    return c.html(renderTitleDisplay(entry));
  });

  app.get("/:id/edit-title", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one("SELECT id, title FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!entry) return c.text("Not found", 404);
    return c.html(renderTitleEditForm(entry));
  });

  app.post("/:id/title", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const entry = await db(c.env).one("SELECT id, title FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!entry) return c.text("Not found", 404);
    if (!title) {
      return c.html(renderTitleEditForm(entry));
    }
    await db(c.env).run(
      "UPDATE entries SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [title, id, user.id]
    );
    const updated = await db(c.env).one("SELECT id, title FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.html(renderTitleDisplay(updated));
  });

  app.post("/:id/delete", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    await db(c.env).run("DELETE FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    if (c.req.query("view") === "list") {
      return c.html("");
    }
    return c.redirect("/entries", 302);
  });

  return app;
}
