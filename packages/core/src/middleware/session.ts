import { D1Client } from "../db";

export function sessionMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    const sessionCookie = c.req.header("cookie") || "";
    const match = sessionCookie.match(/session=([^;]+)/);
    if (!match) {
      return c.redirect("/login", 302);
    }

    const username = decodeURIComponent(match[1]);
    const db = new D1Client(c.env.DB);
    const user = await db.one<{ id: number; username: string }>(
      "SELECT id, username FROM users WHERE username = ?",
      [username]
    );

    if (!user) {
      return c.redirect("/login", 302);
    }

    c.set("user", user);
    await next();
  };
}
