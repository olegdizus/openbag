import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

export function importRoutes() {
  const app = new Hono();

  app.get("/", (c) => c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>Import</title>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
          nav { display: flex; gap: 16px; margin-bottom: 24px; }
          nav a { color: #2563eb; text-decoration: none; }
          input, select { width: 100%; padding: 8px; margin: 4px 0 12px; box-sizing: border-box; }
          button { padding: 10px 20px; background: #2563eb; color: white; border: none; cursor: pointer; }
        </style>
      </head>
      <body>
        <nav>
          <a href="/">Dashboard</a>
          <a href="/entries">Entries</a>
          <a href="/settings">Settings</a>
          <a href="/developer">Developer</a>
        </nav>
        <h1>Import Bookmarks</h1>
        <form method="post" action="/import" enctype="multipart/form-data" hx-post="/import" hx-target="body" hx-swap="outerHTML">
          <div>
            <label>Format</label>
            <select name="format">
              <option value="wallabag">Wallabag v2 JSON</option>
              <option value="pocket">Pocket CSV/HTML</option>
              <option value="bookmarks">Browser bookmarks (HTML)</option>
            </select>
          </div>
          <div>
            <label>File</label>
            <input type="file" name="file" accept=".json,.csv,.html" required/>
          </div>
          <button type="submit">Import</button>
        </form>
      </body>
    </html>
  `));

  app.post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file as File | undefined;
    const format = typeof body.format === "string" ? body.format : "bookmarks";

    if (!file) {
      return c.html("<h1>No file uploaded</h1><a href=\"/import\">Back</a>", 400);
    }

    const text = await file.text();
    await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, is_not_parsed) VALUES (?, ?, ?, ?, ?, 1)",
      [user.id, "import://", "import", `Imported ${file.name} (${format})`, text.slice(0, 10000)]
    );

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Import Complete</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
          <style>body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }</style>
        </head>
        <body>
          <h1>Import Complete</h1>
          <p>${file.name} (${(text.length / 1024).toFixed(1)} KB) queued.</p>
          <p><a href="/entries">View entries</a> · <a href="/">Dashboard</a></p>
        </body>
      </html>
    `);
  });

  return app;
}
