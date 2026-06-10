import { Hono } from "hono";
import { getUserInfo } from "@wallabag/auth";

export function userRoutes() {
  const app = new Hono();

  app.get("/user", async (c) => {
    const user = c.get("user");
    const info = await getUserInfo(c.env, user.id);
    return c.json(info);
  });

  app.get("/version", (c) => c.text("2.x"));

  app.get("/info", (c) => c.json({ name: "Wallabag CF Worker", version: "0.1.0" }));

  return app;
}
