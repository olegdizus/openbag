import { Hono } from "hono";
import { D1Client } from "../../../index";

const db = (env: any) => new D1Client(env.DB);

export function taggingRuleRoutes() {
  const app = new Hono();

  app.get("/taggingrule/export", async (c) => {
    const user = c.get("user");
    const rules = await db(c.env).all(
      "SELECT * FROM tagging_rules WHERE user_id = ?",
      [user.id]
    );
    return c.json({ rules });
  });

  return app;
}
