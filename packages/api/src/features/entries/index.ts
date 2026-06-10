import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

export function entryRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const user = c.get("user") || { id: 1 };
      const page = parseInt(c.req.query("page") || "1");
      const perPage = parseInt(c.req.query("perPage") || "30");
      const offset = (page - 1) * perPage;

      const d = db(c.env);
      const results: any[] = await d.all(
        "SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [user.id, perPage, offset]
      );

      const totalRow: any = await d.one(
        "SELECT COUNT(*) as total FROM entries WHERE user_id = ?",
        [user.id]
      );

      return c.json({
        items: results,
        total: totalRow?.total ?? 0,
        page,
        pages: Math.ceil((totalRow?.total ?? 0) / perPage) || 1,
      });
    } catch (e: any) {
      return c.json({ error: e.message, stack: e.stack }, 500);
    }
  });

  app.get("/:id", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one(
      "SELECT * FROM entries WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    return c.json(entry);
  });

  app.post("/", async (c) => {
    const user = c.get("user") || { id: 1 };
    const body = await c.req.json();
    const url = body.url as string;
    const urlHash = Array.from(new TextEncoder().encode(url)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const result = await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content) VALUES (?, ?, ?, ?, ?)",
      [user.id, url, urlHash, body.title || url, body.content || ""]
    );
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ?", [result.changes]);
    return c.json(entry, 201);
  });

  app.delete("/:id", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    await db(c.env).run("DELETE FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json({ success: true });
  });

  app.patch("/:id", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const sets: string[] = [];
    const params: any[] = [];
    if (body.is_archived !== undefined) { sets.push("is_archived = ?"); params.push(body.is_archived ? 1 : 0); }
    if (body.is_starred !== undefined) { sets.push("is_starred = ?"); params.push(body.is_starred ? 1 : 0); }
    if (body.title) { sets.push("title = ?"); params.push(body.title); }
    if (body.content) { sets.push("content = ?"); params.push(body.content); }
    params.push(id, user.id);
    await db(c.env).run(
      `UPDATE entries SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      params
    );
    return c.json({ success: true });
  });

  app.get("/:id/export", async (c) => {
    const user = c.get("user") || { id: 1 };
    const id = parseInt(c.req.param("id"));
    const format = c.req.query("format") || "json";
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json({ format, entry });
  });

  return app;
}
