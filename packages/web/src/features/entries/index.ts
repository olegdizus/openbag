import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

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

    const rows = entries.map((e: any) => `
      <tr>
        <td><a href="/entries/${e.id}">${e.title || e.url}</a></td>
        <td>${e.is_archived ? "Yes" : "No"}</td>
        <td>${e.is_starred ? "Yes" : "No"}</td>
        <td>${e.created_at}</td>
      </tr>
    `).join("");

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
            <thead><tr><th>Title</th><th>Archived</th><th>Starred</th><th>Created</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">No entries yet</td></tr>'}</tbody>
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
        <head><title>${entry.title}</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
          <style>
            body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
            nav { display: flex; gap: 16px; margin-bottom: 24px; }
            nav a { color: #2563eb; text-decoration: none; }
            .meta { color: #6b7280; font-size: 14px; margin-bottom: 16px; }
            article { line-height: 1.6; }
            .tags { margin: 12px 0; }
            .tag { background: #e5e7eb; padding: 2px 8px; border-radius: 4px; margin-right: 8px; }
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
            <h1>${entry.title}</h1>
            <div class="meta">
              <a href="${entry.url}">${entry.url}</a> · ${entry.created_at}
              ${entry.is_archived ? " · Archived" : ""}
              ${entry.is_starred ? " · Starred" : ""}
            </div>
            <div class="tags">
              ${tags.map((t: any) => `<span class="tag">${t.label}</span>`).join("")}
            </div>
            <div>${entry.content || "<p>No content yet. Content will be fetched when the parser pipeline is installed.</p>"}</div>
          </article>
        </body>
      </html>
    `);
  });

  return app;
}
