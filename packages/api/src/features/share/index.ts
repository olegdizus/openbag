import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

export function shareRoutes() {
  const app = new Hono();

  app.get("/share/:uuid", async (c) => {
    const uuid = c.req.param("uuid");
    try {
      const entry = await db(c.env).one(
        "SELECT * FROM entries WHERE public_uuid = ? AND is_public = 1",
        [uuid]
      );
      return c.html(`<!DOCTYPE html><html><head><title>${entry.title}</title></head><body>${entry.content || ""}</body></html>`);
    } catch {
      return c.text("Not found", 404);
    }
  });

  return app;
}
