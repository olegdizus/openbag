import { Hono } from "hono";
import { D1Client } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

export function searchRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  app.get("/", async (c) => {
    const user = c.get("user");
    const term = c.req.query("term") || "";
    const page = Math.max(1, parseInt(c.req.query("page") || "1") || 1);
    const perPage = Math.min(Math.max(parseInt(c.req.query("perPage") || "30") || 30, 1), 200);
    const offset = (page - 1) * perPage;

    if (!term) {
      return c.json({ _embedded: { items: [] }, _links: { self: { href: "/api/search" } }, total: 0, page, pages: 0 });
    }

    const userId = user.id;

    // Escape the FTS5 query term (M6): wrap in double quotes and double any
    // internal quotes, so user input can't inject FTS5 query syntax (`*`,
    // column qualifiers, boolean operators) that throws or matches-all. The
    // trigram tokenizer still does substring matching under a quoted phrase.
    const ftsTerm = `"${term.replace(/"/g, '""')}"`;

    const rows = await db(c.env).all<any[]>(
      `SELECT e.*, snippet(entries_fts_trigram, 0, '<mark>', '</mark>', '...', 20) as snippet
       FROM entries e
       JOIN entries_fts_trigram fts ON fts.rowid = e.id
       WHERE e.user_id = ? AND (fts.title MATCH ? OR fts.content MATCH ? OR fts.url MATCH ?)
       ORDER BY bm25(entries_fts_trigram)
       LIMIT ? OFFSET ?`,
      [userId, ftsTerm, ftsTerm, ftsTerm, perPage, offset]
    );

    const totalRow = (await db(c.env).one<{ total: number }>(
      `SELECT COUNT(*) as total FROM entries_fts_trigram fts
       JOIN entries e ON e.id = fts.rowid
       WHERE e.user_id = ? AND (fts.title MATCH ? OR fts.content MATCH ? OR fts.url MATCH ?)`,
      [userId, ftsTerm, ftsTerm, ftsTerm]
    )) ?? { total: 0 };

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
