import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

export function settingsRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    const user = c.get("user");
    const config = await db(c.env).one("SELECT * FROM user_config WHERE user_id = ?", [user.id]).catch(() => null);
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Settings</title>
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
            <a href="/developer">Developer</a>
            <a href="/import">Import</a>
          </nav>
          <h1>Settings</h1>
          <form method="post" action="/settings" hx-post="/settings" hx-target="body" hx-swap="outerHTML">
            <div>
              <label>Theme</label>
              <select name="theme">
                <option value="baggy" ${config?.theme === "baggy" ? "selected" : ""}>Baggy</option>
                <option value="light" ${config?.theme === "light" ? "selected" : ""}>Light</option>
                <option value="dark" ${config?.theme === "dark" ? "selected" : ""}>Dark</option>
              </select>
            </div>
            <div>
              <label>Items per page</label>
              <input type="number" name="items_per_page" value="${config?.items_per_page ?? 30}" min="1" max="100"/>
            </div>
            <div>
              <label>Language</label>
              <input type="text" name="language" value="${config?.language ?? "en"}"/>
            </div>
            <div>
              <label>Reading speed (words/min)</label>
              <input type="number" name="reading_speed" value="${config?.reading_speed ?? 200}" min="1"/>
            </div>
            <div>
              <label>
                <input type="checkbox" name="action_mark_as_read" value="1" ${config?.action_mark_as_read ? "checked" : ""}/>
                Mark as read when opening
              </label>
            </div>
            <div>
              <label>
                <input type="checkbox" name="list_mode" value="1" ${config?.list_mode ? "checked" : ""}/>
                List view mode
              </label>
            </div>
            <div>
              <label>
                <input type="checkbox" name="display_thumbnails" value="1" ${config?.display_thumbnails ? "checked" : ""}/>
                Show thumbnails
              </label>
            </div>
            <button type="submit">Save</button>
          </form>
        </body>
      </html>
    `);
  });

  app.post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const theme = typeof body.theme === "string" ? body.theme : "baggy";
    const itemsPerPage = parseInt(typeof body.items_per_page === "string" ? body.items_per_page : "30");
    const language = typeof body.language === "string" ? body.language : "en";
    const readingSpeed = parseInt(typeof body.reading_speed === "string" ? body.reading_speed : "200");
    const actionMarkAsRead = body.action_mark_as_read === "1" ? 1 : 0;
    const listMode = body.list_mode === "1" ? 1 : 0;
    const displayThumbnails = body.display_thumbnails === "1" ? 1 : 0;

    await db(c.env).run(
      `UPDATE user_config SET theme = ?, items_per_page = ?, language = ?, reading_speed = ?, action_mark_as_read = ?, list_mode = ?, display_thumbnails = ? WHERE user_id = ?`,
      [theme, itemsPerPage, language, readingSpeed, actionMarkAsRead, listMode, displayThumbnails, user.id]
    );

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Settings</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
          <style>body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }</style>
        </head>
        <body>
          <h1>Settings saved</h1>
          <p><a href="/settings">Back to settings</a> · <a href="/">Dashboard</a></p>
        </body>
      </html>
    `);
  });

  return app;
}
