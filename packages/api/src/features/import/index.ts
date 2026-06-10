import { Hono } from "hono";
import { enqueueImport } from "@wallabag/core/queue";

export function importRoutes() {
  const app = new Hono();

  app.post("/import", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file as File;
    if (!file) return c.json({ error: { code: 400, message: "No file" } }, 400);
    const user = c.get("user");
    await enqueueImport((c.env as any).QUEUE, user.id, []);
    return c.json({ success: true });
  });

  return app;
}
