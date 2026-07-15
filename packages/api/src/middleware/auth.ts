// Auth middleware — accepts Bearer tokens (Wallabag clients) and signed
// `session` cookies (browser UI) indistinguishably. Either path attaches
// `{ id, username }` to context and rejects with 401 otherwise.

import { D1Client, lookupSession } from "@openbag/core";

/** Read the `session` cookie value (if any) from a raw Cookie header. */
function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Resolve a Bearer / query token to a user row, or null. */
async function resolveBearerToken(
  db: D1Client,
  token: string,
): Promise<{ id: number; username: string } | null> {
  const tokenRow = await db.one<{ user_id: number }>(
    "SELECT user_id FROM oauth_access_tokens WHERE token = ? AND expires_at > datetime('now')",
    [token],
  );
  if (!tokenRow) return null;
  return db.one<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE id = ?",
    [tokenRow.user_id],
  );
}

export function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    // Support Authorization: Bearer (clients), ?access_token= query param
    // (read-only feed/explorers), and session= cookie (browser UI).
    const authHeader = c.req.header("Authorization");
    const queryToken = c.req.query("access_token");

    let user: { id: number; username: string } | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      user = await resolveBearerToken(new D1Client(c.env.DB), token);
    } else if (queryToken) {
      user = await resolveBearerToken(new D1Client(c.env.DB), queryToken);
    } else {
      // No Bearer — try the session cookie path.
      const sessionToken = readSessionCookie(c.req.header("cookie"));
      user = await lookupSession(c.env, sessionToken);
    }

    if (!user) {
      return c.json(
        { error: { code: 401, message: "Unauthorized" } },
        401,
      );
    }

    c.set("user", user);
    await next();
  };
}
