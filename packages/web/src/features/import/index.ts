import { Hono } from "hono";
import { D1Client } from "@wallabag/core";
import { layout } from "../../templates/layout";

const db = (env: any) => new D1Client(env.DB);

export function importRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    const user = c.get("user");
    return c.html(layout({
      title: "Import",
      user,
      body: `      <h1>Import Bookmarks</h1>
      <form method="post" action="/import" enctype="multipart/form-data">
        <fieldset>
          <label for="im-format">Format</label>
          <select id="im-format" name="format">
            <option value="wallabag">Wallabag v2 JSON</option>
            <option value="pocket">Pocket CSV/HTML</option>
            <option value="bookmarks">Browser bookmarks (HTML)</option>
          </select>
        </fieldset>
        <fieldset>
          <label for="im-file">File</label>
          <input id="im-file" type="file" name="file" accept=".json,.csv,.html" required/>
        </fieldset>
        <button type="submit">Import</button>
      </form>`,
    }));
  });

  app.post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file as File | undefined;
    const format = typeof body.format === "string" ? body.format : "bookmarks";

    if (!file) {
      return c.html(layout({
        title: "Import",
        user,
        body: `      <div class="alert alert-error" role="alert">No file uploaded.</div>
      <p><a href="/import">Back</a></p>`,
      }), 400);
    }

    const text = await file.text();
    await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, is_not_parsed) VALUES (?, ?, ?, ?, ?, 1)",
      [user.id, "import://", "import", `Imported ${file.name} (${format})`, text.slice(0, 10000)]
    );

    const sizeKb = (text.length / 1024).toFixed(1);
    return c.redirect(`/entries?imported=${encodeURIComponent(file.name)}&size=${sizeKb}`, 302);
  });

  return app;
}
