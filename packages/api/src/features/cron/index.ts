import { Hono } from "hono";

export function cronRoutes() {
  const app = new Hono();

  app.get("/", (c) => c.json({ status: "ok" }));

  return app;
}
