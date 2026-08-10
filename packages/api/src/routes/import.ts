import { Hono } from "hono";
import { D1Client, toHex, sanitizeEntryHtml } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

/** Cap uploaded import payloads — guards the 128 MB Workers limit (H5). */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2 MB

export function importRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  app.post("/import", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file as File | undefined;
    if (!file) {
      return c.json({ error: { code: 400, message: "No file provided" } }, 400);
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return c.json({ error: { code: 413, message: "Import file too large" } }, 413);
    }
    const text = await file.text();
    // Stored content is sanitized (H5) — it renders raw in the reading view and
    // the public share page, so unsanitized input is a stored-XSS surface.
    const content = sanitizeEntryHtml(text.slice(0, 2000));
    // Real dedup key: distinct imports shouldn't all share an empty url_hash.
    const url = `import://upload/${encodeURIComponent(file.name)}`;
    await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, is_not_parsed) VALUES (?, ?, ?, ?, ?, 1)",
      [user.id, url, toHex(new TextEncoder().encode(url)), file.name, content],
    );
    return c.json({ success: true, message: "Import queued" });
  });

  return app;
}
