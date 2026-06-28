import { Hono } from "hono";

export function securityHeaders() {
  return async (c: any, next: () => Promise<void>) => {
    await next();
    if (c.req.path.startsWith("/api/")) {
      c.header("Cache-Control", "no-store, private");
      c.header("Pragma", "no-cache");
    }
  };
}
