import { D1Client } from "../db";

/**
 * Session middleware — reads the `session` cookie, attaches the matching user
 * to context. When `required` is false (default true), a missing/invalid
 * session is allowed through without redirect (used for optional-session pages).
 */
export function sessionMiddleware(opts: { required?: boolean } = {}) {
  return async (c: any, next: () => Promise<void>) => {
    const sessionCookie = c.req.header("cookie") || "";
    const match = sessionCookie.match(/session=([^;]+)/);
    if (match) {
      const username = decodeURIComponent(match[1]);
      const db = new D1Client(c.env.DB);
      const user = await db.one<{ id: number; username: string }>(
        "SELECT id, username FROM users WHERE username = ?",
        [username]
      );
      if (user) c.set("user", user);
    }

    if (!c.get("user") && opts.required !== false) {
      return c.redirect("/login", 302);
    }
    await next();
  };
}
