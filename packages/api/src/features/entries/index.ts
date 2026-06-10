import { Hono } from "hono";
import { D1Client } from "@wallabag/core/db";

const db = (env: any) => new D1Client(env.DB);

export function entryRoutes() {
  const app = new Hono();

  app.get("/entries", async (c) => {
    const user = c.get("user");
    const url = new URL(c.req.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const perPage = parseInt(url.searchParams.get("perPage") || "30");
    const offset = (page - 1) * perPage;

    const d = db(c.env);
    const { results } = await d.db.prepare(
      "SELECT * FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(user.id, perPage, offset).all<any>();

    const totalRow = await d.db.prepare(
      "SELECT COUNT(*) as total FROM entries WHERE user_id = ?"
    ).bind(user.id).first<{ total: number }>();

    return c.json({
      items: results,
      total: totalRow?.total ?? 0,
      page,
      pages: Math.ceil((totalRow?.total ?? 0) / perPage) || 1,
    });
  });

  app.get("/entries/:id", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const entry = await db(c.env).one(
      "SELECT * FROM entries WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    return c.json(entry);
  });

  app.post("/entries", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    const url = body.url as string;
    const urlHash = Buffer.from(url).toString("hex").slice(0, 32);
    const result = await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content) VALUES (?, ?, ?, ?, ?)",
      [user.id, url, urlHash, body.title || url, body.content || ""]
    );
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ?", [result.changes]);
    return c.json(entry, 201);
  });

  app.delete("/entries/:id", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    await db(c.env).run("DELETE FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json({ success: true });
  });

  app.patch("/entries/:id", async (c) => {
    const user = c.get("user");
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

  app.get("/entries/:id/export", async (c) => {
    const user = c.get("user");
    const id = parseInt(c.req.param("id"));
    const format = c.req.query("format") || "json";
    const entry = await db(c.env).one("SELECT * FROM entries WHERE id = ? AND user_id = ?", [id, user.id]);
    return c.json({ format, entry });
  });

  return app;
}
