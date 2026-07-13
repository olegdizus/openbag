// Integration tests for the new browser auth + cookie-session flow.
//
// Covers the API gaps Phase 2 closes for the auth surface:
//   1. POST /api/auth/login sets a session cookie and the cookie is honored
//      by authMiddleware on protected routes.
//   2. POST /api/auth/signup is gated by ALLOWED_REGISTRATION.
//   3. POST /api/auth/logout revokes the session (subsequent requests 401).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../../worker/src/api";
import { D1Client } from "../../worker/src";
import { hashPassword } from "../../worker/src/auth/features/users/password";

const ctx = { waitUntil() { } } as unknown as ExecutionContext;
const regEnv = (allow: string) => ({ ...env, ALLOWED_REGISTRATION: allow });

function request(
  path: string,
  init: RequestInit = {},
  allow?: string,
): Promise<Response> {
  return app.fetch(new Request(`https://openbag.test${path}`, init), (allow ? regEnv(allow) : env) as any, ctx);
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", origin: "https://openbag.test", ...extra };
}

function json(jsonObject: unknown): string {
  return JSON.stringify(jsonObject);
}

function grabSessionCookie(res: Response): string | null {
  const sc = res.headers.get("set-cookie");
  if (!sc) return null;
  const m = sc.match(/session=([^;]+)/);
  return m ? m[1] : null;
}

async function seedUser(username = "alice"): Promise<void> {
  const db = new D1Client(env.DB);
  const hash = await hashPassword("password12345");
  const existing = await db.one("SELECT id FROM users WHERE username = ?", [username]);
  if (!existing) {
    await db.run("INSERT INTO users (id, username, password_hash) VALUES (1, ?, ?)", [username, hash]);
    await db.run("INSERT OR IGNORE INTO user_config (user_id) VALUES (1)");
  }
}

beforeAll(async () => {
  const db = new D1Client(env.DB);
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    name TEXT,
    feed_token TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS user_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'baggy',
    items_per_page INTEGER DEFAULT 30,
    reading_speed INTEGER DEFAULT 200,
    language TEXT DEFAULT 'en',
    action_mark_as_read INTEGER DEFAULT 0,
    list_mode INTEGER DEFAULT 0,
    display_thumbnails INTEGER DEFAULT 1,
    UNIQUE(user_id)
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    user_agent TEXT
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS oauth_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    random_id TEXT NOT NULL,
    secret TEXT NOT NULL,
    name TEXT NOT NULL,
    redirect_uris TEXT DEFAULT '[]',
    allowed_grant_types TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    scope TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
});

beforeEach(async () => {
  const db = new D1Client(env.DB);
  await db.run("DELETE FROM sessions", []);
  await db.run("DELETE FROM user_config WHERE user_id != 1", []);
  await db.run("DELETE FROM users WHERE id != 1", []);
  await db.run("DELETE FROM oauth_clients", []);
  await seedUser("alice");
});

describe("POST /api/auth/login", () => {
  it("sets a session cookie and returns 200 on success", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: json({ username: "alice", password: "password12345" }),
    });
    expect(res.status).toBe(200);
    const cookie = grabSessionCookie(res);
    expect(cookie).not.toBeNull();
    const body = (await res.json()) as { user: { username: string } };
    expect(body.user.username).toBe("alice");
  });

  it("rejects wrong credentials with 401 and no cookie", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: json({ username: "alice", password: "wrong" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects missing fields with 400", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: json({ username: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects cross-origin requests with 403", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders({ origin: "https://evil.example" }),
      body: json({ username: "alice", password: "password12345" }),
    });
    expect(res.status).toBe(403);
  });

  it("the issued cookie authenticates protected routes", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: json({ username: "alice", password: "password12345" }),
    });
    expect(login.status).toBe(200);
    const cookie = `session=${grabSessionCookie(login)}`;

    const protected1 = await request("/api/user", { headers: { cookie } });
    expect(protected1.status).toBe(200);
    const me = (await protected1.json()) as { username: string };
    expect(me.username).toBe("alice");
  });

  it("an invalid cookie is rejected (404 fake session)", async () => {
    const protected1 = await request("/api/user", {
      headers: { cookie: "session=" + "0".repeat(64) },
    });
    expect(protected1.status).toBe(401);
  });
});

describe("POST /api/auth/signup", () => {
  it("creates a user, signs them in, and returns 200 when registration enabled", async () => {
    const name = `new_${Date.now()}`;
    const res = await request(
      "/api/auth/signup",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: json({ username: name, password: "password12345" }),
      },
      "true",
    );
    expect(res.status).toBe(200);
    const cookie = grabSessionCookie(res);
    expect(cookie).not.toBeNull();
    const row = await new D1Client(env.DB).one("SELECT username FROM users WHERE username = ?", [name]);
    expect(row?.username).toBe(name);
  });

  it("returns 403 when registration is disabled", async () => {
    const res = await request(
      "/api/auth/signup",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: json({ username: `x_${Date.now()}`, password: "password12345" }),
      },
      "false",
    );
    expect(res.status).toBe(403);
  });

  it("rejects short passwords (<8 chars) with 400", async () => {
    const res = await request(
      "/api/auth/signup",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: json({ username: `x_${Date.now()}`, password: "short" }),
      },
      "true",
    );
    expect(res.status).toBe(400);
  });

  it("409s on duplicate username", async () => {
    const res = await request(
      "/api/auth/signup",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: json({ username: "alice", password: "password12345" }),
      },
      "true",
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie and revokes the session", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: json({ username: "alice", password: "password12345" }),
    });
    const cookie = `session=${grabSessionCookie(login)}`;

    const logout = await request("/api/auth/logout", {
      method: "POST",
      headers: { cookie, ...jsonHeaders() },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie") || "").toContain("Max-Age=0");

    // Cookie now invalid (session row deleted) → 401.
    const blocked = await request("/api/user", { headers: { cookie } });
    expect(blocked.status).toBe(401);
  });

  it("is idempotent when not logged in", async () => {
    const res = await request("/api/auth/logout", {
      method: "POST",
      headers: jsonHeaders(),
    });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 200 + the user when a valid session is present", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: json({ username: "alice", password: "password12345" }),
    });
    const cookie = `session=${grabSessionCookie(login)}`;

    const res = await request("/api/auth/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { username: string } };
    expect(body.user.username).toBe("alice");
  });

  it("returns 401 + user:null when no cookie", async () => {
    const res = await request("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
