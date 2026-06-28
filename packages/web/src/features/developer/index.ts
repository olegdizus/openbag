import { Hono } from "hono";

export function developerRoutes() {
  const app = new Hono();
  // Developer routes are handled by authRoutes() in @wallabag/auth
  return app;
}
