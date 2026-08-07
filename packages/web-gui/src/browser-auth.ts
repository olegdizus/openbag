// Browser auth middleware — counterpart to `authMiddleware` (in
// packages/api/src/middleware/auth.ts), which is JSON-only and returns 401 on
// failure for Wallabag clients. The two coexist in different Workers:
//   - `authMiddleware`        → /api/* (JSON 401 on missing session)  ← API Worker
//   - `browserAuthMiddleware` → UI routes (302 → /login?next=<path>)  ← web-gui Worker

import type { Context, MiddlewareHandler } from "hono";
import { lookupSession, SESSION_COOKIE } from "@openbag/core";

/** Read the `session` cookie value (if any) from a raw Cookie header. */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const re = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`);
  const match = cookieHeader.match(re);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export interface BrowserAuthOptions {
  /**
   * When true (default), a missing/expired session issues a 302 redirect to
   * `/login?next=<current path>`. When false, no redirect happens and the
   * handler can branch on `c.get("user")` (used by the `/` route to bounce
   * between `/entries` and `/login`).
   */
  required?: boolean;
}

/**
 * Resolve the browser session; attach `{ id, username }` to context as
 * `user`. When `required` is true (default), an invalid/missing session
 * short-circuits with a 302 redirect to `/login?next=<path>`.
 *
 * The check goes through `@openbag/core`'s `lookupSession` — D1 direct,
 * no subrequest.
 */
export function browserAuthMiddleware(opts: BrowserAuthOptions = {}): MiddlewareHandler {
  const { required = true } = opts;
  return async (c: Context, next) => {
    const token = readSessionCookie(c.req.header("cookie"));
    const user = await lookupSession(c.env, token);
    if (!user && required) {
      const url = new URL(c.req.url);
      const nextPath = encodeURIComponent(url.pathname + (url.search || ""));
      return c.redirect(`/login?next=${nextPath}`, 302);
    }
    if (user) c.set("user", user);
    await next();
  };
}
