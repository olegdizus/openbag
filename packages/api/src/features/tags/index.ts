import { Hono } from "hono";
import { D1Client } from "@wallabag/core/db";

const db = (env: any) => new D1Client(env.DB);

export function tagRoutes() {
  const app = new Hono();

  app.get("/tags", async (c) => {
    const user = c.get("user");
    const tags = await db(c.env).all(
      "SELECT * FROM tags WHERE user_id = ?",
      [user.id]
    );
    return c.json({ items: tags });
  });

  app.delete("/tags", async (c) => {
    const user = c.get("user");
    const tagId = parseInt(c.req.query("tagId") || "0");
    await db(c.env).run("DELETE FROM tags WHERE id = ? AND user_id = ?", [tagId, user.id]);
    return c.json({ success: true });
  });

  app.post("/entries/:entryId/tags", async (c) => {
    const user = c.get("user");
    const entryId = parseInt(c.req.param("entryId"));
    const body = await c.req.json();
    const tags = body.tags as string[];
    for (const label of tags) {
      const slug = label.toLowerCase().replace(/\s+/g, "-");
      const tag = await db(c.env).one(
        "SELECT id FROM tags WHERE user_id = ? AND slug = ?",
        [user.id, slug]
      ).catch(() => null);
      let tagId: number;
      if (tag) {
        tagId = tag.id;
      } else {
        const result = await db(c.env).run(
          "INSERT INTO tags (user_id, label, slug) VALUES (?, ?, ?)",
          [user.id, label, slug]
        );
        tagId = result.changes;
      }
      await db(c.env).run(
        "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
        [entryId, tagId]
      );
    }
    return c.json({ success: true });
  });

  app.delete("/entries/:entryId/tags/:tagId", async (c) => {
    const entryId = parseInt(c.req.param("entryId"));
    const tagId = parseInt(c.req.param("tagId"));
    await db(c.env).run(
      "DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?",
      [entryId, tagId]
    );
    return c.json({ success: true });
  });

  return app;
}
