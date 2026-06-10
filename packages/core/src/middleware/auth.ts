// Auth middleware — validates Bearer token, attaches user to context

import { D1Client } from "../db";

export interface Bindings {
  DB: any;
}

export interface Variables {
  user: {
    id: number;
    username: string;
  };
}

export function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { error: { code: 401, message: "Unauthorized" } },
        401
      );
    }

    const token = authHeader.slice(7).trim();
    const db = new D1Client(c.env.DB);
    const tokenRow = await db.one<{ user_id: number }>(
      "SELECT user_id FROM oauth_access_tokens WHERE token = ? AND expires_at > datetime('now')",
      [token]
    );

    if (!tokenRow) {
      return c.json(
        { error: { code: 401, message: "Invalid or expired token" } },
        401
      );
    }

    const user = await db.one<{ id: number; username: string }>(
      "SELECT id, username FROM users WHERE id = ?",
      [tokenRow.user_id]
    );

    if (!user) {
      return c.json(
        { error: { code: 401, message: "User not found" } },
        401
      );
    }

    c.set("user", user);
    await next();
  };
}
