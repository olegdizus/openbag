import { lookupSession } from "@openbag/core";
import { readSessionCookie } from "../browser-auth";
import type { Context } from "hono";

/**
 * Inline handler (not a TSX component) — mounted on `app.get("/")` and
 * produces a 302 redirect directly. Resolves the session via `@openbag/core`'s
 * `lookupSession` (D1 direct — no HTTP), then redirects based on the result.
 * There is no SSR page at `/` — its only role is to short-circuit to the
 * right next page.
 */
export async function homeRoute(c: Context): Promise<Response> {
  const token = readSessionCookie(c.req.header("cookie"));
  const user = await lookupSession(c.env, token);
  const target = user ? "/entries" : "/login";
  return c.redirect(target, 302);
}
