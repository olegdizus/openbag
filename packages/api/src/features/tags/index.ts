import { Hono } from "hono";
import { D1Client } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

export function tagRoutes() {
  const app = new Hono();

  // GET /api/tags — list all tags with nbEntries (Wallabag format)
  app.get("/", async (c) => {
    const user = c.get("user");
    const tags = await db(c.env).all(
      `SELECT t.id, t.label, t.slug, COUNT(et.entry_id) as nbEntries
       FROM tags t
       LEFT JOIN entry_tags et ON et.tag_id = t.id
       WHERE t.user_id = ?
       GROUP BY t.id
       ORDER BY t.label`,
      [user.id]
    );
    return c.json(tags);
  });

  // DELETE /api/tags/{tagId} — delete a tag (removes from all entries, then deletes orphan)
  app.delete("/:tagId", async (c) => {
    const user = c.get("user");
    const tagId = parseInt(c.req.param("tagId"));
    // Remove from all entries
    await db(c.env).run("DELETE FROM entry_tags WHERE tag_id = ? AND tag_id IN (SELECT id FROM tags WHERE id = ? AND user_id = ?)", [tagId, tagId, user.id]);
    // Delete the tag itself
    await db(c.env).run("DELETE FROM tags WHERE id = ? AND user_id = ?", [tagId, user.id]);
    return c.json({ id: tagId, label: "", slug: "" });
  });

  // GET /api/tags/label — get tag by label
  app.get("/label", async (c) => {
    const user = c.get("user");
    const label = c.req.query("label");
    if (!label) return c.json({ error: { code: 400, message: "Missing label" } }, 400);
    const tag = await db(c.env).one("SELECT * FROM tags WHERE user_id = ? AND label = ?", [user.id, label]);
    return c.json(tag);
  });

  // GET /api/tags/labels — get tags by labels
  app.get("/labels", async (c) => {
    const user = c.get("user");
    const labels = c.req.query("labels");
    if (!labels) return c.json({ error: { code: 400, message: "Missing labels" } }, 400);
    const slugs = labels.split(",").map((s: string) => s.trim()).filter(Boolean);
    const placeholders = slugs.map(() => "?").join(",");
    const tags = await db(c.env).all(`SELECT * FROM tags WHERE user_id = ? AND slug IN (${placeholders})`, [user.id, ...slugs]);
    return c.json({ items: tags });
  });

  // DELETE /api/tags/label — delete tags by labels (comma-separated)
  // Accepts both query param ?tags=tag1,tag2 and body { tags: "tag1,tag2" }
  app.delete("/label", async (c) => {
    const user = c.get("user");
    let tagsLabels = c.req.query("tags") || "";
    if (!tagsLabels) {
      const body = await c.req.json().catch(() => ({}));
      tagsLabels = body.tags || "";
    }
    if (!tagsLabels) return c.json({ error: { code: 400, message: "Missing tags" } }, 400);
    const labels = tagsLabels.split(",").map((s: string) => s.trim()).filter(Boolean);
    const deleted = [];
    for (const label of labels) {
      const tag = await db(c.env).one("SELECT id, label, slug FROM tags WHERE user_id = ? AND label = ?", [user.id, label]);
      if (tag) {
        await db(c.env).run("DELETE FROM entry_tags WHERE tag_id = ?", [tag.id]);
        await db(c.env).run("DELETE FROM tags WHERE id = ? AND user_id = ?", [tag.id, user.id]);
        deleted.push(tag);
      }
    }
    return c.json(deleted);
  });

  return app;
}
