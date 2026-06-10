import { Hono } from "hono";
import { D1Client } from "@wallabag/core/db";

const db = (env: any) => new D1Client(env.DB);

export function configRoutes() {
  const app = new Hono();

  app.get("/config", async (c) => {
    const user = c.get("user");
    const config = await db(c.env).one("SELECT * FROM user_config WHERE user_id = ?", [user.id]);
    return c.json(config);
  });

  app.put("/config", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    await db(c.env).run(
      "UPDATE user_config SET theme = ?, items_per_page = ?, language = ? WHERE user_id = ?",
      [body.theme || "baggy", body.items_per_page || 30, body.language || "en", user.id]
    );
    return c.json({ success: true });
  });

  return app;
}
