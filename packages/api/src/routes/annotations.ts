import { Hono } from "hono";
import { D1Client } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

export function annotationRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  app.get("/:entryId", async (c) => {
    const user = c.get("user");
    const entryId = parseInt(c.req.param("entryId"));
    const annotations = await db(c.env).all(
      "SELECT * FROM annotations WHERE entry_id = ? AND user_id = ?",
      [entryId, user.id]
    );
    return c.json({ items: annotations });
  });

  app.post("/:entryId", async (c) => {
    const user = c.get("user");
    const entryId = parseInt(c.req.param("entryId"));
    const body = await c.req.json();
    const id = crypto.randomUUID();
    await db(c.env).run(
      "INSERT INTO annotations (id, entry_id, user_id, text, quote, ranges) VALUES (?, ?, ?, ?, ?, ?)",
      [id, entryId, user.id, body.text || "", body.quote || null, JSON.stringify(body.ranges || [])]
    );
    return c.json({ id }, 201);
  });

  app.put("/:annotationId", async (c) => {
    const user = c.get("user");
    const annotationId = c.req.param("annotationId");
    const body = await c.req.json();
    await db(c.env).run(
      "UPDATE annotations SET text = ?, quote = ?, ranges = ? WHERE id = ? AND user_id = ?",
      [body.text, body.quote || null, JSON.stringify(body.ranges || []), annotationId, user.id]
    );
    return c.json({ success: true });
  });

  app.delete("/:annotationId", async (c) => {
    const user = c.get("user");
    const annotationId = c.req.param("annotationId");
    await db(c.env).run("DELETE FROM annotations WHERE id = ? AND user_id = ?", [annotationId, user.id]);
    return c.json({ success: true });
  });

  return app;
}
