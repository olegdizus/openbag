import { D1Client } from "@wallabag/core";

export async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: { code: 401, message: "Missing or invalid authorization header" } }, 401);
  }

  const token = authHeader.slice(7);
  const db = new D1Client(c.env.DB);

  try {
    const tokenRow = await db.one(
      "SELECT user_id, client_id FROM oauth_access_tokens WHERE token = ? AND expires_at > datetime('now')",
      [token]
    );

    const user = await db.one(
      "SELECT id, username FROM users WHERE id = ?",
      [tokenRow.user_id]
    );

    c.set("user", user);
    c.set("client", { id: tokenRow.client_id });
    await next();
  } catch {
    return c.json({ error: { code: 401, message: "Invalid or expired token" } }, 401);
  }
}
