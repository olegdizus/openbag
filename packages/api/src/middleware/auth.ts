import { D1Client, lookupSession, tokenHash } from "@openbag/core";

/** Read the `session` cookie value (if any) from a raw Cookie header. */
function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return undefined; } // L1: bad % → 401, not 500
}

/** Resolve a Bearer token to a user row, or null. Looks up by sha256(token). */
async function resolveBearerToken(
  db: D1Client,
  token: string,
): Promise<{ id: number; username: string } | null> {
  const tokenRow = await db.one<{ user_id: number }>(
    "SELECT user_id FROM oauth_access_tokens WHERE token = ? AND expires_at > datetime('now')",
    [await tokenHash(token)],
  );
  if (!tokenRow) return null;
  return db.one<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE id = ?",
    [tokenRow.user_id],
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Auth middleware — accepts Bearer tokens (Wallabag clients), `?access_token=`
 * query param (read-only: feeds/explorers; restricted to safe methods so a
 * leaked URL token can't drive mutations), and signed `session` cookies
 * (browser UI). Either path attaches `{ id, username }` to context.
 */
export function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("Authorization");
    const queryToken = SAFE_METHODS.has(c.req.method) ? c.req.query("access_token") : undefined;

    let user: { id: number; username: string } | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      user = await resolveBearerToken(new D1Client(c.env.DB), token);
    } else if (queryToken) {
      user = await resolveBearerToken(new D1Client(c.env.DB), queryToken);
    } else {
      const sessionToken = readSessionCookie(c.req.header("cookie"));
      user = await lookupSession(c.env, sessionToken);
    }

    if (!user) {
      return c.json({ error: { code: 401, message: "Unauthorized" } }, 401);
    }

    c.set("user", user);
    await next();
  };
}
