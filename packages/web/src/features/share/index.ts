import { Hono } from "hono";

export function shareRoutes() {
  const app = new Hono();
  app.get("/share/:uuid", (c) => c.html("<h1>Shared Article</h1>"));
  return app;
}
