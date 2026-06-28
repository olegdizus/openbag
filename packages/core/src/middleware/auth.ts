// Auth middleware — validates Bearer token, attaches user to context

import { D1Client } from "../db";
import type { Env } from "../types/env";

// Backwards-compatible alias; prefer `Env` from @wallabag/core for new code.
export type Bindings = Env;

export interface Variables {
  user: {
    id: number;
    username: string;
  };
}

export function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    // Support both Authorization: Bearer header and ?access_token= query param
    const authHeader = c.req.header("Authorization");
    const queryToken = c.req.query("access_token");
    let token: string;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (queryToken) {
      token = queryToken;
    } else {
      return c.json(
        { error: { code: 401, message: "Unauthorized" } },
        401
      );
    }
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
