// Error handling middleware

import { Hono } from "hono";

export function errorMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    try {
      await next();
    } catch (err) {
      console.error("API error:", err);
      const message = err instanceof Error ? err.message : "Internal server error";
      return c.json(
        { error: { code: 500, message } },
        500
      );
    }
  };
}
