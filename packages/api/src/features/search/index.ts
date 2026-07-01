import { Hono } from "hono";
import { D1Client } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

export function searchRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    const user = c.get("user");
    const term = c.req.query("term") || "";
    const page = parseInt(c.req.query("page") || "1");
    const perPage = parseInt(c.req.query("perPage") || "30");
    const offset = (page - 1) * perPage;

    if (!term) {
      return c.json({ _embedded: { items: [] }, _links: { self: { href: "/api/search" } }, total: 0, page, pages: 0 });
    }

    const likeTerm = `%${term}%`;
    const userId = user.id;

    const rows = await db(c.env).all<any[]>(
      `SELECT e.*, snippet(entries_fts_trigram, 0, '<mark>', '</mark>', '...', 20) as snippet
       FROM entries e
       JOIN entries_fts_trigram fts ON fts.rowid = e.id
       WHERE e.user_id = ? AND (fts.title MATCH ? OR fts.content MATCH ? OR fts.url MATCH ?)
       ORDER BY bm25(entries_fts_trigram)
       LIMIT ? OFFSET ?`,
      [userId, term, term, term, perPage, offset]
    );

    const totalRow = await db(c.env).one<{ total: number }>(
      `SELECT COUNT(*) as total FROM entries_fts_trigram fts
       JOIN entries e ON e.id = fts.rowid
       WHERE e.user_id = ? AND (fts.title MATCH ? OR fts.content MATCH ? OR fts.url MATCH ?)`,
      [userId, term, term, term]
    );

    return c.json({
      _embedded: { items: rows },
      _links: { self: { href: `/api/search?term=${encodeURIComponent(term)}&page=${page}&perPage=${perPage}` } },
      total: totalRow.total,
      page,
      pages: Math.ceil(totalRow.total / perPage) || 1,
    });
  });

  return app;
}
