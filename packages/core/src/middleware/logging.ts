// Logging middleware

import { Hono } from "hono";

export function loggingMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`);
  };
}
