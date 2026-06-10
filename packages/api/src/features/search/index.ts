import { Hono } from "hono";
import { D1Client } from "@wallabag/core/db";

const db = (env: any) => new D1Client(env.DB);

export function searchRoutes() {
  const app = new Hono();

  app.get("/search", async (c) => {
    const user = c.get("user");
    const term = c.req.query("term") || "";
    const page = parseInt(c.req.query("page") || "1");
    const perPage = parseInt(c.req.query("perPage") || "30");
    if (!term) {
      return c.json({ items: [], total: 0, page, pages: 0 });
    }
    const likeTerm = `%${term}%`;
    const rows = await db(c.env).all<any[]>(
      `SELECT e.*, t.label as tag_label
       FROM entries e
       LEFT JOIN entry_tags et ON e.id = et.entry_id
       LEFT JOIN tags t ON et.tag_id = t.id
       WHERE e.user_id = ? AND (e.title LIKE ? OR e.content LIKE ? OR e.url LIKE ?)
       GROUP BY e.id
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, likeTerm, likeTerm, likeTerm, perPage, (page - 1) * perPage]
    );
    return c.json({ items: rows, total: rows.length, page, pages: 1 });
  });

  return app;
}
