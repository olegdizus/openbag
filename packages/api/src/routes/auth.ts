// Browser-friendly auth endpoints (login/signup/logout). The api/auth/*
// routes set/clear a signed `session` cookie so the browser UI doesn't have
// to manage a bearer token.

import { Hono } from "hono";
import {
  createUser,
  findUserByUsername,
  getUserInfo,
  isRegistrationEnabled,
  verifyPasswordAgainst,
  D1Client,
  buildExpiredCookie,
  buildSessionCookie,
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from "@openbag/core";

async function parseBody<T = Record<string, any>>(c: any): Promise<T> {
  const ct = (c.req.header("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return (await c.req.json()) as T;
    } catch {
      return {} as T;
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    return (await c.req.parseBody()) as T;
  }
  // Fallback — try JSON regardless (clients that forget the content-type).
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Same-origin CSRF check — used on every POST.
 *
 * With `SameSite=Strict` cookies, a cross-site browser POST won't carry the
 * `session` cookie at all, but a bad actor can still use a CSRF token they
 * cannot read to forge a top-level navigation POST. The `Origin` header is
 * set by browsers on POST/PUT/DELETE and cannot be smuggled cross-site, so
 * rejecting mismatched origins is a cheap, sufficient defense.
 */
function requireSameOrigin(c: any): Response | null {
  const origin = c.req.header("origin");
  if (!origin) return null; // curl/non-browser: no Origin, allow
  try {
    const originUrl = new URL(origin);
    // Trust c.req.url's host — works regardless of whether the `Host` header
    // is populated (it may be absent in tests / behind proxies).
    const reqUrl = new URL(c.req.url);
    return originUrl.host === reqUrl.host ? null : c.json({ error: "Cross-origin denied" }, 403);
  } catch {
    return c.json({ error: "Invalid Origin" }, 403);
  }
}

function normalizeUsername(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const u = s.trim().toLowerCase().slice(0, 64);
  return u.length === 0 ? null : u;
}

/**
 * Returns the auth api sub-app. Mounted under `/api/auth`.
 *
 * All three routes accept either application/json or
 * application/x-www-form-urlencoded so the static UI can POST a plain form
 * without needing a JSON helper.
 *
 * CSRF: SameSite=Strict + Origin check (see `requireSameOrigin`) covers all
 * mutating requests without needing a double-submit token.
 */
export function apiAuthRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database; ALLOWED_REGISTRATION?: string } }>();

  /**
   * POST /api/auth/login
   * Body: { username, password }
   * 200 { user }                    on success (sets Set-Cookie: session=)
   * 401 { error: "Invalid credentials" }
   * 400 { error: "Missing fields" } when username/password missing
   */
  app.post("/login", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const body = await parseBody<{ username?: string; password?: string }>(c);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return c.json({ error: "Missing username or password" }, 400);
    }
    const ok = await verifyPasswordAgainst(c.env, username, password);
    if (!ok) {
      // Constant-ish body to avoid username enumeration via shape.
      return c.json({ error: "Invalid credentials" }, 401);
    }
    const user = await findUserByUsername(c.env, username);
    if (!user) return c.json({ error: "Invalid credentials" }, 401);
    const sessionId = await createSession(c.env, user.id, c.req.header("user-agent"));
    c.header("Set-Cookie", buildSessionCookie(sessionId));
    const info = await getUserInfo(c.env, user.id);
    return c.json({ user: info });
  });

  /**
   * POST /api/auth/signup
   * Body: { username, password, email? }
   * 200 { user }                on success (also signs in)
   * 403 { error: "Registration disabled" }  when ALLOWED_REGISTRATION=false
   * 409 { error: "Username taken" }
   * 400 { error: "Missing fields" | "..." }
   */
  app.post("/signup", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    if (!isRegistrationEnabled(c.env)) {
      return c.json({ error: "Registration disabled" }, 403);
    }
    const body = await parseBody<{ username?: string; password?: string; email?: string }>(c);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : undefined;
    if (!username || password.length < 8) {
      return c.json({ error: "Username and password (>=8 chars) required" }, 400);
    }
    const existing = await findUserByUsername(c.env, username);
    if (existing) return c.json({ error: "Username taken" }, 409);

    // createUser reads isRegistrationEnabled again internally — that's fine,
    // it's a cheap flag lookup and correct if reg is flipped mid-flight.
    let userId: number;
    try {
      userId = await createUser(c.env, username, password, email);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "REGISTRATION_DISABLED") return c.json({ error: "Registration disabled" }, 403);
      return c.json({ error: msg || "Could not create user" }, 500);
    }
    const sessionId = await createSession(c.env, userId, c.req.header("user-agent"));
    c.header("Set-Cookie", buildSessionCookie(sessionId));
    const info = await getUserInfo(c.env, userId);
    return c.json({ user: info });
  });

  /**
   * POST /api/auth/logout
   * 200 { success: true }   (clears session cookie, deletes session row)
   * Idempotent for clients without a cookie.
   */
  app.post("/logout", async (c) => {
    const forbidden = requireSameOrigin(c);
    if (forbidden) return forbidden;
    const token = readSessionCookie(c.req.header("cookie"));
    await revokeSession(c.env, token);
    c.header("Set-Cookie", buildExpiredCookie());
    return c.json({ success: true });
  });

  /**
   * GET /api/auth/me — convenience for the UI's "am I logged in?" check.
   * This route bypasses the api-wide authMiddleware because it doesn't mount
   * under it: see api/index.ts (it's registered as a public sibling).
   *
   * Returns 200 { user } when a valid session cookie is present, else 401.
   */
  app.get("/me", async (c) => {
    const token = readSessionCookie(c.req.header("cookie"));
    const db = new D1Client(c.env.DB);
    const cookieHash = token
      ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then((d) =>
        Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join(""),
      )
      : null;
    if (!cookieHash) return c.json({ user: null }, 401);
    const session = await db.one<{ user_id: number; expires_at: string }>(
      "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
      [cookieHash],
    );
    if (!session) return c.json({ user: null }, 401);
    const expiresMs = Date.parse(session.expires_at.replace(" ", "T") + "Z");
    if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
      await db.run("DELETE FROM sessions WHERE token_hash = ?", [cookieHash]).catch(() => { });
      return c.json({ user: null }, 401);
    }
    const info = await getUserInfo(c.env, session.user_id);
    return c.json({ user: info });
  });

  return app;
}

export { SESSION_COOKIE };
